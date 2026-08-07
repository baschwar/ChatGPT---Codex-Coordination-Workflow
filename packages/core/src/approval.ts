export type ApprovalStatus = "approved" | "missing" | "ambiguous";

export interface ApprovalEvaluation {
  status: ApprovalStatus;
  evidence?: string;
  reason?: string;
}

const explicitApprovalPatterns = [
  /^approved\.?$/i,
  /^create the issue\.?$/i,
  /^proceed with implementation\.?$/i,
  /^start this work\.?$/i,
  /^approved to (create|start|proceed)/i,
  /\bapproved for implementation\b/i
];

const ambiguousApprovalPatterns = [
  /^looks good\.?$/i,
  /^maybe\.?$/i,
  /^sounds good\.?$/i,
  /^i agree\b/i,
  /\brevise\b/i,
  /\bwhat would\b/i,
  /\bcan you\b/i,
  /\?\s*$/
];

export function evaluateExplicitApproval(input: string | undefined): ApprovalEvaluation {
  const text = input?.trim();

  if (!text) {
    return { status: "missing", reason: "No approval text was provided." };
  }

  if (explicitApprovalPatterns.some((pattern) => pattern.test(text))) {
    return { status: "approved", evidence: text };
  }

  if (ambiguousApprovalPatterns.some((pattern) => pattern.test(text))) {
    return { status: "ambiguous", evidence: text, reason: "Approval text is ambiguous." };
  }

  return { status: "ambiguous", evidence: text, reason: "Approval text does not explicitly approve implementation." };
}

