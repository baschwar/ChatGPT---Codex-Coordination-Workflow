# macOS Runner

Beta 1 keeps scheduler setup separate from coordinator decision logic. The runner below is read-only/dry-run and processes one active task state per cycle.

## Ten-Minute Dry-Run Command

Run from the repository root:

```sh
npm run coordinator -- run --watch --fixture tests/fixtures/watch-session.json --interval-ms 600000
```

This uses the same six-NPF pause semantics as the shortened fixture tests. Six consecutive NPF cycles at the default ten-minute interval pause after about one hour of inactivity.

## Short Gate Command

Use this before the real ten-minute run:

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

Use a wrapper script for a future live Mac Mini run so environment and paths are explicit:

```sh
#!/bin/sh
cd "/Users/baschie/Documents/Codex/ChatGPT - GitHub Coordination Workflow" || exit 1
npm run coordinator -- run --watch --fixture tests/fixtures/watch-session.json --interval-ms 600000
```

Beta 1 does not install or activate this wrapper automatically.
