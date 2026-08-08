import test from "node:test";
import assert from "node:assert/strict";
import {
  actionsForCycleDecision,
  createWriteSessionState,
  executeCoordinatorAction,
  isActionAllowed,
  type CoordinatorAction,
  type MutationPolicy
} from "../packages/core/src/actions.js";
import type { CycleDecision } from "../packages/core/src/session.js";
import type { GitHubWriteAdapter, GitHubWriteResult } from "../packages/github-adapter/src/types.js";

const labels = {
  implementation_ready: "codex-ready",
  implementation_in_progress: "codex-in-progress",
  manual_validation: "manual-validation",
  review_ready: "chat-review-ready"
};

function writeResult(action: string, eventId: string, url?: string): GitHubWriteResult {
  return {
    ok: true,
    action,
    eventId,
    diagnostics: [],
    ...(url ? { url } : {}),
    ...(url ? { issue: { repository: "example/repo", number: 9, url } } : {})
  };
}

function mockAdapter(calls: string[]): GitHubWriteAdapter {
  return {
    async createIssue(input) {
      calls.push(`create:${input.title}`);
      return writeResult("CREATE_ISSUE", input.eventId, "https://github.com/example/repo/issues/9");
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
      return writeResult("POST_HANDOFF_COMMENT", input.eventId, "https://github.com/example/repo/issues/9#issuecomment-1");
    },
    async updateIssueState(input) {
      calls.push(`state:${input.issueNumber}:${input.state}`);
      return writeResult("UPDATE_ISSUE_STATE", input.eventId);
    }
  };
}

test("mutation policy is default deny", () => {
  assert.equal(isActionAllowed(undefined, "CREATE_ISSUE"), false);
  assert.equal(isActionAllowed({ enabled: false, allowed_actions: ["CREATE_ISSUE"] }, "CREATE_ISSUE"), false);
  assert.equal(isActionAllowed({ enabled: true, allowed_actions: [] }, "CREATE_ISSUE"), false);
});

test("configured policy allows only listed writes", () => {
  const policy: MutationPolicy = { enabled: true, allowed_actions: ["CREATE_ISSUE"] };

  assert.equal(isActionAllowed(policy, "CREATE_ISSUE"), true);
  assert.equal(isActionAllowed(policy, "ADD_LABEL"), false);
});

test("executeCoordinatorAction rejects unauthorized writes without adapter calls", async () => {
  const calls: string[] = [];
  const action: CoordinatorAction = {
    type: "CREATE_ISSUE",
    eventId: "event-1",
    repository: "example/repo",
    title: "Test",
    body: "Body",
    labels: ["codex-ready"]
  };
  const result = await executeCoordinatorAction({
    action,
    state: createWriteSessionState(),
    adapter: mockAdapter(calls)
  });

  assert.equal(result.results[0]?.status, "failed");
  assert.match(result.results[0]?.diagnostics[0] ?? "", /does not allow CREATE_ISSUE/);
  assert.deepEqual(calls, []);
});

test("executeCoordinatorAction records successful writes and skips duplicate replay", async () => {
  const calls: string[] = [];
  const action: CoordinatorAction = {
    type: "CREATE_ISSUE",
    eventId: "event-1",
    repository: "example/repo",
    title: "Test",
    body: "Body",
    labels: ["codex-ready"]
  };
  const first = await executeCoordinatorAction({
    action,
    policy: { enabled: true, allowed_actions: ["CREATE_ISSUE"] },
    state: createWriteSessionState(),
    adapter: mockAdapter(calls)
  });
  const second = await executeCoordinatorAction({
    action,
    policy: { enabled: true, allowed_actions: ["CREATE_ISSUE"] },
    state: first.state,
    adapter: mockAdapter(calls)
  });

  assert.equal(first.results[0]?.status, "succeeded");
  assert.equal(second.results[0]?.status, "skipped");
  assert.deepEqual(calls, ["create:Test"]);
});

test("NPF and HUMAN decisions produce quiet non-write actions", () => {
  const npf: CycleDecision = {
    repository: "example/repo",
    eventId: "npf",
    pickup: { action: "wait", reason: "not-in-implementation-queue" },
    outcome: "NPF",
    reason: "no-eligible-open-work",
    diagnostics: []
  };
  const human: CycleDecision = {
    ...npf,
    eventId: "human",
    outcome: "HUMAN",
    reason: "manual-validation-awaiting-human"
  };

  assert.equal(actionsForCycleDecision({ decision: npf, labels })[0]?.type, "NO_ACTION");
  assert.equal(actionsForCycleDecision({ decision: human, labels })[0]?.type, "PAUSE_FOR_HUMAN");
});

test("ACTION claim decision creates label transition actions", () => {
  const decision: CycleDecision = {
    repository: "example/repo",
    eventId: "claim",
    issue: { number: 6, title: "Ready", labels: ["codex-ready"] },
    pickup: { action: "claim-and-branch", reason: "new-ready-issue" },
    outcome: "ACTION",
    reason: "new-ready-issue",
    diagnostics: []
  };
  const actions = actionsForCycleDecision({ decision, labels, handoffBody: "Claimed." });

  assert.deepEqual(actions.map((action) => action.type), ["REMOVE_LABEL", "ADD_LABEL", "POST_HANDOFF_COMMENT"]);
});

test("MARK_REVIEW_READY performs remove/add/comment sequence", async () => {
  const calls: string[] = [];
  const result = await executeCoordinatorAction({
    action: {
      type: "MARK_REVIEW_READY",
      eventId: "review-ready",
      repository: "example/repo",
      issueNumber: 6,
      inProgressLabel: "codex-in-progress",
      reviewReadyLabel: "chat-review-ready",
      commentBody: "CHAT REVIEW READY"
    },
    policy: { enabled: true, allowed_actions: ["MARK_REVIEW_READY"] },
    state: createWriteSessionState(),
    adapter: mockAdapter(calls)
  });

  assert.equal(result.results.length, 3);
  assert.deepEqual(calls, ["remove:6:codex-in-progress", "add:6:chat-review-ready", "comment:6:CHAT REVIEW READY"]);
});
