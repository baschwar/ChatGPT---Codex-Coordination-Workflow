import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExplicitApproval } from "../packages/core/src/approval.js";

test("detects explicit implementation approval", () => {
  assert.equal(evaluateExplicitApproval("Proceed with implementation").status, "approved");
  assert.equal(evaluateExplicitApproval("Create the issue").status, "approved");
});

test("rejects ambiguous approval language", () => {
  const evaluation = evaluateExplicitApproval("Looks good");

  assert.equal(evaluation.status, "ambiguous");
  assert.match(evaluation.reason ?? "", /ambiguous/i);
});

test("rejects missing approval language", () => {
  assert.equal(evaluateExplicitApproval("").status, "missing");
});

