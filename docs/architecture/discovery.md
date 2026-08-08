# Progress And Review Discovery

Discovery is the read-only repository inspection layer that answers what actor should act next without requiring a new `codex-ready` issue for every continuation.

## Result Kinds

Discovery returns one machine-readable result:

| Kind | Next actor | Meaning |
| --- | --- | --- |
| `new-ready-issue` | `worker` | An open issue has the configured implementation-ready label and no deterministic open PR association. |
| `resume-existing-pr` | `worker` | An existing open PR is associated with an issue and either the issue is ready with an open PR or the latest PR review/comment requests corrections. |
| `chat-review-ready` | `thinker` | An open issue or related PR has the configured review-ready label or a `CHAT REVIEW READY` handoff comment. |
| `human-gate` | `human` | Discovery cannot choose safely, such as multiple deterministic open PR associations for one issue. |
| `non-actionable-artifact` | `none` | An issue carries the explicit non-actionable marker and is retained as evidence only. |
| `no-pending-work` | `none` | No meaningful new discovery event is available, or the selected event was already handled. |

Each result includes the repository, reason, next actor, event id, diagnostics, selected issue or PR summaries where relevant, latest meaningful event, check state, and loaded governance-file status.

## Precedence

Discovery fails closed on ambiguous issue/PR associations before selecting work. After that, correction continuation takes precedence over new ready work, new ready work takes precedence over review-ready summaries, and non-actionable artifacts are excluded from implementation pickup.

This prevents a clean `codex-ready` queue from hiding a requested correction on an existing PR, while still keeping test and smoke artifacts out of implementation flow.

## Related PR Association

Association is deterministic. A PR may relate to an issue through:

- GitHub `closingIssuesReferences`
- `Closes #N`, `Fixes #N`, or `Resolves #N` references in PR title/body
- project branch convention containing the issue number, such as `codex/issue-9-beta-4-discovery`
- explicit PR URLs in issue comments

Fuzzy title matching is intentionally not a primary signal. If more than one open PR is deterministically associated with one issue, discovery returns `human-gate` with diagnostics instead of guessing.

## Review And Correction Events

Correction continuation is selected when an associated open PR has a `CHANGES_REQUESTED` review or bounded correction language in a PR comment/review body, such as requested corrections or resume/continue implementation language.

Review-ready discovery is selected when the configured review-ready label is present or when an issue/PR comment contains `CHAT REVIEW READY`. Discovery surfaces the related PR head SHA, draft/open state where available, mergeability where GitHub exposes it, and the latest handoff event.

## Checks

GitHub check state is reported as:

- `passing`
- `failing`
- `pending`
- `no-check-runs`
- `unknown`

Local validation claims in comments are not treated as GitHub CI. If GitHub exposes no check runs, discovery reports `no-check-runs` explicitly.

## Governance Context

Discovery loads the files configured under `.github/chatgpt-coordinator.yml` `governance.files`. The result exposes path, existence, size, and a bounded excerpt so callers can display relevant constraints. Governance prose is context only and does not override explicit configuration, approval gates, or mutation policy.

## Non-Actionable Artifacts

Smoke-test, audit, or evidence issues that must never become implementation work should include:

```html
<!-- coordinator:non-actionable-artifact -->
```

Issues with that marker are not selected as implementation work and do not produce claim or branch actions, even if a ready label is present.

## CLI

```sh
npm run coordinator -- discover --repo owner/repo
npm run coordinator -- discover --repo owner/repo --json
npm run coordinator -- discover --repo owner/repo --last-event-id "<previous event id>" --json
```

The command is read-only. It does not mutate labels, comments, branches, pull requests, issues, milestones, deployments, or actor state.
