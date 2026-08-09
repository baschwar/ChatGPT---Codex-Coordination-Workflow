# Example Repository Integration

To add the coordinator to a repository:

1. Add `.github/chatgpt-coordinator.yml`.
2. Choose project-specific labels.
3. Set `project.repo`, `roles.thinker`, `roles.worker`, and polling defaults.
4. List governance files that must be read before issue creation or review.
5. Configure approval gates.
6. Install the GitHub App on the repository or configure local GitHub CLI read access for dry runs.
7. Confirm the local worker checkout uses an SSH `origin` remote, not HTTPS.
8. Run config validation with `npm run coordinator -- validate`.
9. Test issue preview with a non-production directive.
10. Run a read-only watch smoke test before enabling any write-capable adapter.
11. Add `github_writes` only for the exact routine mutations this repository permits.
12. Create issues only after explicit human approval.
13. Confirm replay/idempotency with the same event ID before trusting unattended writes.
14. Run read-only discovery with `npm run coordinator -- discover --repo owner/repo --json`.

Client repositories contain only their project-specific coordinator configuration and governance files. Do not copy coordinator packages, schemas, source files, or runtime internals into the client repository; validation reads `.github/chatgpt-coordinator.yml` from the client repo and reads schemas from the installed coordinator runtime.

## GitHub App, MCP Server, Custom App, Custom GPT

A GitHub App grants scoped repository access and performs GitHub operations.

An MCP server exposes high-level workflow tools to ChatGPT or other clients.

A ChatGPT custom app can provide a user-facing integration surface, but it is not by itself the durable coordination record.

A custom GPT can carry instructions and conversational behavior, but it is not the workflow system. GitHub remains the durable task record.

Repository configuration defines local labels, governance files, gates, and review inputs for each participating repository.

## Example Configurations

Use `examples/generic/.github/chatgpt-coordinator.yml` as the starter shape for a new repository.

Use `examples/cdw/.github/chatgpt-coordinator.yml` to see how CDW-style labels and governance paths map into the generic coordinator. This is configuration only; the coordinator core does not import CDW application logic or physical-validation behavior.

Bike Party is an intended future portability test. It should get its own configuration after the generic and CDW paths are accepted; it is not connected by this milestone.

## Headless Operation

The coordinator remains CLI/headless-first. A service supervisor should launch the same TypeScript/Node CLI command a person can run in a terminal. The durable session state file survives process shutdown, so stopping a polling process does not discard the active coordination session.

Actor invocation is a separate adapter boundary. If no actor transport is configured, the coordinator reports the decision and leaves GitHub/session state safe; it does not claim it can wake a ChatGPT Web conversation.

## Governed Writes

Write-capable operation uses two gates:

- configuration must allow the exact action in `github_writes.allowed_actions`
- protected transitions, such as creating an implementation issue, must also receive explicit approval

The GitHub adapter intentionally exposes only named methods for creating issues, adding/removing labels, posting comments, and updating issue state where policy allows. It does not expose arbitrary REST mutation to core workflow logic.

Use `coordinator directive preview` before `coordinator directive create`. For watch runs, omit `--execute-writes` for read-only behavior and add it only after config/policy review. The write-event ledger under `.chatgpt-coordinator/write-events.json` prevents duplicate handling when the same approved event is replayed.

Smoke-test, audit, or evidence issues that must never become implementation work should include the machine-readable marker:

```html
<!-- coordinator:non-actionable-artifact -->
```

Ready-labeled issues with that marker are treated as non-actionable artifacts and produce no claim/write actions.

## Discovery

Use `coordinator discover` to inspect repository progress before deciding whether Codex or ChatGPT should act. Discovery checks open implementation-ready issues, review-ready issues, existing PR corrections, explicit issue/PR references, PR head/check state, and configured governance files.

Discovery precedence is:

1. fail closed on ambiguous deterministic PR associations
2. resume an existing PR with requested corrections
3. claim a new ready issue
4. surface review-ready work for ChatGPT
5. keep non-actionable artifacts visible but out of implementation flow
6. report no pending work when nothing meaningful changed

Discovery is read-only and does not require `github_writes`. It does not treat local validation text as GitHub CI; no check runs are reported as `no-check-runs`.

## Local Git Transport

Codex/local worker Git operations require SSH remotes. HTTPS fallback is a setup error because it can mask broken deploy-key or SSH-agent configuration. This rule applies to the local worker checkout only; GitHub connector authentication remains separate.
