import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectConfig } from "../../../packages/config/src/load.js";
import {
  discoverRepositoryWork,
  type DiscoveryCheck,
  type DiscoveryComment,
  type DiscoveryIssue,
  type DiscoveryPullRequest,
  type DiscoveryReview,
  type GovernanceDiscoveryFile,
  type RepositoryDiscoveryResult,
  type RepositoryDiscoverySnapshot
} from "../../../packages/core/src/discovery.js";
import { ghJson, GithubSnapshotError } from "./github-dry-run.js";

interface GhLabel {
  name: string;
}

interface GhComment {
  id?: string;
  body: string;
  author?: { login?: string };
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}

interface GhReview {
  id?: string;
  state: string;
  body?: string;
  author?: { login?: string };
  submittedAt?: string;
  url?: string;
}

interface GhIssueListItem {
  number: number;
  title: string;
  state?: "OPEN" | "CLOSED";
  body?: string;
  updatedAt?: string;
  labels: GhLabel[];
}

interface GhIssueView extends GhIssueListItem {
  comments?: GhComment[];
}

interface GhPullRequestListItem {
  number: number;
}

interface GhPullRequestView {
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
  closingIssuesReferences?: Array<{ number: number }>;
  comments?: GhComment[];
  reviews?: GhReview[];
  statusCheckRollup?: unknown[];
}

export interface GithubDiscoveryOptions {
  repoRoot: string;
  repository: string;
  stateFilePath?: string;
  lastProcessedEventId?: string;
}

function normalizeComment(comment: GhComment): DiscoveryComment {
  const normalized: DiscoveryComment = { body: comment.body };
  if (comment.id) {
    normalized.id = comment.id;
  }
  if (comment.author?.login) {
    normalized.author = comment.author.login;
  }
  if (comment.createdAt) {
    normalized.createdAt = comment.createdAt;
  }
  if (comment.updatedAt) {
    normalized.updatedAt = comment.updatedAt;
  }
  if (comment.url) {
    normalized.url = comment.url;
  }
  return normalized;
}

function normalizeReview(review: GhReview): DiscoveryReview {
  const normalized: DiscoveryReview = { state: review.state };
  if (review.id) {
    normalized.id = review.id;
  }
  if (review.body) {
    normalized.body = review.body;
  }
  if (review.author?.login) {
    normalized.author = review.author.login;
  }
  if (review.submittedAt) {
    normalized.submittedAt = review.submittedAt;
  }
  if (review.url) {
    normalized.url = review.url;
  }
  return normalized;
}

function normalizeIssue(issue: GhIssueView): DiscoveryIssue {
  const normalized: DiscoveryIssue = {
    number: issue.number,
    title: issue.title,
    labels: issue.labels.map((label) => label.name)
  };

  if (issue.state) {
    normalized.state = issue.state;
  }
  if (issue.body) {
    normalized.body = issue.body;
  }
  if (issue.updatedAt) {
    normalized.updatedAt = issue.updatedAt;
  }
  if (issue.comments) {
    normalized.comments = issue.comments.map(normalizeComment);
  }

  return normalized;
}

function statusCheckToCheck(check: unknown): DiscoveryCheck | undefined {
  if (!check || typeof check !== "object") {
    return undefined;
  }

  const record = check as Record<string, unknown>;
  const name = typeof record.name === "string"
    ? record.name
    : typeof record.context === "string"
      ? record.context
      : typeof record.workflowName === "string"
        ? record.workflowName
        : undefined;

  if (!name) {
    return undefined;
  }

  const normalized: DiscoveryCheck = { name };
  if (typeof record.status === "string") {
    normalized.status = record.status;
  }
  if (typeof record.conclusion === "string") {
    normalized.conclusion = record.conclusion;
  }
  if (typeof record.detailsUrl === "string") {
    normalized.url = record.detailsUrl;
  } else if (typeof record.url === "string") {
    normalized.url = record.url;
  }

  return normalized;
}

function normalizePullRequest(pullRequest: GhPullRequestView): DiscoveryPullRequest {
  const normalized: DiscoveryPullRequest = {
    number: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.state
  };

  if (pullRequest.isDraft !== undefined) {
    normalized.isDraft = pullRequest.isDraft;
  }
  if (pullRequest.mergeable) {
    normalized.mergeable = pullRequest.mergeable;
  }
  if (pullRequest.headRefName) {
    normalized.headRefName = pullRequest.headRefName;
  }
  if (pullRequest.headRefOid) {
    normalized.headRefOid = pullRequest.headRefOid;
  }
  if (pullRequest.url) {
    normalized.url = pullRequest.url;
  }
  if (pullRequest.body) {
    normalized.body = pullRequest.body;
  }
  if (pullRequest.updatedAt) {
    normalized.updatedAt = pullRequest.updatedAt;
  }
  if (pullRequest.closingIssuesReferences) {
    normalized.closingIssueNumbers = pullRequest.closingIssuesReferences.map((issue) => issue.number);
  }
  if (pullRequest.comments) {
    normalized.comments = pullRequest.comments.map(normalizeComment);
  }
  if (pullRequest.reviews) {
    normalized.reviews = pullRequest.reviews.map(normalizeReview);
  }
  if (pullRequest.statusCheckRollup) {
    normalized.checks = pullRequest.statusCheckRollup.map(statusCheckToCheck).filter((check): check is DiscoveryCheck => Boolean(check));
  }

  return normalized;
}

async function readGovernanceFiles(repoRoot: string, files: string[]): Promise<GovernanceDiscoveryFile[]> {
  const results: GovernanceDiscoveryFile[] = [];

  for (const governanceFile of files) {
    const absolutePath = path.join(repoRoot, governanceFile);
    try {
      const contents = await readFile(absolutePath, "utf8");
      results.push({
        path: governanceFile,
        exists: true,
        bytes: Buffer.byteLength(contents),
        excerpt: contents.slice(0, 1200)
      });
    } catch {
      results.push({ path: governanceFile, exists: false });
    }
  }

  return results;
}

async function readLastProcessedEventId(stateFilePath: string | undefined): Promise<string | undefined> {
  if (!stateFilePath) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(await readFile(stateFilePath, "utf8")) as { lastProcessedEventId?: unknown };
    return typeof parsed.lastProcessedEventId === "string" ? parsed.lastProcessedEventId : undefined;
  } catch {
    return undefined;
  }
}

export async function createGithubDiscoverySnapshot(options: GithubDiscoveryOptions): Promise<RepositoryDiscoverySnapshot> {
  const { config } = await loadProjectConfig(options.repoRoot);
  const issueList = (await ghJson([
    "issue",
    "list",
    "--repo",
    options.repository,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,title,state,body,updatedAt,labels"
  ])) as GhIssueListItem[];
  const issues = await Promise.all(
    issueList.map(async (issue) => {
      const issueView = (await ghJson([
        "issue",
        "view",
        String(issue.number),
        "--repo",
        options.repository,
        "--json",
        "number,title,state,body,updatedAt,labels,comments"
      ])) as GhIssueView;
      return normalizeIssue(issueView);
    })
  );
  const prList = (await ghJson([
    "pr",
    "list",
    "--repo",
    options.repository,
    "--state",
    "all",
    "--limit",
    "100",
    "--json",
    "number"
  ])) as GhPullRequestListItem[];
  const pullRequests = await Promise.all(
    prList.map(async (pullRequest) => {
      const prView = (await ghJson([
        "pr",
        "view",
        String(pullRequest.number),
        "--repo",
        options.repository,
        "--json",
        "number,title,state,isDraft,mergeable,headRefName,headRefOid,url,body,updatedAt,closingIssuesReferences,comments,reviews,statusCheckRollup"
      ])) as GhPullRequestView;
      return normalizePullRequest(prView);
    })
  );

  const snapshot: RepositoryDiscoverySnapshot = {
    repository: options.repository,
    labels: {
      implementation_ready: config.labels.implementation_ready,
      implementation_in_progress: config.labels.implementation_in_progress,
      manual_validation: config.labels.manual_validation,
      review_ready: config.labels.review_ready
    },
    issues,
    pullRequests,
    governanceFiles: await readGovernanceFiles(options.repoRoot, config.governance.files)
  };

  const lastProcessedEventId = options.lastProcessedEventId ?? await readLastProcessedEventId(options.stateFilePath);
  if (lastProcessedEventId) {
    snapshot.lastProcessedEventId = lastProcessedEventId;
  }

  return snapshot;
}

export async function githubDiscover(options: GithubDiscoveryOptions): Promise<RepositoryDiscoveryResult> {
  try {
    return discoverRepositoryWork(await createGithubDiscoverySnapshot(options));
  } catch (error) {
    if (error instanceof GithubSnapshotError) {
      return {
        kind: "human-gate",
        repository: options.repository,
        reason: error.reason,
        nextActor: "human",
        eventId: `${options.repository}|github-discovery-error|${error.reason}`,
        diagnostics: error.diagnostics
      };
    }

    throw error;
  }
}

export function formatDiscoveryResult(result: RepositoryDiscoveryResult): string {
  const lines = [
    `Discovery: ${result.kind}`,
    `Repository: ${result.repository}`,
    `Reason: ${result.reason}`,
    `Next actor: ${result.nextActor}`,
    `Event: ${result.eventId}`
  ];

  if (result.issue) {
    lines.push(`Issue: #${result.issue.number} ${result.issue.title}`);
  }
  if (result.pullRequest) {
    lines.push(`PR: #${result.pullRequest.number} ${result.pullRequest.title}`);
    lines.push(`Head: ${result.pullRequest.headRefOid ?? "unknown"}`);
    lines.push(`Checks: ${result.pullRequest.checkState}`);
  }
  if (result.latestEvent) {
    lines.push(`Latest event: ${result.latestEvent.summary}`);
  }
  if (result.diagnostics.length > 0) {
    lines.push(`Diagnostics: ${result.diagnostics.join("; ")}`);
  }

  return `${lines.join("\n")}\n`;
}
