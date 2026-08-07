# ChatGPT GitHub Coordinator

Reusable coordination layer for human-approved implementation work routed through GitHub.

This project is in the planning and scaffold phase. The initial goal is to define the durable workflow contracts before implementing GitHub mutations or MCP tools.

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

The first release does not automatically merge pull requests, deploy code, advance milestones, mark manual validation complete, mark physical validation complete, or operate on arbitrary repositories without explicit installation and configuration.
