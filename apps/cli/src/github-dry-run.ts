import { execFile } from "node:child_process";
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
  labels: GhLabel[];
}

interface GhPullRequest {
  state: "OPEN" | "CLOSED" | "MERGED";
  headRefName: string;
  url: string;
  closingIssuesReferences: Array<{ number: number }>;
}

async function ghJson(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 * 10 });
  return JSON.parse(stdout) as unknown;
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

export interface GithubDryRunOptions {
  repoRoot: string;
  repository: string;
  issueNumber?: number;
  consecutiveNpf?: number;
}

export async function githubDryRun(options: GithubDryRunOptions): Promise<object> {
  parseRepository(options.repository);

  const { config } = await loadProjectConfig(options.repoRoot);
  const labelData = (await ghJson(["label", "list", "--repo", options.repository, "--json", "name", "--limit", "200"])) as GhLabel[];
  const pullRequests = (await ghJson([
    "pr",
    "list",
    "--repo",
    options.repository,
    "--state",
    "all",
    "--json",
    "number,title,state,headRefName,url,closingIssuesReferences"
  ])) as GhPullRequest[];

  const issueArgs = options.issueNumber
    ? ["issue", "view", String(options.issueNumber), "--repo", options.repository, "--json", "number,title,labels"]
    : ["issue", "list", "--repo", options.repository, "--state", "open", "--json", "number,title,labels"];
  const issueData = await ghJson(issueArgs);
  const issues = (Array.isArray(issueData) ? issueData : [issueData]) as GhIssue[];
  const workflowIssues: WorkflowIssue[] = issues.map((issue) => {
    const relatedPullRequests = pullRequests
      .filter((pullRequest) => pullRequest.closingIssuesReferences.some((reference) => reference.number === issue.number))
      .map((pullRequest) => ({
        state: normalizePullRequestState(pullRequest.state),
        branch: pullRequest.headRefName,
        url: pullRequest.url
      }));

    const workflowIssue: WorkflowIssue = {
      number: issue.number,
      title: issue.title,
      labels: issue.labels.map((label) => label.name)
    };

    if (relatedPullRequests.length > 0) {
      workflowIssue.relatedPullRequests = relatedPullRequests;
    }

    return workflowIssue;
  });

  const snapshot: WorkflowRepositorySnapshot = {
    repository: options.repository,
    issues: workflowIssues,
    repositoryLabels: labelData.map((label) => label.name)
  };
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
