import test from "node:test";
import assert from "node:assert/strict";
import { decideTaskPickup, plannedStateTransitions, taskStates } from "../packages/core/src/state.js";

const labels = {
  implementation_ready: "codex-ready",
  implementation_in_progress: "codex-in-progress",
  manual_validation: "manual-validation",
  review_ready: "chat-review-ready"
};

test("manual validation is a first-class task state", () => {
  assert.equal(taskStates.includes("manual-validation"), true);
});

test("manual validation can route to implementation or review", () => {
  assert.deepEqual(
    plannedStateTransitions.find((transition) => transition.from === "in-progress" && transition.to === "manual-validation"),
    { from: "in-progress", to: "manual-validation", requiresHumanApproval: false }
  );
  assert.deepEqual(
    plannedStateTransitions.find((transition) => transition.from === "manual-validation" && transition.to === "in-progress"),
    { from: "manual-validation", to: "in-progress", requiresHumanApproval: false }
  );
  assert.deepEqual(
    plannedStateTransitions.find((transition) => transition.from === "manual-validation" && transition.to === "chat-review-ready"),
    { from: "manual-validation", to: "chat-review-ready", requiresHumanApproval: true }
  );
});

test("rejected chat review returns to the implementation queue", () => {
  assert.deepEqual(
    plannedStateTransitions.find((transition) => transition.from === "chat-review-ready" && transition.to === "codex-ready"),
    { from: "chat-review-ready", to: "codex-ready", requiresHumanApproval: false }
  );
  assert.equal(
    plannedStateTransitions.some((transition) => transition.from === "changes-requested" && transition.to === "in-progress"),
    false
  );
});

test("pickup claims a new ready issue when no open PR exists", () => {
  assert.deepEqual(decideTaskPickup({ labels: ["codex-ready"] }, labels), {
    action: "claim-and-branch",
    reason: "new-ready-issue"
  });
});

test("pickup resumes a previously claimed ready issue with an open PR", () => {
  const pullRequest = { state: "open" as const, branch: "codex/issue-14-fix", url: "https://example.invalid/pr/15" };

  assert.deepEqual(decideTaskPickup({ labels: ["codex-ready"], relatedPullRequests: [pullRequest] }, labels), {
    action: "resume-open-pr",
    reason: "ready-issue-has-open-pr",
    pullRequest
  });
});

test("pickup waits on in-progress and review-ready tasks", () => {
  assert.deepEqual(decideTaskPickup({ labels: ["codex-in-progress"] }, labels), {
    action: "wait",
    reason: "implementation-already-in-progress"
  });
  assert.deepEqual(decideTaskPickup({ labels: ["chat-review-ready"] }, labels), {
    action: "wait",
    reason: "chat-review-awaiting-review"
  });
});

test("pickup waits on manual validation unless coding correction is requested", () => {
  const pullRequest = { state: "open" as const, branch: "codex/issue-14-fix" };

  assert.deepEqual(decideTaskPickup({ labels: ["manual-validation"], relatedPullRequests: [pullRequest] }, labels), {
    action: "wait",
    reason: "manual-validation-awaiting-human",
    pullRequest
  });
  assert.deepEqual(
    decideTaskPickup({ labels: ["manual-validation"], relatedPullRequests: [pullRequest], hasCodingCorrectionRequest: true }, labels),
    {
      action: "resume-correction",
      reason: "manual-validation-coding-correction",
      pullRequest
    }
  );
});
