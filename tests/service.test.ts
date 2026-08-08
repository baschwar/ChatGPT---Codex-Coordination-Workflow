import test from "node:test";
import assert from "node:assert/strict";
import { buildServiceCommand, buildWatchCommand } from "../packages/core/src/service.js";

const spec = {
  repoRoot: "/tmp/example",
  repository: "example/repo",
  stateFile: ".chatgpt-coordinator/session-state.json",
  intervalMinutes: 10
};

test("service boundary builds the headless watch command", () => {
  assert.deepEqual(buildWatchCommand(spec), [
    "npm",
    "run",
    "coordinator",
    "--",
    "run",
    "--watch",
    "--repo",
    "example/repo",
    "--state-file",
    ".chatgpt-coordinator/session-state.json",
    "--interval-ms",
    "600000"
  ]);
});

test("service boundary preserves explicit resume in command construction", () => {
  assert.equal(buildWatchCommand({ ...spec, resume: true }).at(-1), "--resume");
});

test("non-mac supervisors remain documented future boundaries", () => {
  const result = buildServiceCommand("systemd", spec);

  assert.equal(result.supervisor, "systemd");
  assert.match(result.diagnostics[0] ?? "", /future adapter boundary/);
});
