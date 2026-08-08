# Roadmap

## Milestone 1: Workflow Specification And Local Prototype

- Architecture decision record
- Task state model
- Approval model
- Configuration schema
- Issue template
- Review template
- Local GitHub adapter design
- Read-only project-context command
- Directive-to-issue preview command
- Beta 1 decision/session engine
- Fixture simulator
- Read-only self-repo dry run
- Live read-only GitHub watch runner
- Persisted and explicitly resumable session state

## Milestone 2: Portable Headless Coordinator Core

- Portable repository configuration contract
- Thinker and worker role configuration
- Durable session state distinct from active polling process
- Meaningful-activity inactivity model
- Pluggable actor transport boundary
- SSH-only local worker Git transport policy
- Headless service/supervisor command boundary
- Generic and CDW example configurations
- Public-source readiness audit
- Integration guide

## Milestone 3: Governed GitHub Write-Capable Coordinator

- Default-deny mutation policy
- Narrow typed GitHub write adapter
- Explicit workflow action execution layer
- Approved directive validation and GitHub issue creation
- Ready-label application through governed writes
- Idempotent write-event/session ledger
- Structured handoff/comment actions
- Dry-run support for directive creation
- Write-enabled watch mode for configured routine transitions
- Live write smoke testing in the coordinator repository

## Milestone 4: Progress And Review Discovery

- Codex-ready task discovery
- ChatGPT-review-ready task discovery
- Related pull-request detection
- Commit and check inspection
- Governance-file loading
- Structured review summaries
- GitHub review comments
- Existing PR correction continuation detection
- Explicit non-actionable artifact exclusion
- Read-only discovery CLI and JSON result shape

## Milestone 5: MCP Server

- Tool schemas
- Authentication setup
- Input validation
- Structured errors
- Local testing instructions
- Example ChatGPT integration

## Milestone 6: CDW Reference Integration

- Add CDW Studio reference configuration
- Validate against a dedicated test repository first
- Preserve explicit human approval gates
- Do not modify active CDW workflows without explicit approval
