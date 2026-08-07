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
- Bounded dry-run watch runner

## Milestone 2: Approved Issue Creation

- Explicit approval input
- Directive validation
- GitHub issue creation
- Label application
- Duplicate-task detection
- Dry-run support
- Audit record
- Explicit workflow-label setup command

## Milestone 3: Progress And Review Discovery

- Codex-ready task discovery
- ChatGPT-review-ready task discovery
- Related pull-request detection
- Commit and check inspection
- Governance-file loading
- Structured review summaries
- GitHub review comments

## Milestone 4: MCP Server

- Tool schemas
- Authentication setup
- Input validation
- Structured errors
- Local testing instructions
- Example ChatGPT integration

## Milestone 5: CDW Reference Integration

- Add CDW Studio reference configuration
- Validate against a dedicated test repository first
- Preserve explicit human approval gates
- Do not modify active CDW workflows without explicit approval
