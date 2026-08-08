import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

test("live watch provider keeps paused persisted state paused by default", async () => {
  const stateFile = await tempStateFile();
  await writeFile(stateFile, `${JSON.stringify({ consecutiveNpf: 6, status: "paused" }, null, 2)}\n`, "utf8");
  let calls = 0;
  const result = (await runWatchWithProvider(
    {
      labels,
      providerName: "mock-live",
      stateFilePath: stateFile,
      maxCycles: 1,
      intervalMs: 0
    },
    async () => {
      calls += 1;
      return snapshot([{ number: 1, title: "Ready", labels: ["codex-ready"] }]);
    }
  )) as WatchResult;

  assert.equal(calls, 0);
  assert.equal(result.cyclesRun, 0);
  assert.equal(result.consecutiveNpf, 6);
  assert.equal(result.sessionStatus, "paused");
  assert.deepEqual(await readPersistedState(stateFile), { consecutiveNpf: 6, status: "paused" });
});

test("live watch provider resumes paused persisted state only with explicit intent", async () => {
  const stateFile = await tempStateFile();
  await writeFile(stateFile, `${JSON.stringify({ consecutiveNpf: 6, status: "paused" }, null, 2)}\n`, "utf8");
  const result = (await runWatchWithProvider(
    {
      labels,
      providerName: "mock-live",
      stateFilePath: stateFile,
      maxCycles: 1,
      intervalMs: 0,
      resume: true
    },
    async () => snapshot([{ number: 1, title: "Ready", labels: ["codex-ready"] }])
  )) as WatchResult;

  assert.equal(result.cyclesRun, 1);
  assert.equal(result.audits[0]?.outcome, "ACTION");
  assert.equal(result.audits[0]?.npfBefore, 0);
  assert.equal(result.consecutiveNpf, 0);
  assert.equal(result.sessionStatus, "active");
  assert.deepEqual(await readPersistedState(stateFile), { consecutiveNpf: 0, status: "active" });
});

test("repository watch provider persists durable session context", async () => {
  const stateFile = await tempStateFile();
  const result = (await runWatchWithProvider(
    {
      labels,
      providerName: "mock-live",
      repository: "example/repo",
      stateFilePath: stateFile,
      maxCycles: 1,
      intervalMs: 0,
      inactivityTimeoutMinutes: 60
    },
    async () => snapshot([{ number: 1, title: "Ready", labels: ["codex-ready"] }])
  )) as WatchResult;
  const persisted = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, unknown>;

  assert.equal(result.cyclesRun, 1);
  assert.equal(result.sessionStatus, "active");
  assert.equal(persisted.repository, "example/repo");
  assert.equal(persisted.activeIssueNumber, 1);
  assert.equal(persisted.nextActor, "worker");
  assert.equal(persisted.inactivityTimeoutMinutes, 60);
  assert.equal(persisted.consecutiveNpf, 0);
});

test("repository watch provider persists meaningful event identity across runs", async () => {
  const stateFile = await tempStateFile();
  await writeFile(
    stateFile,
    `${JSON.stringify(
      {
        consecutiveNpf: 4,
        status: "active",
        repository: "example/repo",
        nextActor: "none",
        lastMeaningfulActivityAt: "2026-08-08T00:00:00.000Z",
        inactivityTimeoutMinutes: 60,
        lastProcessedEventId: "pr:1:head:a"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const reviewReady = snapshot([
    {
      number: 1,
      title: "Review",
      labels: ["chat-review-ready"],
      relatedPullRequests: [{ state: "open", branch: "codex/issue-1", url: "https://github.com/example/repo/pull/1", eventId: "pr:1:head:b" }]
    }
  ]);

  const first = (await runWatchWithProvider(
    {
      labels,
      providerName: "mock-live",
      repository: "example/repo",
      stateFilePath: stateFile,
      maxCycles: 1,
      intervalMs: 0,
      inactivityTimeoutMinutes: 60
    },
    async () => reviewReady
  )) as WatchResult;
  const second = (await runWatchWithProvider(
    {
      labels,
      providerName: "mock-live",
      repository: "example/repo",
      stateFilePath: stateFile,
      maxCycles: 1,
      intervalMs: 0,
      inactivityTimeoutMinutes: 60
    },
    async () => reviewReady
  )) as WatchResult;
  const persisted = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, unknown>;

  assert.equal(first.consecutiveNpf, 0);
  assert.equal(first.audits[0]?.npfBefore, 4);
  assert.equal(first.audits[0]?.npfAfter, 0);
  assert.equal(second.consecutiveNpf, 1);
  assert.equal(second.audits[0]?.npfBefore, 0);
  assert.equal(second.audits[0]?.npfAfter, 1);
  assert.equal(persisted.lastProcessedEventId, "pr:1:head:b");
  assert.equal(typeof persisted.lastMeaningfulActivityAt, "string");
  assert.notEqual(persisted.lastMeaningfulActivityAt, "2026-08-08T00:00:00.000Z");
});
