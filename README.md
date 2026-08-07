# ChatGPT GitHub Coordinator

Reusable coordination layer for human-approved implementation work routed through GitHub.

This project is in the Beta 1 scaffold phase. The current implementation provides repository-neutral decision logic, fixture simulation, read-only GitHub dry-run inspection, and a bounded live watch runner before enabling GitHub mutations.

## Purpose

The coordinator keeps GitHub as the durable task record between:

- a human project owner
- ChatGPT or another review/planning agent
- Codex or another implementation agent

Approved implementation directives become structured GitHub issues. Implementation agents pick up configured ready labels, hand work to configured manual-validation labels when human checks are required, return work through commits and pull requests, and mark work ready for ChatGPT review. Human approval gates remain explicit and auditable.

## Current Deliverables

- Proposed architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- State-transition model: [docs/architecture/state-model.md](docs/architecture/state-model.md)
- Approval-gate model: [docs/architecture/approval-gates.md](docs/architecture/approval-gates.md)
- Configuration schema: [packages/schemas/project-config.schema.json](packages/schemas/project-config.schema.json)
- Proposed MCP tool interface: [docs/architecture/mcp-tools.md](docs/architecture/mcp-tools.md)
- Beta 1 macOS runner notes: [docs/setup/macos-runner.md](docs/setup/macos-runner.md)

## Beta 1 Commands

```sh
npm test
npm run coordinator -- dry-run --repo baschwar/ChatGPT---Codex-Coordination-Workflow --issue 1
npm run coordinator -- run --watch --repo baschwar/ChatGPT---Codex-Coordination-Workflow --issue 1 --state-file /tmp/chatgpt-coordinator-live-watch-state.json --interval-ms 1000 --max-cycles 1
npm run coordinator -- run --watch --fixture tests/fixtures/watch-session.json --interval-ms 1000 --max-cycles 8
```

The dry-run commands print `READ ONLY / DRY RUN` and do not create or edit labels, comments, branches, issues, pull requests, merges, milestones, or deployments.

## Repository Layout

```text
apps/
  cli/
  mcp-server/
packages/
  core/
  github-adapter/
  config/
  schemas/
  templates/
examples/
  cdw-studio/
docs/
  architecture/
  setup/
tests/
```

## Non-Goals For Initial Release

The first release does not automatically merge pull requests, deploy code, advance milestones, mark manual validation complete, mark physical validation complete, create workflow labels, or operate on arbitrary repositories without explicit installation and configuration.
