import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import { loadProjectConfig } from "../../../packages/config/src/load.js";
import { runCycle, type WorkflowIssue, type WorkflowRepositorySnapshot } from "../../../packages/core/src/session.js";
import type { RelatedPullRequest } from "../../../packages/core/src/state.js";

const execFileAsync = promisify(execFile);

interface GhLabel {
  name: string;
}

interface GhIssue {
  number: number;
  title: string;
  updatedAt?: string;
  labels: GhLabel[];
}

interface GhPullRequest {
  state: "OPEN" | "CLOSED" | "MERGED";
  headRefName: string;
  headRefOid?: string;
  updatedAt?: string;
  url: string;
  closingIssuesReferences: Array<{ number: number }>;
}

export class GithubSnapshotError extends Error {
  readonly reason: "github-auth-required" | "github-cli-failed";
  readonly diagnostics: string[];

  constructor(reason: "github-auth-required" | "github-cli-failed", diagnostics: string[]) {
    super(diagnostics.join("\n"));
    this.name = "GithubSnapshotError";
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

function isExecFileException(error: unknown): error is ExecFileException & { stdout?: string; stderr?: string } {
  return error instanceof Error && "code" in error;
}

function isAuthFailure(message: string): boolean {
  return /auth|authentication|not logged|login|401|bad credentials/i.test(message);
}

async function ghJson(args: string[]): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 * 10 });
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const stderr = isExecFileException(error) ? error.stderr ?? "" : "";
    const message = error instanceof Error ? error.message : String(error);
    const detail = stderr.trim() || message;
    const command = `gh ${args.join(" ")}`;

    if (isAuthFailure(detail)) {
      throw new GithubSnapshotError("github-auth-required", [
        `GitHub CLI authentication is required for read-only live inspection: ${command}`,
        "Run: gh auth login -h github.com",
        detail
      ]);
    }

    throw new GithubSnapshotError("github-cli-failed", [
      `GitHub CLI command failed during read-only live inspection: ${command}`,
      detail
    ]);
  }
}

function normalizePullRequestState(state: GhPullRequest["state"]): RelatedPullRequest["state"] {
  if (state === "OPEN") {
    return "open";
  }

  if (state === "MERGED") {
    return "merged";
  }

  return "closed";
}

function parseRepository(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split("/");

  if (!owner || !repo) {
    throw new Error("Repository must be in owner/repo form");
  }

  return { owner, repo };
}

function eventId(parts: string[]): string {
  return parts.join("|");
}

export interface GithubDryRunOptions {
  repoRoot: string;
  repository: string;
  issueNumber?: number;
  consecutiveNpf?: number;
}

export interface GithubSnapshotOptions {
  repository: string;
  issueNumber?: number;
}

export async function createGithubSnapshot(options: GithubSnapshotOptions): Promise<WorkflowRepositorySnapshot> {
  parseRepository(options.repository);

  const labelData = (await ghJson(["label", "list", "--repo", options.repository, "--json", "name", "--limit", "200"])) as GhLabel[];
  const pullRequests = (await ghJson([
    "pr",
    "list",
    "--repo",
    options.repository,
    "--state",
    "all",
    "--json",
    "number,title,state,headRefName,headRefOid,updatedAt,url,closingIssuesReferences"
  ])) as GhPullRequest[];

  const issueArgs = options.issueNumber
    ? ["issue", "view", String(options.issueNumber), "--repo", options.repository, "--json", "number,title,updatedAt,labels"]
    : ["issue", "list", "--repo", options.repository, "--state", "open", "--json", "number,title,updatedAt,labels"];
  const issueData = await ghJson(issueArgs);
  const issues = (Array.isArray(issueData) ? issueData : [issueData]) as GhIssue[];
  const workflowIssues: WorkflowIssue[] = issues.map((issue) => {
    const relatedPullRequests = pullRequests
      .filter((pullRequest) => pullRequest.closingIssuesReferences.some((reference) => reference.number === issue.number))
      .map((pullRequest) => ({
        state: normalizePullRequestState(pullRequest.state),
        branch: pullRequest.headRefName,
        url: pullRequest.url,
        eventId: eventId([
          options.repository,
          `issue:${issue.number}`,
          `pr:${pullRequest.url}`,
          `state:${pullRequest.state}`,
          `head:${pullRequest.headRefOid ?? "unknown"}`,
          `updated:${pullRequest.updatedAt ?? "unknown"}`
        ])
      }));

    const workflowIssue: WorkflowIssue = {
      number: issue.number,
      title: issue.title,
      labels: issue.labels.map((label) => label.name),
      eventId: eventId([
        options.repository,
        `issue:${issue.number}`,
        `labels:${issue.labels.map((label) => label.name).sort().join(",")}`,
        `updated:${issue.updatedAt ?? "unknown"}`,
        `prs:${relatedPullRequests.map((pullRequest) => pullRequest.eventId ?? "unknown").sort().join(",")}`
      ])
    };

    if (relatedPullRequests.length > 0) {
      workflowIssue.relatedPullRequests = relatedPullRequests;
    }

    return workflowIssue;
  });

  return {
    repository: options.repository,
    issues: workflowIssues,
    repositoryLabels: labelData.map((label) => label.name)
  };
}

export async function githubDryRun(options: GithubDryRunOptions): Promise<object> {
  const { config } = await loadProjectConfig(options.repoRoot);
  let snapshot: WorkflowRepositorySnapshot;

  try {
    snapshot = await createGithubSnapshot(options);
  } catch (error) {
    if (error instanceof GithubSnapshotError) {
      return {
        mode: "READ ONLY / DRY RUN",
        repository: options.repository,
        issue: null,
        associatedOpenPr: null,
        selectedDecision: { action: "wait", reason: "not-in-implementation-queue" },
        cycleOutcome: "HUMAN",
        reason: error.reason,
        consecutiveNpf: options.consecutiveNpf ?? 0,
        sessionStatus: "paused",
        diagnostics: error.diagnostics,
        audit: null
      };
    }

    throw error;
  }

  const result = runCycle(
    snapshot,
    config.labels,
    { consecutiveNpf: options.consecutiveNpf ?? 0, status: "active" },
    {
      pollIntervalMinutes: 10,
      npfPauseThreshold: 6
    },
    true
  );

  return {
    mode: "READ ONLY / DRY RUN",
    repository: options.repository,
    issue: result.decision.issue
      ? {
          number: result.decision.issue.number,
          title: result.decision.issue.title,
          labels: result.decision.issue.labels
        }
      : null,
    associatedOpenPr: result.decision.pickup.pullRequest ?? null,
    selectedDecision: result.decision.pickup,
    cycleOutcome: result.decision.outcome,
    reason: result.decision.reason,
    consecutiveNpf: result.state.consecutiveNpf,
    sessionStatus: result.state.status,
    diagnostics: result.decision.diagnostics,
    audit: result.audit
  };
}
