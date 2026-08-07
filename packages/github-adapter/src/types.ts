export interface GitHubTaskRef {
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface GitHubAdapter {
  listIssuesByLabel(owner: string, repo: string, label: string): Promise<unknown[]>;
  postIssueComment(ref: GitHubTaskRef, body: string): Promise<{ url: string }>;
}

