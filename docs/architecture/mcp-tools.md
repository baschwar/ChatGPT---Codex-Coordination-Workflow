# MCP Tool Interface

The MCP server exposes workflow actions. It should not expose unrestricted GitHub mutation primitives.

## `get_project_context`

Reads repository configuration and governance files.

Inputs:

- `owner`
- `repo`
- `ref` optional

Returns:

- normalized project configuration
- governance files read
- missing governance files
- detected instruction conflicts

## `list_ready_tasks`

Lists tasks carrying the configured implementation-ready label.

Inputs:

- `owner`
- `repo`
- `state` optional

Returns:

- issue number
- title
- labels
- lifecycle state inference
- pickup action: claim new branch, resume related open pull request, or wait
- latest review or continuation instruction summary when resuming
- assignees
- updated timestamp

## `create_approved_directive`

Validates an approved directive and optionally creates a GitHub issue.

Inputs:

- `owner`
- `repo`
- `directive`
- `approval`
- `dryRun`

Returns:

- validation result
- generated issue body
- labels to apply
- duplicate candidates
- created issue URL when `dryRun` is false
- audit event

## `get_task_progress`

Collects task evidence for an issue.

Inputs:

- `owner`
- `repo`
- `issueNumber`

Returns:

- issue body
- issue comments
- related branches
- related commits
- related pull requests
- checks
- changed files
- configured governance files

## `list_review_ready_tasks`

Lists tasks carrying the configured ChatGPT-review-ready label.

Inputs:

- `owner`
- `repo`

Returns:

- issue summary
- pull request associations
- check status summary
- review readiness warnings

## `list_manual_validation_tasks`

Lists tasks carrying the configured manual-validation label.

Inputs:

- `owner`
- `repo`

Returns:

- issue summary
- latest validation checklist
- validation category hints
- pull request associations
- missing-checklist warnings

## `review_task`

Produces a structured review result from task evidence.

Inputs:

- `owner`
- `repo`
- `issueNumber`
- `postComment`

Returns:

- findings
- validation status
- manual validation gaps
- physical validation gaps
- approval gates still required
- posted comment URL when requested

## `post_task_comment`

Posts a task-specific issue or pull-request comment.

Inputs:

- `owner`
- `repo`
- `target`
- `body`

Returns:

- comment URL
- audit event

## `record_human_approval`

Records explicit human approval for a protected transition.

Inputs:

- `owner`
- `repo`
- `issueNumber`
- `gate`
- `approvalText`
- `approver`
- `evidenceRef`

Returns:

- gate evaluation
- resulting lifecycle state
- audit event
