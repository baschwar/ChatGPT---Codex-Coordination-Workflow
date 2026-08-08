import { decideTaskPickup, type RelatedPullRequest, type TaskPickupDecision, type TaskWorkflowLabels } from "./state.js";

export type CycleOutcome = "ACTION" | "HUMAN" | "NPF";
export type SessionStatus = "active" | "paused";

export interface WorkflowIssue {
  number: number;
  title: string;
  labels: string[];
  relatedPullRequests?: RelatedPullRequest[];
  hasCodingCorrectionRequest?: boolean;
}

export interface WorkflowRepositorySnapshot {
  repository: string;
  issues: WorkflowIssue[];
  repositoryLabels?: string[];
}

export interface SessionConfig {
  pollIntervalMinutes: number;
  npfPauseThreshold: number;
}

export interface SessionState {
  consecutiveNpf: number;
  status: SessionStatus;
}

export interface CycleDecision {
  repository: string;
  issue?: WorkflowIssue;
  pickup: TaskPickupDecision;
  outcome: CycleOutcome;
  reason: string;
  diagnostics: string[];
}

export interface CycleAuditEvent {
  timestamp: string;
  repository: string;
  issueNumber?: number;
  pullRequest?: RelatedPullRequest;
  decision: TaskPickupDecision;
  outcome: CycleOutcome;
  reason: string;
  npfBefore: number;
  npfAfter: number;
  sessionStatus: SessionStatus;
  dryRun: boolean;
  diagnostics: string[];
}

export const defaultSessionConfig: SessionConfig = {
  pollIntervalMinutes: 10,
  npfPauseThreshold: 6
};

function countWorkflowLabels(issue: WorkflowIssue, labels: TaskWorkflowLabels): number {
  const workflowLabels = new Set([
    labels.implementation_ready,
    labels.implementation_in_progress,
    labels.manual_validation,
    labels.review_ready
  ]);

  return issue.labels.filter((label) => workflowLabels.has(label)).length;
}

export function findMissingConfiguredLabels(repositoryLabels: string[] | undefined, labels: TaskWorkflowLabels): string[] {
  if (!repositoryLabels) {
    return [];
  }

  const availableLabels = new Set(repositoryLabels);
  return [
    labels.implementation_ready,
    labels.implementation_in_progress,
    labels.manual_validation,
    labels.review_ready
  ].filter((label) => !availableLabels.has(label));
}

export function decideCycle(snapshot: WorkflowRepositorySnapshot, labels: TaskWorkflowLabels): CycleDecision {
  const diagnostics = findMissingConfiguredLabels(snapshot.repositoryLabels, labels).map(
    (label) => `Configured workflow label is missing from repository: ${label}`
  );

  for (const issue of snapshot.issues) {
    if (countWorkflowLabels(issue, labels) > 1) {
      return {
        repository: snapshot.repository,
        issue,
        pickup: { action: "wait", reason: "not-in-implementation-queue" },
        outcome: "HUMAN",
        reason: "conflicting-workflow-labels",
        diagnostics
      };
    }
  }

  for (const issue of snapshot.issues) {
    const pickup = decideTaskPickup(issue, labels);

    if (pickup.action === "claim-and-branch" || pickup.action === "resume-open-pr" || pickup.action === "resume-correction") {
      return {
        repository: snapshot.repository,
        issue,
        pickup,
        outcome: "ACTION",
        reason: pickup.reason,
        diagnostics
      };
    }

    if (pickup.reason === "manual-validation-awaiting-human") {
      return {
        repository: snapshot.repository,
        issue,
        pickup,
        outcome: "HUMAN",
        reason: pickup.reason,
        diagnostics
      };
    }
  }

  const firstIssue = snapshot.issues[0];
  const decision: CycleDecision = {
    repository: snapshot.repository,
    pickup: firstIssue ? decideTaskPickup(firstIssue, labels) : { action: "wait", reason: "not-in-implementation-queue" },
    outcome: "NPF",
    reason: firstIssue ? "no-actionable-workflow-state" : "no-eligible-open-work",
    diagnostics
  };

  if (firstIssue) {
    decision.issue = firstIssue;
  }

  return decision;
}

export function applyCycleOutcome(state: SessionState, decision: CycleDecision, config: SessionConfig): SessionState {
  if (decision.outcome === "ACTION") {
    return { consecutiveNpf: 0, status: "active" };
  }

  if (decision.outcome === "HUMAN") {
    return { consecutiveNpf: state.consecutiveNpf, status: "paused" };
  }

  const consecutiveNpf = state.consecutiveNpf + 1;
  return {
    consecutiveNpf,
    status: consecutiveNpf >= config.npfPauseThreshold ? "paused" : "active"
  };
}

export function createCycleAuditEvent(
  decision: CycleDecision,
  before: SessionState,
  after: SessionState,
  dryRun: boolean,
  timestamp = new Date().toISOString()
): CycleAuditEvent {
  const event: CycleAuditEvent = {
    timestamp,
    repository: decision.repository,
    decision: decision.pickup,
    outcome: decision.outcome,
    reason: decision.reason,
    npfBefore: before.consecutiveNpf,
    npfAfter: after.consecutiveNpf,
    sessionStatus: after.status,
    dryRun,
    diagnostics: decision.diagnostics
  };

  if (decision.issue) {
    event.issueNumber = decision.issue.number;
  }

  if (decision.pickup.pullRequest) {
    event.pullRequest = decision.pickup.pullRequest;
  }

  return event;
}

export function runCycle(
  snapshot: WorkflowRepositorySnapshot,
  labels: TaskWorkflowLabels,
  state: SessionState,
  config: SessionConfig = defaultSessionConfig,
  dryRun = true
): { decision: CycleDecision; state: SessionState; audit: CycleAuditEvent } {
  const decision = decideCycle(snapshot, labels);
  const nextState = applyCycleOutcome(state, decision, config);
  return {
    decision,
    state: nextState,
    audit: createCycleAuditEvent(decision, state, nextState, dryRun)
  };
}
