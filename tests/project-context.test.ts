import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getProjectContext } from "../apps/cli/src/project-context.js";

const execFileAsync = promisify(execFile);

test("loads read-only project context and governance file status", async () => {
  const context = await getProjectContext(process.cwd());

  assert.equal(context.projectName, "ChatGPT GitHub Coordinator");
  assert.equal(context.projectRepo, "baschwar/ChatGPT---Codex-Coordination-Workflow");
  assert.equal(context.localGitTransport.valid, true);
  assert.equal(context.localGitTransport.requiredProtocol, "ssh");
  assert.equal(context.localGitTransport.httpsFallback, "disabled");
  assert.deepEqual(context.governanceFiles.map((file) => file.path), ["AGENTS.md", "PROJECT_STATUS.md", "ROADMAP.md"]);
  assert.equal(context.governanceFiles.every((file) => file.exists), true);
});

async function setupTempRepo(originUrl: string): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "coordinator-context-"));
  await mkdir(path.join(repoRoot, ".github"), { recursive: true });
  await mkdir(path.join(repoRoot, "packages", "schemas"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "packages", "schemas", "project-config.schema.json"),
    await readFile(path.join(process.cwd(), "packages", "schemas", "project-config.schema.json"), "utf8")
  );
  await writeFile(path.join(repoRoot, "AGENTS.md"), "# Agents\n");
  await writeFile(path.join(repoRoot, "PROJECT_STATUS.md"), "# Status\n");
  await writeFile(path.join(repoRoot, "ROADMAP.md"), "# Roadmap\n");
  await writeFile(
    path.join(repoRoot, ".github", "chatgpt-coordinator.yml"),
    `version: 1

project:
  name: Temp Repo
  repo: example/repo

roles:
  thinker: chatgpt
  worker: codex

governance:
  files:
    - AGENTS.md
    - PROJECT_STATUS.md
    - ROADMAP.md

labels:
  implementation_ready: codex-ready
  implementation_in_progress: codex-in-progress
  manual_validation: manual-validation
  review_ready: chat-review-ready
  blocked: blocked
  needs_human: needs-human-review

polling:
  interval_minutes: 10
  inactivity_timeout_minutes: 60

local_worker_transport:
  git_protocol: ssh
  https_fallback: disabled

approval_gates:
  create_implementation_issue: explicit
  merge_pull_request: explicit
  begin_next_milestone: explicit
  complete_manual_validation: explicit
  complete_physical_validation: explicit
  close_implementation_task: explicit
`
  );
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
  await execFileAsync("git", ["remote", "add", "origin", originUrl], { cwd: repoRoot });
  return repoRoot;
}

test("accepts SSH origin for local worker Git transport", async () => {
  const repoRoot = await setupTempRepo("git@github.com:example/repo.git");
  const context = await getProjectContext(repoRoot);

  assert.equal(context.localGitTransport.valid, true);
  assert.equal(context.localGitTransport.originUrl, "git@github.com:example/repo.git");
});

test("rejects HTTPS origin for local worker Git transport", async () => {
  const repoRoot = await setupTempRepo("https://github.com/example/repo.git");
  const context = await getProjectContext(repoRoot);

  assert.equal(context.localGitTransport.valid, false);
  assert.equal(context.localGitTransport.blocker, "GIT_SSH_REMOTE_REQUIRED");
  assert.match(context.localGitTransport.diagnostics[0] ?? "", /HTTPS fallback is disabled/);
});
