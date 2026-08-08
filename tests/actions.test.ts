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
import { decideCycle, type CycleDecision } from "../packages/core/src/session.js";
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

function mockAdapter(calls: string[], fail: Partial<Record<"create" | "add" | "remove" | "comment" | "state", boolean>> = {}): GitHubWriteAdapter {
  return {
    async createIssue(input) {
      calls.push(`create:${input.title}`);
      if (fail.create) {
        return { ok: false, action: "CREATE_ISSUE", eventId: input.eventId, diagnostics: ["create failed"] };
      }
      return writeResult("CREATE_ISSUE", input.eventId, "https://github.com/example/repo/issues/9");
    },
    async addLabels(input) {
      calls.push(`add:${input.issueNumber}:${input.labels.join(",")}`);
      if (fail.add) {
        return { ok: false, action: "ADD_LABEL", eventId: input.eventId, diagnostics: ["add failed"] };
      }
      return writeResult("ADD_LABEL", input.eventId);
    },
    async removeLabels(input) {
      calls.push(`remove:${input.issueNumber}:${input.labels.join(",")}`);
      if (fail.remove) {
        return { ok: false, action: "REMOVE_LABEL", eventId: input.eventId, diagnostics: ["remove failed"] };
      }
      return writeResult("REMOVE_LABEL", input.eventId);
    },
    async postComment(input) {
      calls.push(`comment:${input.issueNumber}:${input.body}`);
      if (fail.comment) {
        return { ok: false, action: "POST_HANDOFF_COMMENT", eventId: input.eventId, diagnostics: ["comment failed"] };
      }
      return writeResult("POST_HANDOFF_COMMENT", input.eventId, "https://github.com/example/repo/issues/9#issuecomment-1");
    },
    async updateIssueState(input) {
      calls.push(`state:${input.issueNumber}:${input.state}`);
      if (fail.state) {
        return { ok: false, action: "UPDATE_ISSUE_STATE", eventId: input.eventId, diagnostics: ["state failed"] };
      }
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

  assert.deepEqual(actions.map((action) => action.type), ["ADD_LABEL", "REMOVE_LABEL", "POST_HANDOFF_COMMENT"]);
});

test("ready-labeled non-actionable artifacts produce no claim or write actions", () => {
  const decision = decideCycle(
    {
      repository: "example/repo",
      issues: [{ number: 7, title: "Smoke evidence", labels: ["codex-ready"], nonActionable: true }]
    },
    labels
  );
  const actions = actionsForCycleDecision({ decision, labels });

  assert.equal(decision.outcome, "NPF");
  assert.equal(decision.pickup.reason, "non-actionable-artifact");
  assert.deepEqual(actions.map((action) => action.type), ["NO_ACTION"]);
});

test("MARK_REVIEW_READY performs add/remove/comment sequence", async () => {
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
  assert.deepEqual(calls, ["add:6:chat-review-ready", "remove:6:codex-in-progress", "comment:6:CHAT REVIEW READY"]);
  assert.equal(result.results[0]?.eventId, "review-ready:add-review-ready");
  assert.equal(result.results[1]?.eventId, "review-ready:remove-in-progress");
});

test("MARK_REVIEW_READY stops when the first substep fails", async () => {
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
    adapter: mockAdapter(calls, { add: true })
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.status, "failed");
  assert.deepEqual(calls, ["add:6:chat-review-ready"]);
});

test("MARK_REVIEW_READY resumes after a partial transition", async () => {
  const firstCalls: string[] = [];
  const first = await executeCoordinatorAction({
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
    adapter: mockAdapter(firstCalls, { remove: true })
  });
  const secondCalls: string[] = [];
  const second = await executeCoordinatorAction({
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
    state: first.state,
    adapter: mockAdapter(secondCalls)
  });

  assert.deepEqual(firstCalls, ["add:6:chat-review-ready", "remove:6:codex-in-progress"]);
  assert.equal(first.results[0]?.status, "succeeded");
  assert.equal(first.results[1]?.status, "failed");
  assert.deepEqual(secondCalls, ["remove:6:codex-in-progress", "comment:6:CHAT REVIEW READY"]);
  assert.equal(second.results[0]?.status, "skipped");
  assert.equal(second.results[1]?.status, "succeeded");
  assert.equal(second.results[2]?.status, "succeeded");
});
