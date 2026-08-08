import type { ActorRole } from "./session.js";
import type { TaskWorkflowLabels } from "./state.js";

export type DiscoveryResultKind =
  | "new-ready-issue"
  | "resume-existing-pr"
  | "chat-review-ready"
  | "human-gate"
  | "non-actionable-artifact"
  | "no-pending-work";

export type GitHubCheckState = "passing" | "failing" | "pending" | "no-check-runs" | "unknown";

export interface DiscoveryComment {
  id?: string;
  body: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}

export interface DiscoveryReview {
  id?: string;
  state: string;
  body?: string;
  author?: string;
  submittedAt?: string;
  url?: string;
}

export interface DiscoveryIssue {
  number: number;
  title: string;
  state?: "OPEN" | "CLOSED";
  labels: string[];
  body?: string;
  updatedAt?: string;
  comments?: DiscoveryComment[];
}

export interface DiscoveryCheck {
  name: string;
  status?: string;
  conclusion?: string;
  state?: string;
  url?: string;
}

export interface DiscoveryPullRequest {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft?: boolean;
  mergeable?: string;
  headRefName?: string;
  headRefOid?: string;
  url?: string;
  body?: string;
  updatedAt?: string;
  closingIssueNumbers?: number[];
  comments?: DiscoveryComment[];
  reviews?: DiscoveryReview[];
  checks?: DiscoveryCheck[];
}

export interface GovernanceDiscoveryFile {
  path: string;
  exists: boolean;
  bytes?: number;
  excerpt?: string;
}

export interface RepositoryDiscoverySnapshot {
  repository: string;
  labels: TaskWorkflowLabels;
  issues: DiscoveryIssue[];
  pullRequests: DiscoveryPullRequest[];
  governanceFiles?: GovernanceDiscoveryFile[];
  lastProcessedEventId?: string;
}

export interface DiscoveryPullRequestSummary {
  number: number;
  title: string;
  state: DiscoveryPullRequest["state"];
  isDraft?: boolean;
  mergeable?: string;
  headRefName?: string;
  headRefOid?: string;
  url?: string;
  checkState: GitHubCheckState;
  checks: DiscoveryCheck[];
  headChangedSinceLastHandled?: boolean;
}

export interface DiscoveryIssueSummary {
  number: number;
  title: string;
  state?: "OPEN" | "CLOSED";
  labels: string[];
  url?: string;
}

export interface DiscoveryEventSummary {
  id: string;
  source: "issue" | "pull-request" | "review" | "comment" | "check" | "repository";
  summary: string;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}

export interface RepositoryDiscoveryResult {
  kind: DiscoveryResultKind;
  repository: string;
  reason: string;
  nextActor: ActorRole;
  eventId: string;
  issue?: DiscoveryIssueSummary;
  pullRequest?: DiscoveryPullRequestSummary;
  latestEvent?: DiscoveryEventSummary;
  relatedPullRequests?: DiscoveryPullRequestSummary[];
  governanceFiles?: GovernanceDiscoveryFile[];
  diagnostics: string[];
}

interface Candidate {
  priority: number;
  result: RepositoryDiscoveryResult;
}

const nonActionableMarker = /<!--\s*coordinator:non-actionable-artifact\s*-->|\bDo not implement the smoke-test issue as product work\./i;
const correctionPattern = /\b(CHANGES_REQUESTED|changes requested|requested changes|requested corrections|corrections|resume PR|continue beta|continue implementation|coding correction)\b/i;
const reviewReadyPattern = /\bCHAT REVIEW READY\b/i;

type WorkflowEventKind = "correction" | "review-ready";

interface WorkflowEvent extends DiscoveryEventSummary {
  kind: WorkflowEventKind;
}

function issueUrl(repository: string, issueNumber: number): string {
  return `https://github.com/${repository}/issues/${issueNumber}`;
}

function bodyText(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join("\n");
}

export function isNonActionableDiscoveryIssue(issue: Pick<DiscoveryIssue, "body" | "comments">): boolean {
  return nonActionableMarker.test(bodyText(issue.body, ...(issue.comments?.map((comment) => comment.body) ?? [])));
}

function issueSummary(repository: string, issue: DiscoveryIssue): DiscoveryIssueSummary {
  const summary: DiscoveryIssueSummary = {
    number: issue.number,
    title: issue.title,
    labels: issue.labels
  };

  if (issue.state) {
    summary.state = issue.state;
  }

  summary.url = issueUrl(repository, issue.number);
  return summary;
}

function checkStateFor(checks: DiscoveryCheck[] | undefined): GitHubCheckState {
  if (!checks || checks.length === 0) {
    return "no-check-runs";
  }

  if (checks.some((check) => {
    const state = check.state?.toUpperCase();
    return state === "FAILURE" || state === "ERROR";
  })) {
    return "failing";
  }

  if (checks.some((check) => check.conclusion && !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(check.conclusion.toUpperCase()))) {
    return "failing";
  }

  if (checks.some((check) => {
    const state = check.state?.toUpperCase();
    return state === "PENDING" || state === "EXPECTED";
  })) {
    return "pending";
  }

  if (checks.some((check) => check.status && check.status.toUpperCase() !== "COMPLETED")) {
    return "pending";
  }

  if (checks.every((check) => {
    const state = check.state?.toUpperCase();
    if (state) {
      return state === "SUCCESS";
    }

    return !check.conclusion || ["SUCCESS", "SKIPPED", "NEUTRAL"].includes(check.conclusion.toUpperCase());
  })) {
    return "passing";
  }

  return "unknown";
}

function pullRequestSummary(pullRequest: DiscoveryPullRequest, lastHeadSha?: string): DiscoveryPullRequestSummary {
  const checks = pullRequest.checks ?? [];
  const summary: DiscoveryPullRequestSummary = {
    number: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.state,
    checkState: checkStateFor(checks),
    checks
  };

  if (pullRequest.isDraft !== undefined) {
    summary.isDraft = pullRequest.isDraft;
  }
  if (pullRequest.mergeable) {
    summary.mergeable = pullRequest.mergeable;
  }
  if (pullRequest.headRefName) {
    summary.headRefName = pullRequest.headRefName;
  }
  if (pullRequest.headRefOid) {
    summary.headRefOid = pullRequest.headRefOid;
  }
  if (pullRequest.url) {
    summary.url = pullRequest.url;
  }
  if (lastHeadSha && pullRequest.headRefOid) {
    summary.headChangedSinceLastHandled = lastHeadSha !== pullRequest.headRefOid;
  }

  return summary;
}

function issueReferencePattern(issueNumber: number): RegExp {
  return new RegExp(`(?:#${issueNumber}\\b|/(?:issues|pull)/${issueNumber}\\b|\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issueNumber}\\b)`, "i");
}

function branchReferencesIssue(branch: string | undefined, issueNumber: number): boolean {
  if (!branch) {
    return false;
  }

  return new RegExp(`(?:^|[^0-9])(?:issue[-_/]?|#)?${issueNumber}(?:[^0-9]|$)`, "i").test(branch);
}

function issueCommentsReferencePullRequest(issue: DiscoveryIssue, pullRequest: DiscoveryPullRequest): boolean {
  const pullRequestUrl = pullRequest.url;
  if (!pullRequestUrl || !issue.comments) {
    return false;
  }

  return issue.comments.some((comment) => comment.body.includes(pullRequestUrl));
}

function pullRequestReferencesIssue(issue: DiscoveryIssue, pullRequest: DiscoveryPullRequest): boolean {
  if (pullRequest.closingIssueNumbers?.includes(issue.number)) {
    return true;
  }

  if (branchReferencesIssue(pullRequest.headRefName, issue.number)) {
    return true;
  }

  const referencePattern = issueReferencePattern(issue.number);
  if (referencePattern.test(bodyText(pullRequest.body, pullRequest.title))) {
    return true;
  }

  return issueCommentsReferencePullRequest(issue, pullRequest);
}

export function findRelatedPullRequests(issue: DiscoveryIssue, pullRequests: DiscoveryPullRequest[]): DiscoveryPullRequest[] {
  return pullRequests.filter((pullRequest) => pullRequestReferencesIssue(issue, pullRequest));
}

function latestByTime<T extends { updatedAt?: string | undefined; createdAt?: string | undefined; submittedAt?: string | undefined }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt ?? a.submittedAt ?? a.createdAt ?? "");
    const bTime = Date.parse(b.updatedAt ?? b.submittedAt ?? b.createdAt ?? "");
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  })[0];
}

function discoveryEvent(input: {
  id: string;
  source: DiscoveryEventSummary["source"];
  summary: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  url?: string | undefined;
}): DiscoveryEventSummary {
  const event: DiscoveryEventSummary = {
    id: input.id,
    source: input.source,
    summary: input.summary
  };

  if (input.createdAt) {
    event.createdAt = input.createdAt;
  }
  if (input.updatedAt) {
    event.updatedAt = input.updatedAt;
  }
  if (input.url) {
    event.url = input.url;
  }

  return event;
}

function workflowEvent(input: {
  kind: WorkflowEventKind;
  id: string;
  source: DiscoveryEventSummary["source"];
  summary: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  url?: string | undefined;
}): WorkflowEvent {
  return {
    ...discoveryEvent(input),
    kind: input.kind
  };
}

function isCorrectionComment(comment: DiscoveryComment): boolean {
  if (reviewReadyPattern.test(comment.body)) {
    return false;
  }

  return correctionPattern.test(comment.body);
}

function correctionEvents(pullRequest: DiscoveryPullRequest): WorkflowEvent[] {
  const reviewEvents = (pullRequest.reviews ?? [])
    .filter((review) => review.state.toUpperCase() === "CHANGES_REQUESTED" || correctionPattern.test(review.body ?? ""))
    .map((review) => workflowEvent({
      kind: "correction",
      id: review.id ?? `pr:${pullRequest.number}:review:${review.submittedAt ?? "unknown"}`,
      source: "review",
      summary: review.state.toUpperCase() === "CHANGES_REQUESTED" ? "GitHub review requested changes" : "Review body requested corrections",
      createdAt: review.submittedAt,
      updatedAt: review.submittedAt,
      url: review.url
    }));
  const commentEvents = (pullRequest.comments ?? [])
    .filter(isCorrectionComment)
    .map((comment) => workflowEvent({
      kind: "correction",
      id: comment.id ?? `pr:${pullRequest.number}:comment:${comment.updatedAt ?? comment.createdAt ?? "unknown"}`,
      source: "comment",
      summary: "PR comment requested Codex continuation",
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      url: comment.url
    }));

  return [...reviewEvents, ...commentEvents];
}

function reviewReadyEvents(issue: DiscoveryIssue | undefined, pullRequest: DiscoveryPullRequest | undefined): WorkflowEvent[] {
  const issueEvents = issue ? (issue.comments ?? [])
    .filter((comment) => reviewReadyPattern.test(comment.body))
    .map((comment) => workflowEvent({
      kind: "review-ready",
      id: comment.id ?? `issue:${issue.number}:comment:${comment.updatedAt ?? comment.createdAt ?? "unknown"}`,
      source: "comment",
      summary: "Issue handoff comment marked CHAT REVIEW READY",
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      url: comment.url
    })) : [];
  const prEvents = pullRequest ? (pullRequest.comments ?? [])
    .filter((comment) => reviewReadyPattern.test(comment.body))
    .map((comment) => workflowEvent({
      kind: "review-ready",
      id: comment.id ?? `pr:${pullRequest.number}:comment:${comment.updatedAt ?? comment.createdAt ?? "unknown"}`,
      source: "comment",
      summary: "PR handoff comment marked CHAT REVIEW READY",
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      url: comment.url
    })) : [];

  return [...issueEvents, ...prEvents];
}

function latestWorkflowEvent(issue: DiscoveryIssue | undefined, pullRequest: DiscoveryPullRequest): WorkflowEvent | undefined {
  return latestByTime([...correctionEvents(pullRequest), ...reviewReadyEvents(issue, pullRequest)]);
}

function resultEventId(kind: DiscoveryResultKind, repository: string, issue: DiscoveryIssue | undefined, pullRequest: DiscoveryPullRequest | undefined, event: DiscoveryEventSummary | undefined): string {
  return [
    repository,
    kind,
    issue ? `issue:${issue.number}:${issue.updatedAt ?? "unknown"}` : "issue:none",
    pullRequest ? `pr:${pullRequest.number}:head:${pullRequest.headRefOid ?? "unknown"}:updated:${pullRequest.updatedAt ?? "unknown"}` : "pr:none",
    event ? `event:${event.id}:${event.updatedAt ?? event.createdAt ?? "unknown"}` : "event:none"
  ].join("|");
}

function withCommon(result: Omit<RepositoryDiscoveryResult, "repository" | "governanceFiles" | "diagnostics">, snapshot: RepositoryDiscoverySnapshot, diagnostics: string[] = []): RepositoryDiscoveryResult {
  const full: RepositoryDiscoveryResult = {
    ...result,
    repository: snapshot.repository,
    diagnostics
  };

  if (snapshot.governanceFiles) {
    full.governanceFiles = snapshot.governanceFiles;
  }

  return full;
}

function unchangedIfNeeded(result: RepositoryDiscoveryResult, lastProcessedEventId: string | undefined): RepositoryDiscoveryResult {
  if (!lastProcessedEventId || result.eventId !== lastProcessedEventId || result.kind === "no-pending-work") {
    return result;
  }

  return {
    kind: "no-pending-work",
    repository: result.repository,
    reason: "unchanged-event-already-handled",
    nextActor: "none",
    eventId: result.eventId,
    diagnostics: result.diagnostics
  };
}

export function discoverRepositoryWork(snapshot: RepositoryDiscoverySnapshot): RepositoryDiscoveryResult {
  const candidates: Candidate[] = [];
  const openIssues = snapshot.issues.filter((issue) => issue.state !== "CLOSED");
  const openPullRequests = snapshot.pullRequests.filter((pullRequest) => pullRequest.state === "OPEN");

  for (const issue of openIssues) {
    const relatedPullRequests = findRelatedPullRequests(issue, snapshot.pullRequests);
    const openRelatedPullRequests = relatedPullRequests.filter((pullRequest) => pullRequest.state === "OPEN");

    if (openRelatedPullRequests.length > 1) {
      const eventId = resultEventId("human-gate", snapshot.repository, issue, undefined, undefined);
      return unchangedIfNeeded(
        withCommon(
          {
            kind: "human-gate",
            reason: "ambiguous-related-pull-requests",
            nextActor: "human",
            eventId,
            issue: issueSummary(snapshot.repository, issue),
            relatedPullRequests: openRelatedPullRequests.map((pullRequest) => pullRequestSummary(pullRequest))
          },
          snapshot,
          [`Issue #${issue.number} has multiple deterministic open PR associations.`]
        ),
        snapshot.lastProcessedEventId
      );
    }

    const openPullRequest = openRelatedPullRequests[0];
    const nonActionable = isNonActionableDiscoveryIssue(issue);
    const issueLabels = new Set(issue.labels);

    if (nonActionable) {
      candidates.push({
        priority: 60,
        result: withCommon({
          kind: "non-actionable-artifact",
          reason: "explicit-non-actionable-artifact-marker",
          nextActor: "none",
          eventId: resultEventId("non-actionable-artifact", snapshot.repository, issue, openPullRequest, undefined),
          issue: issueSummary(snapshot.repository, issue),
          relatedPullRequests: relatedPullRequests.map((pullRequest) => pullRequestSummary(pullRequest))
        }, snapshot)
      });
      continue;
    }

    if (openPullRequest) {
      const workflowEvent = latestWorkflowEvent(issue, openPullRequest);
      if (workflowEvent?.kind === "correction") {
        candidates.push({
          priority: 10,
          result: withCommon({
            kind: "resume-existing-pr",
            reason: "latest-pr-event-requests-codex-corrections",
            nextActor: "worker",
            eventId: resultEventId("resume-existing-pr", snapshot.repository, issue, openPullRequest, workflowEvent),
            issue: issueSummary(snapshot.repository, issue),
            pullRequest: pullRequestSummary(openPullRequest),
            latestEvent: workflowEvent
          }, snapshot)
        });
        continue;
      }

      if (workflowEvent?.kind === "review-ready") {
        candidates.push({
          priority: 40,
          result: withCommon({
            kind: "chat-review-ready",
            reason: "latest-pr-event-is-chat-review-ready",
            nextActor: "thinker",
            eventId: resultEventId("chat-review-ready", snapshot.repository, issue, openPullRequest, workflowEvent),
            issue: issueSummary(snapshot.repository, issue),
            pullRequest: pullRequestSummary(openPullRequest),
            latestEvent: workflowEvent
          }, snapshot)
        });
        continue;
      }
    }

    if (issueLabels.has(snapshot.labels.implementation_ready)) {
      if (openPullRequest) {
        candidates.push({
          priority: 20,
          result: withCommon({
            kind: "resume-existing-pr",
            reason: "ready-issue-has-open-pr",
            nextActor: "worker",
            eventId: resultEventId("resume-existing-pr", snapshot.repository, issue, openPullRequest, undefined),
            issue: issueSummary(snapshot.repository, issue),
            pullRequest: pullRequestSummary(openPullRequest)
          }, snapshot)
        });
      } else {
        candidates.push({
          priority: 30,
          result: withCommon({
            kind: "new-ready-issue",
            reason: "implementation-ready-label",
            nextActor: "worker",
            eventId: resultEventId("new-ready-issue", snapshot.repository, issue, undefined, undefined),
            issue: issueSummary(snapshot.repository, issue)
          }, snapshot)
        });
      }
      continue;
    }

    const reviewReadyEvent = latestByTime(reviewReadyEvents(issue, openPullRequest));
    if (issueLabels.has(snapshot.labels.review_ready) || reviewReadyEvent) {
      candidates.push({
        priority: 40,
        result: withCommon({
          kind: "chat-review-ready",
          reason: issueLabels.has(snapshot.labels.review_ready) ? "review-ready-label" : "chat-review-ready-handoff",
          nextActor: "thinker",
          eventId: resultEventId("chat-review-ready", snapshot.repository, issue, openPullRequest, reviewReadyEvent),
          issue: issueSummary(snapshot.repository, issue),
          ...(openPullRequest ? { pullRequest: pullRequestSummary(openPullRequest) } : {}),
          ...(reviewReadyEvent ? { latestEvent: reviewReadyEvent } : {})
        }, snapshot)
      });
    }
  }

  const orphanWorkflowCandidate = openPullRequests
    .map((pullRequest) => ({ pullRequest, event: latestWorkflowEvent(undefined, pullRequest) }))
    .filter((candidate): candidate is { pullRequest: DiscoveryPullRequest; event: WorkflowEvent } => Boolean(candidate.event))
    .sort((a, b) => {
      const aTime = Date.parse(a.event.updatedAt ?? a.event.createdAt ?? "");
      const bTime = Date.parse(b.event.updatedAt ?? b.event.createdAt ?? "");
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    })[0];
  if (orphanWorkflowCandidate?.event.kind === "correction") {
    candidates.push({
      priority: 50,
      result: withCommon({
        kind: "resume-existing-pr",
        reason: "open-pr-has-unassociated-correction-event",
        nextActor: "worker",
        eventId: resultEventId("resume-existing-pr", snapshot.repository, undefined, orphanWorkflowCandidate.pullRequest, orphanWorkflowCandidate.event),
        pullRequest: pullRequestSummary(orphanWorkflowCandidate.pullRequest),
        latestEvent: orphanWorkflowCandidate.event
      }, snapshot)
    });
  } else if (orphanWorkflowCandidate?.event.kind === "review-ready") {
    candidates.push({
      priority: 55,
      result: withCommon({
        kind: "chat-review-ready",
        reason: "open-pr-has-unassociated-review-ready-event",
        nextActor: "thinker",
        eventId: resultEventId("chat-review-ready", snapshot.repository, undefined, orphanWorkflowCandidate.pullRequest, orphanWorkflowCandidate.event),
        pullRequest: pullRequestSummary(orphanWorkflowCandidate.pullRequest),
        latestEvent: orphanWorkflowCandidate.event
      }, snapshot)
    });
  }

  const selected = candidates.sort((a, b) => a.priority - b.priority)[0]?.result ?? withCommon({
    kind: "no-pending-work",
    reason: "no-actionable-discovery-state",
    nextActor: "none",
    eventId: resultEventId("no-pending-work", snapshot.repository, undefined, undefined, undefined)
  }, snapshot);

  return unchangedIfNeeded(selected, snapshot.lastProcessedEventId);
}
