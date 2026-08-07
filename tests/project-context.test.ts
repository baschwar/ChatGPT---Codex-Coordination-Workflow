import test from "node:test";
import assert from "node:assert/strict";
import { getProjectContext } from "../apps/cli/src/project-context.js";

test("loads read-only project context and governance file status", async () => {
  const context = await getProjectContext(process.cwd());

  assert.equal(context.projectName, "ChatGPT GitHub Coordinator");
  assert.deepEqual(context.governanceFiles.map((file) => file.path), ["AGENTS.md", "PROJECT_STATUS.md", "ROADMAP.md"]);
  assert.equal(context.governanceFiles.every((file) => file.exists), true);
});

