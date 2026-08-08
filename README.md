# ChatGPT GitHub Coordinator

Reusable coordination layer for human-approved implementation work routed through GitHub.

This project is in the Beta 5 first-run demo phase. The current implementation provides repository-neutral decision logic, fixture simulation, read-only GitHub dry-run inspection, a bounded live watch runner, durable session state, portable configuration, a default-deny GitHub write surface for explicitly approved workflow mutations, read-only repository discovery for issue/PR continuation and review routing, and a safe demo command for first-run walkthroughs.

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
- Repository integration guide: [docs/examples/repository-integration.md](docs/examples/repository-integration.md)
- Discovery architecture: [docs/architecture/discovery.md](docs/architecture/discovery.md)
- First-run demo walkthrough: [docs/demo/first-run.md](docs/demo/first-run.md)

## Coordinator Commands

```sh
npm test
npm run coordinator -- validate
npm run coordinator -- directive preview tests/fixtures/valid-directive.json "Create the issue"
npm run coordinator -- directive create tests/fixtures/valid-directive.json "Create the issue" --dry-run
npm run coordinator -- discover --repo baschwar/ChatGPT---Codex-Coordination-Workflow --json
npm run coordinator -- demo --fixture
npm run coordinator -- demo --fixture --json
npm run coordinator -- demo --repo baschwar/ChatGPT---Codex-Coordination-Workflow --json
npm run coordinator -- demo --reset
npm run coordinator -- dry-run --repo baschwar/ChatGPT---Codex-Coordination-Workflow --issue 1
npm run coordinator -- run --watch --repo baschwar/ChatGPT---Codex-Coordination-Workflow --issue 1 --state-file /tmp/chatgpt-coordinator-live-watch-state.json --interval-ms 1000 --max-cycles 1
npm run coordinator -- run --watch --repo baschwar/ChatGPT---Codex-Coordination-Workflow --issue 1 --state-file /tmp/chatgpt-coordinator-live-watch-state.json --interval-ms 1000 --max-cycles 1 --execute-writes
npm run coordinator -- run --watch --repo baschwar/ChatGPT---Codex-Coordination-Workflow --issue 1 --state-file /tmp/chatgpt-coordinator-live-watch-state.json --interval-ms 1000 --max-cycles 1 --resume
npm run coordinator -- run --watch --fixture tests/fixtures/watch-session.json --interval-ms 1000 --max-cycles 8
```

The default watch and dry-run commands print `READ ONLY / DRY RUN` and do not create or edit labels, comments, branches, issues, pull requests, merges, milestones, or deployments. Write-capable commands require explicit CLI intent plus `github_writes` policy allowing the exact action. Write-event IDs are persisted so replaying the same approved event does not duplicate issues, comments, or label transitions.

## Try The Demo

Start with the fixture demo:

```sh
npm run coordinator -- demo --fixture
```

It shows the approved directive, worker pickup, implementation handoff, review correction, corrected review-ready handoff, and manual-validation gate without live GitHub writes or actor wake-up. Demo artifacts carry `<!-- coordinator:demo-artifact -->` and are excluded from normal production pickup unless the dedicated demo command is active.

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
  demo/
docs/
  architecture/
  demo/
  setup/
tests/
```

## Non-Goals For Initial Release

The first release does not automatically merge pull requests, deploy code, advance milestones, mark manual validation complete, mark physical validation complete, wake ChatGPT/Codex actors, create workflow labels except through explicitly invoked GitHub tooling, or operate on arbitrary repositories without explicit installation and configuration.
