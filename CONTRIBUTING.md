# Contributing

This project is in an early specification phase.

## Development Principles

- Keep workflow rules explicit and auditable.
- Prefer deterministic output for generated issue and review bodies.
- Add tests for protected state transitions and approval handling before broadening behavior.
- Mock GitHub responses for unit tests.
- Do not run destructive tests against real project repositories.

## Local Development

1. Install Node.js LTS.
2. Install dependencies after `package.json` is populated with real package workspaces.
3. Validate schemas and templates before implementing GitHub writes.

