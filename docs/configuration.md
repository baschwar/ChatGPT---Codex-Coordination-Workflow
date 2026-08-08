# Configuration Reference

Participating repositories configure the coordinator with `.github/chatgpt-coordinator.yml`.

The configuration is repository-local and versioned. Core code must read labels, governance files, approval gates, and review inputs from this file rather than hard-coding project-specific behavior.

See [packages/schemas/project-config.schema.json](../packages/schemas/project-config.schema.json) for the current schema draft.

## Minimal Example

```yaml
version: 1

project:
  name: Example Project
  repo: example-org/example-project

roles:
  thinker: chatgpt
  worker: codex

governance:
  files:
    - AGENTS.md
    - PROJECT_STATUS.md
    - ROADMAP.md

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

approval_gates:
  create_implementation_issue: explicit
  merge_pull_request: explicit
  begin_next_milestone: explicit
  complete_manual_validation: explicit
  complete_physical_validation: explicit
  close_implementation_task: explicit
```

## Project And Roles

`project.repo` identifies the GitHub repository in `owner/name` form for portable headless runs. `roles.thinker` and `roles.worker` name the configured review/planning actor and implementation actor. They do not imply a built-in transport; actor invocation remains pluggable and may be `none`, mocked in tests, or implemented by a future adapter.

## Label Roles

| Key | Default Example | Meaning |
| --- | --- | --- |
| `implementation_ready` | `codex-ready` | Task is available for an implementation agent to claim. |
| `implementation_in_progress` | `codex-in-progress` | Task has already been claimed and should not be picked up by another implementation agent. |
| `manual_validation` | `manual-validation` | Task is waiting for project-owner or authorized human validation. The issue or latest handoff comment must include an actionable checklist. |
| `review_ready` | `chat-review-ready` | Task implementation and handoff are ready for ChatGPT or another review agent. |
| `blocked` | `blocked` | Task cannot proceed without external input, permission, or dependency resolution. |
| `needs_human` | `needs-human-review` | A protected approval gate requires explicit human action. |

## Polling

`polling.interval_minutes` controls the default watch cadence. `polling.inactivity_timeout_minutes` controls when meaningful inactivity pauses active polling. The default example remains equivalent to six quiet cycles at a ten-minute interval.

Polling alone is not meaningful activity. ACTION outcomes, new relevant task/PR state, review handoffs, and approved responses can reset the inactivity window; idle NPF cycles do not.
