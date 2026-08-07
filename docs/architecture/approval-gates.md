# Approval Gate Model

## Approval Principles

The coordinator treats approval as a first-class workflow artifact. A proposal, draft directive, passing test suite, or label is not enough to cross a protected gate.

Approval must be explicit, attributable, and recorded in GitHub or a configured audit sink.

## Default Gates

| Gate | Default |
| --- | --- |
| `create_implementation_issue` | `explicit` |
| `merge_pull_request` | `explicit` |
| `begin_next_milestone` | `explicit` |
| `complete_manual_validation` | `explicit` |
| `complete_physical_validation` | `explicit` |
| `close_implementation_task` | `explicit` |

## Approval Language

Unambiguous examples include:

- `Approved`
- `Create the issue`
- `Proceed with implementation`
- `Start this work`

Ambiguous examples must not pass approval detection:

- `Looks good`
- `Maybe`
- `Can you revise this?`
- `What would this involve?`
- `I agree with the direction`

## Gate Evaluation

Each gate evaluation returns:

- gate name
- required mode
- approval status
- approving actor, when present
- evidence URL or reference
- reason for rejection, when absent or ambiguous

## Manual And Physical Validation

Automated tests do not prove manual validation. Manual and physical validation require separate recorded approval where configured. This is especially important for projects involving hardware, production deployments, or visual QA.

