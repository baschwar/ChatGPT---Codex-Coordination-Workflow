# Architecture

## Overview

ChatGPT GitHub Coordinator is a repository-neutral workflow system. It turns explicit human-approved directives into structured GitHub issues, discovers implementation progress, supports review, and records approval-gated state transitions.

The core design separates durable workflow rules from repository-specific configuration and GitHub transport details.

## Layers

### Core Coordination Engine

The core package owns workflow semantics:

- approval-state handling
- directive validation
- state-transition validation
- governance-file discovery requirements
- audit event construction
- template input contracts
- structured error types

The core must not know CDW-specific labels, file paths, milestone names, hardware validation rules, or project terminology.

### Configuration Package

The config package loads and validates `.github/chatgpt-coordinator.yml` using a versioned schema. It resolves repository-local governance files, labels, templates, and approval gates into a normalized runtime configuration.

### GitHub Adapter

The GitHub adapter isolates GitHub-specific reads and writes. The preferred long-term auth model is a GitHub App with narrow permissions. The local prototype may support GitHub CLI authentication for development.

The adapter exposes intentional operations such as `createIssue`, `applyLabel`, `listIssuesByLabel`, `getPullRequestContext`, and `postComment`; it does not expose unrestricted shell execution or generic arbitrary GitHub mutation as core workflow actions.

### CLI App

The CLI supports local validation and dry-run workflows:

- read project context
- validate config
- preview directive-to-issue output without creating an issue
- eventually create approved issues with dry-run support

### MCP Server

The MCP server exposes high-level workflow tools for ChatGPT or other clients. Tool calls should represent intentional coordination actions, not raw GitHub API calls.

## Data Flow

1. Load repository configuration.
2. Read configured governance files.
3. Validate directive and approval state.
4. Generate deterministic issue or review content from templates.
5. Use the GitHub adapter for durable issue, pull request, label, and comment operations.
6. Record structured audit events with redacted sensitive values.

## Trust Boundaries

Repository governance files are treated as durable project authority. Conversation context may provide intent, but it cannot override configured approval gates or governance conflicts.

Secrets remain outside the repository. Logs must redact tokens and sensitive request headers.

## CDW Reference Configuration

CDW Studio is an example integration only. Its labels, governance files, and physical-validation gates live in `examples/cdw-studio/.github/chatgpt-coordinator.yml` and must not be hard-coded into core packages.

