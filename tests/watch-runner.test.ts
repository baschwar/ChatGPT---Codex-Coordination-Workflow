import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GithubSnapshotError } from "../apps/cli/src/github-dry-run.js";
import { runWatchWithProvider } from "../apps/cli/src/watch-runner.js";
import type { CycleAuditEvent, SessionStatus, WorkflowRepositorySnapshot } from "../packages/core/src/session.js";

const labels = {
  implementation_ready: "codex-ready",
  implementation_in_progress: "codex-in-progress",
  manual_validation: "manual-validation",
  review_ready: "chat-review-ready"
};

interface WatchResult {
  cyclesRun: number;
  sessionStatus: SessionStatus;
  consecutiveNpf: number;
  stateFile: string | null;
  audits: CycleAuditEvent[];
}

async function tempStateFile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "coordinator-watch-"));
  return path.join(dir, "session-state.json");
}

async function readPersistedState(stateFile: string): Promise<{ consecutiveNpf: number; status: SessionStatus }> {
  return JSON.parse(await readFile(stateFile, "utf8")) as { consecutiveNpf: number; status: SessionStatus };
}

function snapshot(issues: WorkflowRepositorySnapshot["issues"]): WorkflowRepositorySnapshot {
  return {
    repository: "example/repo",
    repositoryLabels: ["codex-ready", "codex-in-progress", "manual-validation", "chat-review-ready"],
    issues
  };
}

test("live watch provider pauses after six repeated NPF cycles and persists state", async () => {
  const stateFile = await tempStateFile();
  let calls = 0;
  const result = (await runWatchWithProvider(
    {
      labels,
      providerName: "mock-live",
      stateFilePath: stateFile,
      maxCycles: 8,
      intervalMs: 0,
      npfPauseThreshold: 6
    },
    async () => {
      calls += 1;
      return snapshot([]);
    }
  )) as WatchResult;

  assert.equal(calls, 6);
  assert.equal(result.cyclesRun, 6);
  assert.equal(result.consecutiveNpf, 6);
  assert.equal(result.sessionStatus, "paused");
  assert.deepEqual(await readPersistedState(stateFile), { consecutiveNpf: 6, status: "paused" });
});

test("live watch provider resets persisted NPF state after ACTION", async () => {
  const stateFile = await tempStateFile();
  const snapshots = [
    snapshot([]),
    snapshot([{ number: 1, title: "Ready", labels: ["codex-ready"] }])
  ];
  const lastSnapshot = snapshots[snapshots.length - 1];

  assert.ok(lastSnapshot);

  const result = (await runWatchWithProvider(
    {
      labels,
      providerName: "mock-live",
      stateFilePath: stateFile,
      maxCycles: 2,
      intervalMs: 0
    },
    async (index) => snapshots[index] ?? lastSnapshot
  )) as WatchResult;

  assert.deepEqual(result.audits.map((audit) => audit.outcome), ["NPF", "ACTION"]);
  assert.equal(result.consecutiveNpf, 0);
  assert.equal(result.sessionStatus, "active");
  assert.deepEqual(await readPersistedState(stateFile), { consecutiveNpf: 0, status: "active" });
});

test("live watch provider pauses immediately on HUMAN state", async () => {
  const stateFile = await tempStateFile();
  const result = (await runWatchWithProvider(
    {
      labels,
      providerName: "mock-live",
      stateFilePath: stateFile,
      maxCycles: 3,
      intervalMs: 0
    },
    async () => snapshot([{ number: 4, title: "Manual", labels: ["manual-validation"] }])
  )) as WatchResult;

  assert.equal(result.cyclesRun, 1);
  assert.equal(result.audits[0]?.outcome, "HUMAN");
  assert.equal(result.consecutiveNpf, 0);
  assert.equal(result.sessionStatus, "paused");
  assert.deepEqual(await readPersistedState(stateFile), { consecutiveNpf: 0, status: "paused" });
});

test("live watch provider surfaces GitHub auth failures as HUMAN setup diagnostics", async () => {
  const stateFile = await tempStateFile();
  const result = (await runWatchWithProvider(
    {
      labels,
      providerName: "mock-live",
      stateFilePath: stateFile,
      maxCycles: 3,
      intervalMs: 0
    },
    async () => {
      throw new GithubSnapshotError("github-auth-required", ["Run: gh auth login -h github.com"]);
    }
  )) as WatchResult;

  assert.equal(result.cyclesRun, 1);
  assert.equal(result.audits[0]?.outcome, "HUMAN");
  assert.equal(result.audits[0]?.reason, "github-auth-required");
  assert.deepEqual(result.audits[0]?.diagnostics, ["Run: gh auth login -h github.com"]);
  assert.deepEqual(await readPersistedState(stateFile), { consecutiveNpf: 0, status: "paused" });
});
