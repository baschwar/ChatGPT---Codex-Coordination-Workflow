import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import type {
  CommentInput,
  CreateIssueInput,
  GitHubIssueRef,
  GitHubWriteAdapter,
  GitHubWriteResult,
  IssueStateInput,
  LabelMutationInput
} from "../../../packages/github-adapter/src/types.js";

const execFileAsync = promisify(execFile);

function isExecFileException(error: unknown): error is ExecFileException & { stdout?: string; stderr?: string } {
  return error instanceof Error && "code" in error;
}

function classifyFailure(detail: string): GitHubWriteResult["reason"] {
  if (/auth|authentication|not logged|login|401|bad credentials/i.test(detail)) {
    return "auth-required";
  }
  if (/permission|forbidden|403|resource not accessible/i.test(detail)) {
    return "permission-denied";
  }
  if (/rate.?limit|secondary rate/i.test(detail)) {
    return "rate-limited";
  }
  if (/not found|404/i.test(detail)) {
    return "not-found";
  }
  return "unknown";
}

function issueRefFromUrl(repository: string, url: string): GitHubIssueRef | undefined {
  const match = /\/issues\/(\d+)(?:$|[?#])/.exec(url.trim());

  if (!match?.[1]) {
    return undefined;
  }

  return {
    repository,
    number: Number.parseInt(match[1], 10),
    url: url.trim()
  };
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 * 10 });
  return stdout.trim();
}

function ok(action: string, eventId: string, diagnostics: string[], url?: string, issue?: GitHubIssueRef): GitHubWriteResult {
  const result: GitHubWriteResult = {
    ok: true,
    action,
    eventId,
    diagnostics
  };

  if (url) {
    result.url = url;
  }
  if (issue) {
    result.issue = issue;
  }

  return result;
}

function failure(action: string, eventId: string, error: unknown): GitHubWriteResult {
  const stderr = isExecFileException(error) ? error.stderr ?? "" : "";
  const message = error instanceof Error ? error.message : String(error);
  const detail = stderr.trim() || message;

  const reason = classifyFailure(detail) ?? "unknown";

  return {
    ok: false,
    action,
    eventId,
    diagnostics: [detail],
    reason
  };
}

export function createGhWriteAdapter(): GitHubWriteAdapter {
  return {
    async createIssue(input: CreateIssueInput): Promise<GitHubWriteResult> {
      try {
        const args = ["issue", "create", "--repo", input.repository, "--title", input.title, "--body", input.body];
        for (const label of input.labels) {
          args.push("--label", label);
        }
        const url = await gh(args);
        return ok("CREATE_ISSUE", input.eventId, ["Issue created."], url, issueRefFromUrl(input.repository, url));
      } catch (error) {
        return failure("CREATE_ISSUE", input.eventId, error);
      }
    },

    async addLabels(input: LabelMutationInput): Promise<GitHubWriteResult> {
      try {
        await gh(["issue", "edit", String(input.issueNumber), "--repo", input.repository, "--add-label", input.labels.join(",")]);
        return ok("ADD_LABEL", input.eventId, [`Labels added: ${input.labels.join(", ")}`]);
      } catch (error) {
        return failure("ADD_LABEL", input.eventId, error);
      }
    },

    async removeLabels(input: LabelMutationInput): Promise<GitHubWriteResult> {
      try {
        await gh(["issue", "edit", String(input.issueNumber), "--repo", input.repository, "--remove-label", input.labels.join(",")]);
        return ok("REMOVE_LABEL", input.eventId, [`Labels removed: ${input.labels.join(", ")}`]);
      } catch (error) {
        return failure("REMOVE_LABEL", input.eventId, error);
      }
    },

    async postComment(input: CommentInput): Promise<GitHubWriteResult> {
      try {
        const url = await gh(["issue", "comment", String(input.issueNumber), "--repo", input.repository, "--body", input.body]);
        return ok("POST_HANDOFF_COMMENT", input.eventId, ["Comment posted."], url);
      } catch (error) {
        return failure("POST_HANDOFF_COMMENT", input.eventId, error);
      }
    },

    async updateIssueState(input: IssueStateInput): Promise<GitHubWriteResult> {
      try {
        await gh([
          "issue",
          input.state === "closed" ? "close" : "reopen",
          String(input.issueNumber),
          "--repo",
          input.repository
        ]);
        return ok("UPDATE_ISSUE_STATE", input.eventId, [`Issue state updated to ${input.state}.`]);
      } catch (error) {
        return failure("UPDATE_ISSUE_STATE", input.eventId, error);
      }
    }
  };
}
