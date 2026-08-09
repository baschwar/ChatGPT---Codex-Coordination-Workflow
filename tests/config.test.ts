import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { loadProjectConfig, validateProjectConfig } from "../packages/config/src/load.js";

const repoRoot = process.cwd();

function validExternalConfig(projectName = "External Client"): string {
  return `version: 1

project:
  name: ${projectName}
  repo: example/external-client

roles:
  thinker: chatgpt
  worker: codex

governance:
  files:
    - AGENTS.md
    - PROJECT_STATUS.md

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
`;
}

test("parses and validates root project configuration", async () => {
  const result = await loadProjectConfig(repoRoot);

  assert.equal(result.config.version, 1);
  assert.equal(result.config.project.name, "ChatGPT GitHub Coordinator");
  assert.equal(result.config.project.repo, "baschwar/ChatGPT---Codex-Coordination-Workflow");
  assert.equal(result.config.roles.thinker, "chatgpt");
  assert.equal(result.config.roles.worker, "codex");
  assert.equal(result.config.labels.implementation_ready, "codex-ready");
  assert.equal(result.config.labels.implementation_in_progress, "codex-in-progress");
  assert.equal(result.config.labels.manual_validation, "manual-validation");
  assert.equal(result.config.labels.review_ready, "chat-review-ready");
  assert.equal(result.config.polling.interval_minutes, 10);
  assert.equal(result.config.polling.inactivity_timeout_minutes, 60);
  assert.equal(result.config.local_worker_transport.git_protocol, "ssh");
  assert.equal(result.config.local_worker_transport.https_fallback, "disabled");
});

test("rejects invalid project configuration", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "coordinator-config-"));
  await mkdir(path.join(tempRoot, ".github"), { recursive: true });
  await writeFile(path.join(tempRoot, ".github", "chatgpt-coordinator.yml"), "version: 1\nproject:\n  name: Broken\n");

  await assert.rejects(loadProjectConfig(tempRoot), /Invalid coordinator config/);
});

test("loads external client config without coordinator source directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "coordinator-external-config-"));
  await mkdir(path.join(tempRoot, ".github"), { recursive: true });
  await writeFile(path.join(tempRoot, ".github", "chatgpt-coordinator.yml"), validExternalConfig("Fixture Client"));

  const result = await loadProjectConfig(tempRoot);

  assert.equal(result.path, path.join(tempRoot, ".github", "chatgpt-coordinator.yml"));
  assert.equal(result.config.project.name, "Fixture Client");
  assert.equal(result.config.project.repo, "example/external-client");
  assert.equal(result.config.labels.implementation_ready, "codex-ready");
});

test("validates example repository configurations", async () => {
  const schema = JSON.parse(
    await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(repoRoot, "packages", "schemas", "project-config.schema.json"), "utf8")
    )
  ) as object;
  const examples = [
    "examples/generic/.github/chatgpt-coordinator.yml",
    "examples/cdw/.github/chatgpt-coordinator.yml",
    "examples/cdw-studio/.github/chatgpt-coordinator.yml"
  ];

  for (const example of examples) {
    const parsed = YAML.parse(
      await import("node:fs/promises").then((fs) => fs.readFile(path.join(repoRoot, example), "utf8"))
    ) as unknown;
    const config = validateProjectConfig(parsed, schema);

    assert.equal(config.roles.thinker, "chatgpt", example);
    assert.equal(config.roles.worker, "codex", example);
    assert.equal(config.polling.interval_minutes, 10, example);
    assert.equal(config.local_worker_transport.git_protocol, "ssh", example);
  }
});
