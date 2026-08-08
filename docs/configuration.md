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

local_worker_transport:
  git_protocol: ssh
  https_fallback: disabled

github_writes:
  enabled: false
  allowed_actions: []

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

## GitHub Writes

GitHub mutations are default-deny. If `github_writes` is omitted or `enabled` is `false`, the coordinator may still inspect state and render previews, but write actions fail closed before reaching the adapter.

Repositories opt in by listing exact allowed actions:

```yaml
github_writes:
  enabled: true
  allowed_actions:
    - CREATE_ISSUE
    - ADD_LABEL
    - REMOVE_LABEL
    - POST_HANDOFF_COMMENT
    - MARK_REVIEW_READY
```

The supported Beta 3 action vocabulary is `CREATE_ISSUE`, `ADD_LABEL`, `REMOVE_LABEL`, `POST_HANDOFF_COMMENT`, `MARK_REVIEW_READY`, and `UPDATE_ISSUE_STATE`. Approval gates still apply separately; for example, implementation issue creation requires explicit approval at the CLI/API boundary even when `CREATE_ISSUE` is allowed.

NPF performs no write. HUMAN/gated states pause unless an explicitly allowed, policy-validated action is supplied. The runtime persists handled write event IDs so retries and restarts do not duplicate issue creation, comments, or label transitions.

## Local Worker Git Transport

Local Codex/worker Git transport is SSH-only. A valid local `origin` remote looks like:

```sh
git@github.com:owner/repository.git
```

The local setup check rejects HTTPS remotes such as:

```sh
https://github.com/owner/repository.git
```

Do not silently rewrite to HTTPS and do not fall back to HTTPS when SSH authentication fails. Surface the setup blocker and repair SSH credentials instead. ChatGPT's GitHub connector may use its own authentication, but it must not change the local repository remote or local worker Git policy.
