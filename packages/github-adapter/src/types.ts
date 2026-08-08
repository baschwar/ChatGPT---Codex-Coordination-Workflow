export interface GitHubTaskRef {
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface GitHubIssueRef {
  repository: string;
  number: number;
  url: string;
}

export interface GitHubWriteResult {
  ok: boolean;
  action: string;
  eventId: string;
  url?: string;
  issue?: GitHubIssueRef;
  diagnostics: string[];
  reason?: "auth-required" | "permission-denied" | "rate-limited" | "setup-failed" | "not-found" | "unknown";
}

export interface CreateIssueInput {
  repository: string;
  title: string;
  body: string;
  labels: string[];
  eventId: string;
}

export interface IssueMutationInput {
  repository: string;
  issueNumber: number;
  eventId: string;
}

export interface LabelMutationInput extends IssueMutationInput {
  labels: string[];
}

export interface CommentInput extends IssueMutationInput {
  body: string;
}

export interface IssueStateInput extends IssueMutationInput {
  state: "open" | "closed";
}

export interface GitHubAdapter {
  listIssuesByLabel(owner: string, repo: string, label: string): Promise<unknown[]>;
  postIssueComment(ref: GitHubTaskRef, body: string): Promise<{ url: string }>;
}

export interface GitHubWriteAdapter {
  createIssue(input: CreateIssueInput): Promise<GitHubWriteResult>;
  addLabels(input: LabelMutationInput): Promise<GitHubWriteResult>;
  removeLabels(input: LabelMutationInput): Promise<GitHubWriteResult>;
  postComment(input: CommentInput): Promise<GitHubWriteResult>;
  updateIssueState(input: IssueStateInput): Promise<GitHubWriteResult>;
}
