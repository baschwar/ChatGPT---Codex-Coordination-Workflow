# Architecture

## Overview

ChatGPT GitHub Coordinator is a repository-neutral TypeScript/Node workflow system. It turns explicit human-approved directives into structured GitHub issues, discovers implementation progress, supports review, and records approval-gated state transitions.

The core design separates durable workflow rules from repository-specific configuration, GitHub transport details, actor invocation, and operating-system service supervision.

## Layers

### Core Coordination Engine

The core package owns workflow semantics:

- approval-state handling
- directive validation
- state-transition validation
- ACTION / HUMAN / NPF session semantics
- durable session-state contracts
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

### Actor Boundary

Actor invocation is pluggable. The core can classify a decision for a thinker, worker, or human, but it does not hard-code ChatGPT Web, Codex UI automation, paid API access, or another specific agent transport. If no supported transport is configured, the safe behavior is to surface the decision and preserve workflow state.

### Local Worker Git Transport

Codex/local worker Git operations require SSH remotes. HTTPS origins and HTTPS fallback are setup blockers for local worker checkouts because they hide SSH auth failures and can change branch ownership semantics. ChatGPT's GitHub connector may authenticate independently, but it must remain separate from local repository remotes.

### CLI App

The CLI supports local validation and dry-run workflows:

- read project context
- validate configuration
- preview directive-to-issue output without creating an issue
- run read-only dry-run and watch sessions
- eventually create approved issues with dry-run support

The CLI is the primary headless runtime. Desktop UI shells, including Tauri, may be added later only as optional frontends over the same core and CLI.

### Service Boundary

Background operation is a thin supervisor layer around the TypeScript/Node CLI. The first documented target is macOS `launchd`. Future adapters can build equivalent command wrappers for `systemd` or Windows service/task wrappers without changing core decision logic.

Durable session state is distinct from an active polling process. Stopping the process must not discard repository, active issue/PR, next actor, human gate, inactivity, or last processed event state.

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

CDW Studio is an example integration only. Its labels, governance files, and physical-validation gates live in example configuration and must not be hard-coded into core packages.

Bike Party is an intended second portability test after the generic and CDW configuration paths are accepted. It is not connected by the reusable core milestone.
