# macOS Runner

Scheduler setup stays separate from coordinator decision logic. The runner below is read-only/dry-run and processes one active task state per cycle.

## Ten-Minute Live Read-Only Command

Run from the repository root:

```sh
npm run coordinator -- run --watch --repo baschwar/ChatGPT---Codex-Coordination-Workflow --state-file .chatgpt-coordinator/session-state.json --interval-ms 600000
```

This polls the real GitHub repository through the same read-only snapshot and decision path as `dry-run`. Six consecutive NPF cycles at the default ten-minute interval pause after about one hour of inactivity. The local `.chatgpt-coordinator/session-state.json` file preserves `consecutiveNpf` and `status` between poll iterations and is gitignored.

The live command requires GitHub CLI read access:

```sh
gh auth login -h github.com
```

If `gh` cannot read the repository, the coordinator pauses with a HUMAN setup diagnostic and does not write heartbeat comments.

## Resume A Paused Session

Paused session state is sticky by default. After a six-NPF auto-pause or a HUMAN/setup pause, resume only with an explicit reset command:

```sh
npm run coordinator -- run --watch --repo baschwar/ChatGPT---Codex-Coordination-Workflow --state-file .chatgpt-coordinator/session-state.json --interval-ms 600000 --resume
```

The `--resume` flag resets the persisted state to `{ "consecutiveNpf": 0, "status": "active" }` before polling. Without that flag, a paused state file remains paused and the runner exits without polling.

## Short Gate Command

Use this before the real ten-minute run to prove the live GitHub watch path is wired:

```sh
npm run coordinator -- run --watch --repo baschwar/ChatGPT---Codex-Coordination-Workflow --issue 1 --state-file /tmp/chatgpt-coordinator-live-watch-state.json --interval-ms 1000 --max-cycles 1
```

Use fixture replay when you need deterministic six-NPF behavior without network:

```sh
npm run coordinator -- run --watch --fixture tests/fixtures/watch-session.json --interval-ms 1000 --max-cycles 8
```

Expected result:

- cycle 1 reports `NPF` and increments the counter to `1`
- cycle 2 reports `ACTION` and resets the counter to `0`
- cycles 3 through 8 report `NPF`
- cycle 8 pauses the session with `consecutiveNpf: 6`

## Human Pause Gate

```sh
npm run coordinator -- run --watch --fixture tests/fixtures/human-watch-session.json --interval-ms 1000 --max-cycles 1
```

Expected result:

- cycle 1 reports `HUMAN`
- session pauses immediately
- `consecutiveNpf` remains `0`

## Launchd Wrapper Sketch

Use a wrapper script for a live Mac Mini run so environment and paths are explicit:

```sh
#!/bin/sh
cd "/Users/baschie/Documents/Codex/ChatGPT - GitHub Coordination Workflow" || exit 1
npm run coordinator -- run --watch --repo baschwar/ChatGPT---Codex-Coordination-Workflow --state-file .chatgpt-coordinator/session-state.json --interval-ms 600000
```

This is a thin service boundary over the same CLI command used in a terminal. It does not belong in core decision logic, and stopping the wrapper must not delete `.chatgpt-coordinator/session-state.json`.

Beta milestones do not install or activate this wrapper automatically.
