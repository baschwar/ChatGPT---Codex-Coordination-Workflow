export interface ApprovedDirective {
  objective: string;
  background: string;
  approvedScope: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  requiredAutomatedTests: string[];
  requiredManualTests: string[];
  documentationRequirements: string[];
  exclusions: string[];
  dependencies: string[];
  validationRequirements: string[];
  humanApprovalGates: string[];
  sourceReference?: string;
}

const requiredDirectiveFields: Array<keyof ApprovedDirective> = [
  "objective",
  "background",
  "approvedScope",
  "constraints",
  "acceptanceCriteria",
  "requiredAutomatedTests",
  "requiredManualTests",
  "documentationRequirements",
  "exclusions",
  "dependencies",
  "validationRequirements",
  "humanApprovalGates"
];

export function validateDirective(directive: Partial<ApprovedDirective>): string[] {
  const errors: string[] = [];

  for (const field of requiredDirectiveFields) {
    const value = directive[field];

    if (typeof value === "string" && value.trim().length === 0) {
      errors.push(`${field} is required.`);
    }

    if (Array.isArray(value) && value.length === 0) {
      errors.push(`${field} must include at least one item.`);
    }

    if (value === undefined) {
      errors.push(`${field} is required.`);
    }
  }

  return errors;
}

function list(items: string[]): string {
  if (items.length === 0) {
    return "- None specified.";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export function renderImplementationIssue(directive: ApprovedDirective): string {
  return `# ${directive.objective}

## Background And Rationale

${directive.background}

## Approved Scope

${list(directive.approvedScope)}

## Constraints

${list(directive.constraints)}

## Acceptance Criteria

${list(directive.acceptanceCriteria)}

## Required Automated Tests

${list(directive.requiredAutomatedTests)}

## Required Manual Tests

${list(directive.requiredManualTests)}

## Documentation Requirements

${list(directive.documentationRequirements)}

## Explicit Exclusions

${list(directive.exclusions)}

## Dependencies

${list(directive.dependencies)}

## Validation Requirements

${list(directive.validationRequirements)}

## Human Approval Gates

${list(directive.humanApprovalGates)}

## Source Discussion Or Decision Reference

${directive.sourceReference?.trim() || "Not provided."}
`;
}

