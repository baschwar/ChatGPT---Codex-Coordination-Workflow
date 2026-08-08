export const taskStates = [
  "exploratory",
  "awaiting-approval",
  "approved",
  "codex-ready",
  "in-progress",
  "blocked",
  "manual-validation",
  "chat-review-ready",
  "changes-requested",
  "human-approval-required",
  "approved-for-merge",
  "complete"
] as const;

export type TaskState = (typeof taskStates)[number];

export interface StateTransition {
  from: TaskState;
  to: TaskState;
  requiresHumanApproval: boolean;
}

export interface TaskWorkflowLabels {
  implementation_ready: string;
  implementation_in_progress: string;
  manual_validation: string;
  review_ready: string;
}

export interface RelatedPullRequest {
  state: "open" | "closed" | "merged";
  branch?: string;
  url?: string;
  eventId?: string;
}

export interface TaskPickupInput {
  labels: string[];
  relatedPullRequests?: RelatedPullRequest[];
  hasCodingCorrectionRequest?: boolean;
}

export type TaskPickupAction = "claim-and-branch" | "resume-open-pr" | "resume-correction" | "wait";

export interface TaskPickupDecision {
  action: TaskPickupAction;
  reason:
    | "new-ready-issue"
    | "ready-issue-has-open-pr"
    | "implementation-already-in-progress"
    | "manual-validation-awaiting-human"
    | "manual-validation-coding-correction"
    | "chat-review-awaiting-review"
    | "not-in-implementation-queue";
  pullRequest?: RelatedPullRequest;
}

function pickupDecision(decision: Omit<TaskPickupDecision, "pullRequest">, pullRequest?: RelatedPullRequest): TaskPickupDecision {
  return pullRequest ? { ...decision, pullRequest } : decision;
}

export const plannedStateTransitions: StateTransition[] = [
  { from: "exploratory", to: "awaiting-approval", requiresHumanApproval: false },
  { from: "awaiting-approval", to: "approved", requiresHumanApproval: true },
  { from: "approved", to: "codex-ready", requiresHumanApproval: true },
  { from: "codex-ready", to: "in-progress", requiresHumanApproval: false },
  { from: "codex-ready", to: "blocked", requiresHumanApproval: false },
  { from: "in-progress", to: "blocked", requiresHumanApproval: false },
  { from: "in-progress", to: "manual-validation", requiresHumanApproval: false },
  { from: "manual-validation", to: "in-progress", requiresHumanApproval: false },
  { from: "manual-validation", to: "chat-review-ready", requiresHumanApproval: true },
  { from: "in-progress", to: "chat-review-ready", requiresHumanApproval: false },
  { from: "chat-review-ready", to: "codex-ready", requiresHumanApproval: false },
  { from: "chat-review-ready", to: "human-approval-required", requiresHumanApproval: false },
  { from: "changes-requested", to: "codex-ready", requiresHumanApproval: false },
  { from: "human-approval-required", to: "approved-for-merge", requiresHumanApproval: true },
  { from: "human-approval-required", to: "complete", requiresHumanApproval: true },
  { from: "approved-for-merge", to: "complete", requiresHumanApproval: true }
];

export function decideTaskPickup(input: TaskPickupInput, labels: TaskWorkflowLabels): TaskPickupDecision {
  const issueLabels = new Set(input.labels);
  const openPullRequest = input.relatedPullRequests?.find((pullRequest) => pullRequest.state === "open");

  if (issueLabels.has(labels.review_ready)) {
    return pickupDecision({ action: "wait", reason: "chat-review-awaiting-review" }, openPullRequest);
  }

  if (issueLabels.has(labels.implementation_in_progress)) {
    return pickupDecision({ action: "wait", reason: "implementation-already-in-progress" }, openPullRequest);
  }

  if (issueLabels.has(labels.manual_validation)) {
    if (input.hasCodingCorrectionRequest) {
      return openPullRequest
        ? { action: "resume-correction", reason: "manual-validation-coding-correction", pullRequest: openPullRequest }
        : { action: "claim-and-branch", reason: "manual-validation-coding-correction" };
    }

    return pickupDecision({ action: "wait", reason: "manual-validation-awaiting-human" }, openPullRequest);
  }

  if (issueLabels.has(labels.implementation_ready)) {
    return openPullRequest
      ? { action: "resume-open-pr", reason: "ready-issue-has-open-pr", pullRequest: openPullRequest }
      : { action: "claim-and-branch", reason: "new-ready-issue" };
  }

  return pickupDecision({ action: "wait", reason: "not-in-implementation-queue" }, openPullRequest);
}
