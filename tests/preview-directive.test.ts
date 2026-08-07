import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { previewDirective } from "../apps/cli/src/preview-directive.js";

const validDirective = {
  objective: "Add local directive preview",
  background: "Milestone 1 needs a no-write issue preview.",
  approvedScope: ["Render an issue body from a directive JSON file."],
  constraints: ["Do not create GitHub issues."],
  acceptanceCriteria: ["The preview includes all required issue sections."],
  requiredAutomatedTests: ["Run preview tests."],
  requiredManualTests: ["Review rendered output."],
  documentationRequirements: ["Document the planned command."],
  exclusions: ["No real GitHub write operations."],
  dependencies: ["Local filesystem access."],
  validationRequirements: ["Typecheck and automated tests pass."],
  humanApprovalGates: ["Creating real implementation issues remains explicit."],
  sourceReference: "Checkpoint request."
};

test("renders directive issue preview without creating a GitHub issue", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "coordinator-directive-"));
  const directivePath = path.join(tempRoot, "directive.json");
  await writeFile(directivePath, JSON.stringify(validDirective));

  const preview = await previewDirective(directivePath, "Create the issue");

  assert.equal(preview.valid, true);
  assert.match(preview.issueBody ?? "", /# Add local directive preview/);
  assert.match(preview.issueBody ?? "", /## Human Approval Gates/);
  assert.match(preview.issueBody ?? "", /No real GitHub write operations/);
});

test("preview rejects ambiguous approval", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "coordinator-directive-"));
  const directivePath = path.join(tempRoot, "directive.json");
  await writeFile(directivePath, JSON.stringify(validDirective));

  const preview = await previewDirective(directivePath, "Looks good");

  assert.equal(preview.valid, false);
  assert.equal(preview.approval.status, "ambiguous");
  assert.equal(preview.issueBody, undefined);
});

