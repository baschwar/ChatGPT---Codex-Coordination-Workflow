import { readFile } from "node:fs/promises";
import { evaluateExplicitApproval } from "../../../packages/core/src/approval.js";
import { renderImplementationIssue, validateDirective, type ApprovedDirective } from "../../../packages/core/src/templates.js";

export interface DirectivePreview {
  approval: ReturnType<typeof evaluateExplicitApproval>;
  valid: boolean;
  errors: string[];
  issueBody?: string;
}

export async function previewDirective(filePath: string, approvalText?: string): Promise<DirectivePreview> {
  const directive = JSON.parse(await readFile(filePath, "utf8")) as Partial<ApprovedDirective>;
  const approval = evaluateExplicitApproval(approvalText);
  const errors = validateDirective(directive);

  if (approval.status !== "approved") {
    errors.push(approval.reason ?? "Explicit approval is required.");
  }

  if (errors.length > 0) {
    return { approval, valid: false, errors };
  }

  return {
    approval,
    valid: true,
    errors: [],
    issueBody: renderImplementationIssue(directive as ApprovedDirective)
  };
}

