# First-Run Coordinator Demo

This demo is a self-contained walkthrough of the ChatGPT to GitHub to coordinator to Codex workflow. It uses demo-only artifacts and does not connect to CDW, Bike Party, WSU, client, or other active repositories.

## Prerequisites

```sh
npm install
npm run coordinator -- validate
```

The local worker transport check requires an SSH Git remote. HTTPS fallback is intentionally disabled.

## Fixture Demo

Run the deterministic local demo:

```sh
npm run coordinator -- demo --fixture
```

For structured output:

```sh
npm run coordinator -- demo --fixture --json
```

Expected progression:

```text
[1/6] Approved demo directive -> worker
[2/6] Worker pickup -> worker
[3/6] Implementation handoff -> thinker
[4/6] Review correction -> worker
[5/6] Corrected handoff -> thinker
[6/6] Manual validation gate -> human
```

The fixture demo writes only `examples/demo/DEMO_OUTPUT.md`, `.chatgpt-coordinator/demo/fixture-result.json`, and `.chatgpt-coordinator/demo/fixture-state.json`. It uses mock GitHub writes to prove label transition idempotency, latest correction routing, review-ready handoff routing, and human-gate pause behavior.

The default fixture intentionally stops at the human gate. Completion is blocked until explicit approval is supplied:

```sh
npm run coordinator -- demo --fixture --resume --json
```

Expected result: `valid` is `false`, and diagnostics explain that explicit demo resume approval is required.

Resume with explicit approval:

```sh
npm run coordinator -- demo --fixture --resume --approval approved --json
```

Expected completion evidence:

- a seventh step named `Explicit resume completion`
- completion write status `succeeded` on the first resume
- completion write status `skipped` on replay
- `mergePerformed: false`
- `examples/demo/DEMO_OUTPUT.md` records explicit resume completion

## Live Demo Plan

The live demo path is dry-run by default:

```sh
npm run coordinator -- demo --repo baschwar/ChatGPT---Codex-Coordination-Workflow --json
```

Real live writes require explicit opt-in:

```sh
npm run coordinator -- demo --repo baschwar/ChatGPT---Codex-Coordination-Workflow --execute-writes --json
```

Write mode fails closed unless the requested repository exactly matches `config.project.repo`. Demo artifacts must carry:

```html
<!-- coordinator:demo-artifact -->
```

The normal production discovery path treats that marker as non-actionable unless the dedicated demo command is active.

## Actor Boundary

The coordinator demonstrates ownership routing. It does not fabricate actor wake-up:

- ChatGPT Web is not autonomously awakened.
- Codex is not autonomously invoked by the fixture.
- Human validation is not completed automatically.
- Pull requests are not merged by default.
- Demo completion requires `--resume --approval approved`.

## Reset

Reset local demo state:

```sh
npm run coordinator -- demo --reset
```

For live demo artifacts, close/archive demo issues or PRs manually, remove any demo-only labels that were created, and rerun from a known state. The default fixture demo does not create live GitHub issues or pull requests.
