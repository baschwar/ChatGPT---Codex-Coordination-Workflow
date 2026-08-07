# State Model

## States

| State | Meaning |
| --- | --- |
| `exploratory` | A possible change is being discussed. No implementation approval exists. |
| `awaiting-approval` | A directive exists but lacks explicit human approval. |
| `approved` | A human explicitly approved implementation, but no ready issue has been created yet. |
| `codex-ready` | A GitHub task is ready for an implementation agent. A ready task with an already-associated open pull request is resumed instead of claimed as new work. |
| `in-progress` | An implementation agent has begun work, and another implementation agent should leave it alone. |
| `blocked` | Work cannot proceed without clarification, permission, dependency resolution, or external state. |
| `manual-validation` | Work is implemented enough for human validation, and the issue or latest handoff comment names the required checklist. |
| `chat-review-ready` | Work has been returned for ChatGPT or review-agent inspection. |
| `changes-requested` | Review found changes required before human approval or merge. |
| `human-approval-required` | A protected transition is waiting for explicit project-owner approval. |
| `approved-for-merge` | The human project owner approved merge. The system still does not merge automatically in the initial release. |
| `complete` | The task is closed after required validation and approvals are recorded. |

## Transition Rules

| From | To | Allowed When |
| --- | --- | --- |
| `exploratory` | `awaiting-approval` | A directive is drafted but approval is absent or ambiguous. |
| `awaiting-approval` | `approved` | Explicit human approval is recorded. |
| `approved` | `codex-ready` | A structured issue is created and configured ready label is applied. |
| `codex-ready` | `in-progress` | An implementation agent claims or begins a new ready task that does not already have an open pull request. |
| `codex-ready` | `blocked` | Required context, permissions, or dependencies are missing. |
| `in-progress` | `blocked` | Implementation cannot continue. |
| `in-progress` | `manual-validation` | Human validation is required before review or closeout, and a checklist is posted. |
| `manual-validation` | `in-progress` | Human validation found defects or missing evidence requiring implementation changes. |
| `manual-validation` | `chat-review-ready` | Required human validation evidence is recorded and configured review-ready label is applied. |
| `in-progress` | `chat-review-ready` | Implementation evidence is posted and configured review-ready label is applied. |
| `chat-review-ready` | `codex-ready` | Review identifies required changes, and the configured implementation-ready label is reapplied so an implementation agent resumes the existing open pull request and addresses the latest review or continuation instructions. |
| `chat-review-ready` | `human-approval-required` | Review passes but protected human gates remain. |
| `changes-requested` | `codex-ready` | Older or externally supplied changes-requested state is normalized back to the implementation-ready queue. |
| `human-approval-required` | `approved-for-merge` | Human explicitly approves merge. |
| `human-approval-required` | `complete` | Human approves closure for tasks that do not require merge. |
| `approved-for-merge` | `complete` | Merge and required closeout are recorded. |

## Protected Transitions

Protected transitions require explicit human approval and must not be inferred from comments, passing tests, labels, or successful commands.

- issue creation from an approved directive
- merge approval
- milestone progression
- manual validation completion
- physical validation completion
- task closure

## Manual Validation Handoffs

The `manual-validation` state is for project-owner or authorized human action. A task must not enter this state with only a generic request for review. The issue body or latest handoff comment should include a short checklist naming the exact validation needed, such as fixture inspection, packaged-app testing, preview/export comparison, save/reopen behavior, shortcut testing, deployment review, or supervised physical validation.

Tasks that do not require human testing may skip `manual-validation` and move directly from `in-progress` to `chat-review-ready`.

## Implementation Pickup Rules

Implementation task discovery must distinguish queue state from branch ownership:

| Evidence | Action |
| --- | --- |
| Configured implementation-ready label and no related open pull request | Claim the issue, apply the configured in-progress label, and create a focused branch. |
| Configured implementation-ready label and a related open pull request | Resume the existing branch and pull request, then address the latest review or continuation instructions. |
| Configured in-progress label | Wait; another implementation agent has already claimed the work. |
| Configured manual-validation label with no coding correction requested in the latest human or review instruction | Wait for the authorized human validator. |
| Configured manual-validation label with a coding correction requested in the latest human or review instruction | Resume the existing pull request when present; otherwise claim and branch before coding. |
| Configured review-ready label | Wait for ChatGPT or the configured review agent. |

## Audit Requirements

Every transition records:

- previous state
- next state
- actor
- timestamp
- source evidence
- governance files consulted
- approval gate status
- redacted adapter request identifiers where available
