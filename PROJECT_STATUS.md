# Project Status

Status: External client repository schema resolution review-ready for issue #15.

Completed:

- Initial project structure
- Architecture draft
- State-transition model draft
- Approval-gate model draft
- MCP tool interface draft
- Versioned configuration schema draft
- Reusable template drafts
- Repository-neutral decision/session engine
- Fixture simulator and inactivity tests
- Read-only GitHub dry-run CLI path
- Live read-only GitHub watch runner
- Persisted watch session state with six-NPF auto-pause
- Explicit `--resume` reset for paused watch sessions
- macOS runner handoff notes
- Portable project repo, thinker/worker role, and polling configuration
- Generic and CDW example configuration paths
- Actor transport and headless service command boundaries
- SSH-only local worker Git transport setup check
- Repository-neutral meaningful-event identity persisted across watch cycles
- Quiet NPF actor routing with no worker/thinker invocation
- Default-deny GitHub mutation policy configuration
- Narrow GitHub write adapter/action surface for issues, labels, comments, and issue state
- Approved directive-to-issue write path with dry-run and idempotent write-event persistence
- Write-enabled watch action execution for configured routine claim-label transitions
- Repository progress and review discovery core
- Read-only `discover` CLI command
- Deterministic issue/PR association for explicit references and branch conventions
- Review-ready, correction-continuation, check-state, governance-file, and non-actionable artifact discovery
- Write-enabled watch fail-closed guard for missing or mismatched configured repository
- Restart recovery for incomplete governed label transitions from realistic GitHub label state
- First-run fixture demo command for safe workflow walkthroughs
- Demo artifact marker excluded from normal production pickup
- Demo reset helper and first-run walkthrough
- External client repository config validation without client-side coordinator schemas or source files

Not started:

- MCP server implementation
- CDW Studio integration
- Real launchd installation

Constraints:

- No automatic pull-request merge behavior.
- No automatic production deployment.
- No automatic milestone progression.
- No automatic manual or physical validation completion.
- No automatic workflow-label creation.
- CDW Studio remains an example configuration only until explicitly approved.
- GitHub writes are disabled unless repository configuration allows the exact action.
- Discovery is read-only and must not wake actors, merge pull requests, or treat local validation claims as GitHub CI.
- Demo mode must not fabricate ChatGPT Web or Codex actor wake-up and must stop before merge by default.
