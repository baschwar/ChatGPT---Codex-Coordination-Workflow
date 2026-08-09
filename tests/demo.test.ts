import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runDemo, demoArtifactMarker, demoOutputBaseline } from "../apps/cli/src/demo.js";
import { discoverRepositoryWork } from "../packages/core/src/discovery.js";
import type { GitHubWriteAdapter, GitHubWriteResult } from "../packages/github-adapter/src/types.js";

const repoRoot = process.cwd();
const labels = {
  implementation_ready: "codex-ready",
  implementation_in_progress: "codex-in-progress",
  manual_validation: "manual-validation",
  review_ready: "chat-review-ready"
};

function writeResult(action: string, eventId: string): GitHubWriteResult {
  return {
    ok: true,
    action,
    eventId,
    diagnostics: ["ok"],
    url: "https://github.com/baschwar/ChatGPT---Codex-Coordination-Workflow/issues/999",
    issue: {
      repository: "baschwar/ChatGPT---Codex-Coordination-Workflow",
      number: 999,
      url: "https://github.com/baschwar/ChatGPT---Codex-Coordination-Workflow/issues/999"
    }
  };
}

function mockAdapter(calls: string[]): GitHubWriteAdapter {
  return {
    async createIssue(input) {
      calls.push(`create:${input.repository}:${input.title}:${input.labels.join(",")}:${input.body.includes(demoArtifactMarker)}`);
      return writeResult("CREATE_ISSUE", input.eventId);
    },
    async addLabels(input) {
      calls.push(`add:${input.issueNumber}:${input.labels.join(",")}`);
      return writeResult("ADD_LABEL", input.eventId);
    },
    async removeLabels(input) {
      calls.push(`remove:${input.issueNumber}:${input.labels.join(",")}`);
      return writeResult("REMOVE_LABEL", input.eventId);
    },
    async postComment(input) {
      calls.push(`comment:${input.issueNumber}:${input.body}`);
      return writeResult("POST_HANDOFF_COMMENT", input.eventId);
    },
    async updateIssueState(input) {
      calls.push(`state:${input.issueNumber}:${input.state}`);
      return writeResult("UPDATE_ISSUE_STATE", input.eventId);
    }
  };
}

test("fixture demo completes deterministically with six visible stages", async () => {
  await runDemo({ repoRoot, reset: true });
  const result = await runDemo({ repoRoot, fixture: true });

  assert.equal(result.valid, true);
  assert.equal(result.mode, "fixture");
  assert.deepEqual(result.steps.map((step) => step.title), [
    "Approved demo directive",
    "Worker pickup",
    "Implementation handoff",
    "Review correction",
    "Corrected handoff",
    "Manual validation gate"
  ]);
});

test("fixture demo write event IDs are idempotent", async () => {
  await runDemo({ repoRoot, reset: true });
  const result = await runDemo({ repoRoot, fixture: true });
  const workerPickup = result.steps.find((step) => step.title === "Worker pickup");

  assert.deepEqual(workerPickup?.evidence.replayStatuses, ["skipped", "skipped"]);
});

test("fixture demo routes older correction and newer review-ready handoff correctly", async () => {
  await runDemo({ repoRoot, reset: true });
  const result = await runDemo({ repoRoot, fixture: true });
  const correction = result.steps.find((step) => step.title === "Review correction");
  const corrected = result.steps.find((step) => step.title === "Corrected handoff");

  assert.equal(correction?.nextActor, "worker");
  assert.equal(correction?.evidence.kind, "resume-existing-pr");
  assert.equal(corrected?.nextActor, "thinker");
  assert.equal(corrected?.evidence.kind, "chat-review-ready");
});

test("fixture demo pauses at a human gate and does not auto-resume", async () => {
  await runDemo({ repoRoot, reset: true });
  const result = await runDemo({ repoRoot, fixture: true });
  const humanGate = result.steps.find((step) => step.title === "Manual validation gate");

  assert.equal(humanGate?.nextActor, "human");
  assert.equal(humanGate?.evidence.sessionStatus, "paused");
  assert.equal(humanGate?.evidence.humanGate, "manual-validation-required");
});

test("fixture demo completion requires explicit resume approval", async () => {
  await runDemo({ repoRoot, reset: true });
  await runDemo({ repoRoot, fixture: true });
  const result = await runDemo({ repoRoot, fixture: true, resume: true });

  assert.equal(result.valid, false);
  assert.equal(result.steps[0]?.title, "Resume blocked");
  assert.match(result.diagnostics.join("\n"), /Explicit demo resume approval required/);
});

test("fixture demo explicit resume records completion and replays idempotently without merge", async () => {
  await runDemo({ repoRoot, reset: true });
  await runDemo({ repoRoot, fixture: true });
  const first = await runDemo({ repoRoot, fixture: true, resume: true, approvalText: "approved" });
  const persistedAfterFirst = await readFile(path.join(repoRoot, ".chatgpt-coordinator", "demo", "fixture-state.json"), "utf8");
  const second = await runDemo({ repoRoot, fixture: true, resume: true, approvalText: "approved" });
  const persistedAfterSecond = await readFile(path.join(repoRoot, ".chatgpt-coordinator", "demo", "fixture-state.json"), "utf8");
  const firstCompletion = first.steps.find((step) => step.title === "Explicit resume completion");

  assert.equal(first.valid, true);
  assert.equal(firstCompletion?.evidence.mergePerformed, false);
  assert.deepEqual(firstCompletion?.evidence.completionStatuses, ["succeeded"]);
  assert.equal(second.valid, true);
  assert.equal(second.steps.filter((step) => step.title === "Explicit resume completion").length, 1);
  assert.equal(JSON.parse(persistedAfterSecond).steps.filter((step: { title: string }) => step.title === "Explicit resume completion").length, 1);
  assert.equal(persistedAfterSecond, persistedAfterFirst);
});

test("live demo write mode refuses missing or mismatched repositories", async () => {
  const calls: string[] = [];
  const missing = await runDemo({ repoRoot, executeWrites: true });
  const mismatched = await runDemo({ repoRoot, repository: "example/other", executeWrites: true, adapter: mockAdapter(calls) });

  assert.equal(missing.valid, false);
  assert.match(missing.diagnostics.join("\n"), /Usage: demo --repo/);
  assert.equal(mismatched.valid, false);
  assert.match(mismatched.diagnostics.join("\n"), /GIT_WRITE_REPOSITORY_MISMATCH/);
  assert.deepEqual(calls, []);
});

test("live demo write mode invokes only the governed demo issue action for exact repository", async () => {
  await runDemo({ repoRoot, reset: true });
  const calls: string[] = [];
  const first = await runDemo({
    repoRoot,
    repository: "baschwar/ChatGPT---Codex-Coordination-Workflow",
    executeWrites: true,
    adapter: mockAdapter(calls)
  });
  const second = await runDemo({
    repoRoot,
    repository: "baschwar/ChatGPT---Codex-Coordination-Workflow",
    executeWrites: true,
    adapter: mockAdapter(calls)
  });

  assert.equal(first.valid, true);
  assert.equal(first.writeResults[0]?.action, "CREATE_ISSUE");
  assert.equal(first.writeResults[0]?.status, "succeeded");
  assert.deepEqual(calls, [
    "create:baschwar/ChatGPT---Codex-Coordination-Workflow:Coordinator demo artifact (non-production)::true"
  ]);
  assert.equal(second.valid, true);
  assert.equal(second.writeResults[0]?.status, "skipped");
});

test("demo artifacts are excluded from normal production pickup", () => {
  const result = discoverRepositoryWork({
    repository: "example/repo",
    labels,
    issues: [
      {
        number: 12,
        title: "Demo artifact",
        state: "OPEN",
        labels: ["codex-ready"],
        body: `${demoArtifactMarker}\nDemo issue.`
      }
    ],
    pullRequests: []
  });

  assert.equal(result.kind, "non-actionable-artifact");
  assert.equal(result.nextActor, "none");
});

test("demo reset returns local demo state to a known clean state", async () => {
  await runDemo({ repoRoot, fixture: true });
  const result = await runDemo({ repoRoot, reset: true });
  const output = await readFile(path.join(repoRoot, "examples", "demo", "DEMO_OUTPUT.md"), "utf8");

  assert.equal(result.valid, true);
  assert.equal(result.mode, "reset");
  assert.match(result.diagnostics.join("\n"), /restored demo output baseline/);
  assert.equal(output, demoOutputBaseline);
});
