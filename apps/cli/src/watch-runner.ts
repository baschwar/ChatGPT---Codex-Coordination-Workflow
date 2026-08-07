import { readFile } from "node:fs/promises";
import { loadProjectConfig } from "../../../packages/config/src/load.js";
import {
  defaultSessionConfig,
  runCycle,
  type SessionConfig,
  type SessionState,
  type WorkflowRepositorySnapshot
} from "../../../packages/core/src/session.js";

export interface WatchOptions {
  repoRoot: string;
  fixturePath: string;
  maxCycles?: number;
  intervalMs?: number;
  npfPauseThreshold?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runFixtureWatch(options: WatchOptions): Promise<object> {
  const { config } = await loadProjectConfig(options.repoRoot);
  const snapshots = JSON.parse(await readFile(options.fixturePath, "utf8")) as WorkflowRepositorySnapshot[];
  const sessionConfig: SessionConfig = {
    pollIntervalMinutes: defaultSessionConfig.pollIntervalMinutes,
    npfPauseThreshold: options.npfPauseThreshold ?? defaultSessionConfig.npfPauseThreshold
  };
  const maxCycles = options.maxCycles ?? snapshots.length;
  const intervalMs = options.intervalMs ?? 0;
  const audits = [];
  let state: SessionState = { consecutiveNpf: 0, status: "active" };

  for (let index = 0; index < maxCycles && state.status === "active"; index += 1) {
    const snapshot = snapshots[Math.min(index, snapshots.length - 1)];

    if (!snapshot) {
      break;
    }

    const result = runCycle(snapshot, config.labels, state, sessionConfig, true);
    state = result.state;
    audits.push(result.audit);

    if (intervalMs > 0 && index < maxCycles - 1 && state.status === "active") {
      await sleep(intervalMs);
    }
  }

  return {
    mode: "READ ONLY / DRY RUN",
    fixture: options.fixturePath,
    cyclesRun: audits.length,
    sessionStatus: state.status,
    consecutiveNpf: state.consecutiveNpf,
    audits
  };
}
