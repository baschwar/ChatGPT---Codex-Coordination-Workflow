import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();

const reusableFiles = [
  "packages/core/src/actor.ts",
  "packages/core/src/approval.ts",
  "packages/core/src/audit.ts",
  "packages/core/src/service.ts",
  "packages/core/src/session.ts",
  "packages/core/src/state.ts",
  "packages/core/src/templates.ts",
  "packages/config/src/config.ts",
  "packages/config/src/load.ts"
];

const forbiddenPatterns = [
  /Brad/i,
  /baschwar/i,
  /CDW Studio/i,
  /Computational Design Workbench/i,
  /\/Users\//,
  /private\/tmp/
];

test("reusable core and config packages avoid project-specific assumptions", async () => {
  for (const file of reusableFiles) {
    const content = await readFile(path.join(repoRoot, file), "utf8");

    for (const pattern of forbiddenPatterns) {
      assert.equal(pattern.test(content), false, `${file} should not match ${pattern}`);
    }
  }
});
