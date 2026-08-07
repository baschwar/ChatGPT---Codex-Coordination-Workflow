# Local Development Guide

## Prerequisites

- Node.js LTS
- GitHub CLI for local prototype auth, when used
- Access to a dedicated test repository for integration tests

## Planned Commands

```sh
npm install
npm run typecheck
npm test
npm run coordinator -- get-project-context
npm run coordinator -- preview-directive directive.json
```

The CLI commands are planned interfaces. Runtime implementation has not started in the scaffold phase.

## Development Safety

Use fixture repositories or mocked GitHub responses for tests. Do not run destructive tests against CDW Studio or any active production repository.

