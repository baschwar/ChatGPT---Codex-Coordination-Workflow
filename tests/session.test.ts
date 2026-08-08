import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  applyCycleOutcome,
  createDurableSessionState,
  createSessionConfig,
  decideCycle,
  defaultSessionConfig,
  findMissingConfiguredLabels,
  runCycle,
  type CycleOutcome,
  type SessionState,
  type WorkflowRepositorySnapshot
} from "../packages/core/src/session.js";
import type { TaskPickupAction } from "../packages/core/src/state.js";

const labels = {
  implementation_ready: "codex-ready",
  implementation_in_progress: "codex-in-progress",
  manual_validation: "manual-validation",
  review_ready: "chat-review-ready"
};

interface ScenarioFixture {
  name: string;
  snapshot: WorkflowRepositorySnapshot;
  expectedOutcome: CycleOutcome;
  expectedAction: TaskPickupAction;
  expectedReason: string;
}

async function loadScenarios(): Promise<ScenarioFixture[]> {
  const raw = await readFile(path.join(process.cwd(), "tests", "fixtures", "workflow-scenarios.json"), "utf8");
  return JSON.parse(raw) as ScenarioFixture[];
}

test("fixture scenarios cover beta decision outcomes", async () => {
  const scenarios = await loadScenarios();

  assert.equal(scenarios.length, 8);

  for (const scenario of scenarios) {
    const decision = decideCycle(scenario.snapshot, labels);
    assert.equal(decision.outcome, scenario.expectedOutcome, scenario.name);
    assert.equal(decision.pickup.action, scenario.expectedAction, scenario.name);
    assert.equal(decision.reason, scenario.expectedReason, scenario.name);
  }
});

test("ACTION resets the NPF counter", () => {
  const decision = decideCycle({ repository: "example/repo", issues: [{ number: 1, title: "Ready", labels: ["codex-ready"] }] }, labels);
  const nextState = applyCycleOutcome({ consecutiveNpf: 5, status: "active" }, decision, defaultSessionConfig);

  assert.deepEqual(nextState, { consecutiveNpf: 0, status: "active" });
});

test("NPF increments the counter and pauses after the threshold", () => {
  const decision = decideCycle({ repository: "example/repo", issues: [] }, labels);
  let state: SessionState = { consecutiveNpf: 0, status: "active" };

  for (let cycle = 1; cycle <= 5; cycle += 1) {
    state = applyCycleOutcome(state, decision, defaultSessionConfig);
    assert.equal(state.consecutiveNpf, cycle);
    assert.equal(state.status, "active");
  }

  state = applyCycleOutcome(state, decision, defaultSessionConfig);
  assert.deepEqual(state, { consecutiveNpf: 6, status: "paused" });
});

test("HUMAN pauses immediately without incrementing NPF", () => {
  const decision = decideCycle(
    { repository: "example/repo", issues: [{ number: 4, title: "Manual", labels: ["manual-validation"] }] },
    labels
  );

  assert.deepEqual(applyCycleOutcome({ consecutiveNpf: 3, status: "active" }, decision, defaultSessionConfig), {
    consecutiveNpf: 3,
    status: "paused"
  });
});

test("ACTION after prior NPF cycles resets the inactivity sequence", () => {
  const npfDecision = decideCycle({ repository: "example/repo", issues: [] }, labels);
  const actionDecision = decideCycle(
    { repository: "example/repo", issues: [{ number: 1, title: "Ready", labels: ["codex-ready"] }] },
    labels
  );

  const afterNpf = applyCycleOutcome({ consecutiveNpf: 0, status: "active" }, npfDecision, defaultSessionConfig);
  assert.equal(afterNpf.consecutiveNpf, 1);
  assert.deepEqual(applyCycleOutcome(afterNpf, actionDecision, defaultSessionConfig), {
    consecutiveNpf: 0,
    status: "active"
  });
});

test("runCycle creates a compact audit event", () => {
  const result = runCycle(
    { repository: "example/repo", issues: [{ number: 1, title: "Ready", labels: ["codex-ready"] }] },
    labels,
    { consecutiveNpf: 2, status: "active" },
    defaultSessionConfig,
    true
  );

  assert.equal(result.audit.repository, "example/repo");
  assert.equal(result.audit.issueNumber, 1);
  assert.equal(result.audit.outcome, "ACTION");
  assert.equal(result.audit.npfBefore, 2);
  assert.equal(result.audit.npfAfter, 0);
  assert.equal(result.audit.dryRun, true);
});

test("missing configured labels produce setup diagnostics", () => {
  assert.deepEqual(findMissingConfiguredLabels(["enhancement", "codex-ready"], labels), [
    "codex-in-progress",
    "manual-validation",
    "chat-review-ready"
  ]);
});

test("durable session state records actionable workflow context", () => {
  const state = createDurableSessionState({
    repository: "example/repo",
    inactivityTimeoutMinutes: 60,
    timestamp: "2026-08-08T00:00:00.000Z"
  });
  const decision = decideCycle(
    {
      repository: "example/repo",
      issues: [
        {
          number: 1,
          title: "Ready",
          labels: ["codex-ready"],
          relatedPullRequests: [{ state: "open", branch: "codex/issue-1", url: "https://github.com/example/repo/pull/1" }]
        }
      ]
    },
    labels
  );
  const next = applyCycleOutcome(state, decision, defaultSessionConfig, "2026-08-08T00:10:00.000Z");

  assert.equal(next.repository, "example/repo");
  assert.equal(next.activeIssueNumber, 1);
  assert.equal(next.activePullRequest?.url, "https://github.com/example/repo/pull/1");
  assert.equal(next.nextActor, "worker");
  assert.equal(next.lastMeaningfulActivityAt, "2026-08-08T00:10:00.000Z");
  assert.equal(next.consecutiveNpf, 0);
});

test("durable session state pauses on human gates without losing workflow state", () => {
  const state = createDurableSessionState({ repository: "example/repo", inactivityTimeoutMinutes: 60 });
  const decision = decideCycle(
    { repository: "example/repo", issues: [{ number: 4, title: "Manual", labels: ["manual-validation"] }] },
    labels
  );
  const next = applyCycleOutcome(state, decision, defaultSessionConfig, "2026-08-08T00:10:00.000Z");

  assert.equal(next.status, "paused");
  assert.equal(next.activeIssueNumber, 4);
  assert.equal(next.nextActor, "human");
  assert.equal(next.currentHumanGate, "manual-validation-required");
});

test("meaningful activity timeout derives the NPF pause threshold", () => {
  const config = createSessionConfig(15, 60);
  let state: SessionState = createDurableSessionState({ repository: "example/repo", inactivityTimeoutMinutes: 60 });
  const decision = decideCycle({ repository: "example/repo", issues: [] }, labels);

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    state = applyCycleOutcome(state, decision, config);
    assert.equal(state.status, "active");
  }

  state = applyCycleOutcome(state, decision, config);
  assert.equal(state.consecutiveNpf, 4);
  assert.equal(state.status, "paused");
});
