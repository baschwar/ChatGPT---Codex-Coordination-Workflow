import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDirectiveIssue } from "../apps/cli/src/directive-create.js";
import type { GitHubWriteAdapter, GitHubWriteResult } from "../packages/github-adapter/src/types.js";

const validDirective = {
  objective: "Create a governed write issue",
  background: "Beta 3 needs an approved directive-to-issue path.",
  approvedScope: ["Create one issue from structured directive input."],
  constraints: ["Require explicit approval."],
  acceptanceCriteria: ["The issue receives the ready label."],
  requiredAutomatedTests: ["Run directive create tests."],
  requiredManualTests: ["Review the created test issue."],
  documentationRequirements: ["Document the command."],
  exclusions: ["No duplicate issues on replay."],
  dependencies: ["GitHub write adapter."],
  validationRequirements: ["Typecheck and tests pass."],
  humanApprovalGates: ["Issue creation requires explicit approval."],
  sourceReference: "Issue #6"
};

function ok(eventId: string): GitHubWriteResult {
  return {
    ok: true,
    action: "CREATE_ISSUE",
    eventId,
    url: "https://github.com/baschwar/ChatGPT---Codex-Coordination-Workflow/issues/99",
    issue: {
      repository: "baschwar/ChatGPT---Codex-Coordination-Workflow",
      number: 99,
      url: "https://github.com/baschwar/ChatGPT---Codex-Coordination-Workflow/issues/99"
    },
    diagnostics: ["Issue created."]
  };
}

function adapter(calls: string[]): GitHubWriteAdapter {
  return {
    async createIssue(input) {
      calls.push(`${input.title}:${input.labels.join(",")}`);
      return ok(input.eventId);
    },
    async addLabels() {
      throw new Error("not used");
    },
    async removeLabels() {
      throw new Error("not used");
    },
    async postComment() {
      throw new Error("not used");
    },
    async updateIssueState() {
      throw new Error("not used");
    }
  };
}

async function writeDirective(): Promise<{ directivePath: string; stateFile: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "coordinator-directive-create-"));
  const directivePath = path.join(tempRoot, "directive.json");
  const stateFile = path.join(tempRoot, "write-events.json");
  await writeFile(directivePath, JSON.stringify(validDirective), "utf8");
  return { directivePath, stateFile };
}

test("directive create supports dry-run preview without writes", async () => {
  const calls: string[] = [];
  const { directivePath, stateFile } = await writeDirective();
  const result = await createDirectiveIssue({
    repoRoot: process.cwd(),
    directivePath,
    approvalText: "Create the issue",
    dryRun: true,
    stateFilePath: stateFile,
    adapter: adapter(calls)
  });

  assert.equal(result.valid, true);
  assert.equal(result.mode, "DRY RUN");
  assert.equal(result.results.length, 0);
  assert.match(result.issueBody ?? "", /Create a governed write issue/);
  assert.deepEqual(calls, []);
});

test("directive create rejects missing approval", async () => {
  const { directivePath, stateFile } = await writeDirective();
  const result = await createDirectiveIssue({
    repoRoot: process.cwd(),
    directivePath,
    approvalText: "Looks fine",
    stateFilePath: stateFile,
    adapter: adapter([])
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /explicitly approve/i);
});

test("directive create writes once and skips duplicate replay after restart", async () => {
  const calls: string[] = [];
  const { directivePath, stateFile } = await writeDirective();
  const first = await createDirectiveIssue({
    repoRoot: process.cwd(),
    directivePath,
    approvalText: "Create the issue",
    eventId: "directive-event-1",
    stateFilePath: stateFile,
    adapter: adapter(calls)
  });
  const persisted = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, unknown>;
  const replay = await createDirectiveIssue({
    repoRoot: process.cwd(),
    directivePath,
    approvalText: "Create the issue",
    eventId: "directive-event-1",
    stateFilePath: stateFile,
    adapter: adapter(calls)
  });

  assert.equal(first.valid, true);
  assert.equal(first.results[0]?.status, "succeeded");
  assert.equal(replay.alreadyHandled, true);
  assert.equal(replay.results[0]?.status, "skipped");
  assert.deepEqual(calls, ["Create a governed write issue:codex-ready"]);
  assert.ok((persisted.handledWriteEvents as Record<string, unknown>)["directive-event-1"]);
});
