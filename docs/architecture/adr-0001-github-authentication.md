# ADR-0001: GitHub Authentication Strategy

Status: proposed

## Context

The coordinator needs to read repository governance, issues, pull requests, commits, changed files, checks, and comments. Later milestones will create issues, apply configured labels, and post comments. The system should remain reusable across repositories without requiring broad personal access tokens.

## Decision

Use a GitHub App as the preferred long-term authentication model. The GitHub App should request only the repository permissions required by configured workflow operations.

Support local GitHub CLI authentication only for development and prototype workflows. CLI auth is acceptable for read-only context checks and dry-run previews, but it is not the durable deployment model.

## Rationale

GitHub App installation tokens can be scoped to selected repositories and narrow permissions. This matches the coordinator's least-privilege requirements better than a broad personal access token.

GitHub CLI compatibility remains useful during Milestone 1 because it lets developers validate local read-only behavior and preview generated issue bodies before GitHub write support exists.

## Consequences

- Core workflow code must not depend on a specific auth mechanism.
- GitHub auth is isolated behind the GitHub adapter.
- Initial local commands must avoid real GitHub write operations.
- Future write operations must check configured gates before creating issues, applying labels, or posting comments.

