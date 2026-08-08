import { decideTaskPickup, type RelatedPullRequest, type TaskPickupDecision, type TaskWorkflowLabels } from "./state.js";

export type CycleOutcome = "ACTION" | "HUMAN" | "NPF";
export type SessionStatus = "active" | "paused";
export type ActorRole = "thinker" | "worker" | "human" | "none";
export type HumanStopReason = "approval-required" | "manual-validation-required" | "decision-required" | "blocked" | "complete";

export interface WorkflowIssue {
  number: number;
  title: string;
  labels: string[];
  eventId?: string;
  nonActionable?: boolean;
  relatedPullRequests?: RelatedPullRequest[];
  hasCodingCorrectionRequest?: boolean;
}

export interface WorkflowRepositorySnapshot {
  repository: string;
  eventId?: string;
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
  repository?: string;
  activeIssueNumber?: number;
  activePullRequest?: RelatedPullRequest;
  nextActor?: ActorRole;
  lastMeaningfulActivityAt?: string;
  inactivityTimeoutMinutes?: number;
  currentHumanGate?: HumanStopReason;
  lastProcessedEventId?: string;
}

export interface CycleDecision {
  repository: string;
  eventId: string;
  explicitEventId?: string;
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

export function createSessionConfig(pollIntervalMinutes: number, inactivityTimeoutMinutes: number): SessionConfig {
  return {
    pollIntervalMinutes,
    npfPauseThreshold: Math.max(1, Math.ceil(inactivityTimeoutMinutes / pollIntervalMinutes))
  };
}

export function createDurableSessionState(options: {
  repository: string;
  inactivityTimeoutMinutes: number;
  timestamp?: string;
}): SessionState {
  const state: SessionState = {
    consecutiveNpf: 0,
    status: "active",
    repository: options.repository,
    nextActor: "none",
    inactivityTimeoutMinutes: options.inactivityTimeoutMinutes
  };

  if (options.timestamp) {
    state.lastMeaningfulActivityAt = options.timestamp;
  }

  return state;
}

function isDurableSessionState(state: SessionState): boolean {
  return state.repository !== undefined || state.nextActor !== undefined || state.inactivityTimeoutMinutes !== undefined;
}

function humanGateForDecision(decision: CycleDecision): HumanStopReason {
  if (decision.reason === "manual-validation-awaiting-human") {
    return "manual-validation-required";
  }

  if (decision.reason === "conflicting-workflow-labels") {
    return "decision-required";
  }

  return "blocked";
}

function structuralPullRequestId(pullRequest: RelatedPullRequest | undefined): string {
  if (!pullRequest) {
    return "pr:none";
  }

  return `pr:${pullRequest.state}:${pullRequest.url ?? "url:none"}:${pullRequest.branch ?? "branch:none"}`;
}

function issueStructuralEventId(issue: WorkflowIssue | undefined): string {
  if (!issue) {
    return "issue:none";
  }

  const pullRequests = issue.relatedPullRequests?.map(structuralPullRequestId).sort().join(",") ?? "prs:none";
  return `issue:${issue.number}:labels:${[...issue.labels].sort().join(",")}:correction:${issue.hasCodingCorrectionRequest === true}:prs:${pullRequests}`;
}

function explicitEventIdFor(snapshot: WorkflowRepositorySnapshot, issue: WorkflowIssue | undefined, pullRequest: RelatedPullRequest | undefined): string | undefined {
  return pullRequest?.eventId ?? issue?.eventId ?? snapshot.eventId;
}

function eventContextFor(snapshot: WorkflowRepositorySnapshot, issue: WorkflowIssue | undefined, pullRequest: RelatedPullRequest | undefined): Pick<CycleDecision, "eventId" | "explicitEventId"> {
  const explicitEventId = explicitEventIdFor(snapshot, issue, pullRequest);
  const context: Pick<CycleDecision, "eventId" | "explicitEventId"> = {
    eventId: explicitEventId ?? `${snapshot.repository}|${issueStructuralEventId(issue)}|${structuralPullRequestId(pullRequest)}`
  };

  if (explicitEventId !== undefined) {
    context.explicitEventId = explicitEventId;
  }

  return context;
}

function withDecisionContext(state: SessionState, decision: CycleDecision, timestamp: string, meaningfulActivity: boolean): SessionState {
  if (!isDurableSessionState(state)) {
    return state;
  }

  const next: SessionState = {
    ...state,
    repository: decision.repository,
    lastProcessedEventId: decision.eventId
  };

  if (decision.issue) {
    next.activeIssueNumber = decision.issue.number;
  }

  if (decision.pickup.pullRequest) {
    next.activePullRequest = decision.pickup.pullRequest;
  }

  if (decision.outcome === "ACTION") {
    next.nextActor = "worker";
    next.lastMeaningfulActivityAt = timestamp;
    delete next.currentHumanGate;
  } else if (decision.outcome === "HUMAN") {
    next.nextActor = "human";
    next.currentHumanGate = humanGateForDecision(decision);
  } else if (decision.outcome === "NPF") {
    next.nextActor = "none";
    if (meaningfulActivity) {
      next.lastMeaningfulActivityAt = timestamp;
    }
  }

  return next;
}

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
        ...eventContextFor(snapshot, issue, undefined),
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
        ...eventContextFor(snapshot, issue, pickup.pullRequest),
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
        ...eventContextFor(snapshot, issue, pickup.pullRequest),
        issue,
        pickup,
        outcome: "HUMAN",
        reason: pickup.reason,
        diagnostics
      };
    }
  }

  const firstIssue = snapshot.issues[0];
  const pickup: TaskPickupDecision = firstIssue ? decideTaskPickup(firstIssue, labels) : { action: "wait", reason: "not-in-implementation-queue" };
  const decision: CycleDecision = {
    repository: snapshot.repository,
    ...eventContextFor(snapshot, firstIssue, pickup.pullRequest),
    pickup,
    outcome: "NPF",
    reason: firstIssue ? "no-actionable-workflow-state" : "no-eligible-open-work",
    diagnostics
  };

  if (firstIssue) {
    decision.issue = firstIssue;
  }

  return decision;
}

export function applyCycleOutcome(
  state: SessionState,
  decision: CycleDecision,
  config: SessionConfig,
  timestamp = new Date().toISOString()
): SessionState {
  if (decision.outcome === "ACTION") {
    return withDecisionContext({ ...state, consecutiveNpf: 0, status: "active" }, decision, timestamp, true);
  }

  if (decision.outcome === "HUMAN") {
    return withDecisionContext({ ...state, consecutiveNpf: state.consecutiveNpf, status: "paused" }, decision, timestamp, false);
  }

  const hasNewMeaningfulActivity =
    isDurableSessionState(state) && decision.explicitEventId !== undefined && state.lastProcessedEventId !== decision.eventId;

  if (hasNewMeaningfulActivity) {
    return withDecisionContext({ ...state, consecutiveNpf: 0, status: "active" }, decision, timestamp, true);
  }

  const consecutiveNpf = state.consecutiveNpf + 1;
  return withDecisionContext({
    ...state,
    consecutiveNpf,
    status: consecutiveNpf >= config.npfPauseThreshold ? "paused" : "active"
  }, decision, timestamp, false);
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
