import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadProjectConfig } from "../../../packages/config/src/load.js";
import {
  createCycleAuditEvent,
  defaultSessionConfig,
  runCycle,
  type CycleAuditEvent,
  type CycleDecision,
  type SessionConfig,
  type SessionState,
  type WorkflowRepositorySnapshot
} from "../../../packages/core/src/session.js";
import type { TaskWorkflowLabels } from "../../../packages/core/src/state.js";
import { createGithubSnapshot, GithubSnapshotError } from "./github-dry-run.js";

export interface FixtureWatchOptions {
  repoRoot: string;
  fixturePath: string;
  maxCycles?: number;
  intervalMs?: number;
  npfPauseThreshold?: number;
  stateFilePath?: string;
}

export interface GithubWatchOptions {
  repoRoot: string;
  repository: string;
  issueNumber?: number;
  maxCycles?: number;
  intervalMs?: number;
  npfPauseThreshold?: number;
  stateFilePath?: string;
}

export interface ProviderWatchOptions {
  labels: TaskWorkflowLabels;
  providerName: string;
  repository?: string;
  stateFilePath?: string;
  maxCycles?: number;
  intervalMs?: number;
  npfPauseThreshold?: number;
}

export type SnapshotProvider = (cycleIndex: number) => Promise<WorkflowRepositorySnapshot>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function defaultStateFilePath(repoRoot: string): string {
  return path.join(repoRoot, ".chatgpt-coordinator", "session-state.json");
}

function isSessionState(value: unknown): value is SessionState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { consecutiveNpf?: unknown; status?: unknown };
  return (
    typeof candidate.consecutiveNpf === "number" &&
    Number.isInteger(candidate.consecutiveNpf) &&
    candidate.consecutiveNpf >= 0 &&
    (candidate.status === "active" || candidate.status === "paused")
  );
}

async function loadSessionState(stateFilePath: string | undefined): Promise<SessionState> {
  if (!stateFilePath) {
    return { consecutiveNpf: 0, status: "active" };
  }

  try {
    const raw = await readFile(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!isSessionState(parsed)) {
      throw new Error("state file does not contain a valid coordinator session state");
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { consecutiveNpf: 0, status: "active" };
    }

    throw error;
  }
}

async function saveSessionState(stateFilePath: string | undefined, state: SessionState): Promise<void> {
  if (!stateFilePath) {
    return;
  }

  await mkdir(path.dirname(stateFilePath), { recursive: true });
  await writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function createHumanSetupDecision(repository: string, reason: string, diagnostics: string[]): CycleDecision {
  return {
    repository,
    pickup: { action: "wait", reason: "not-in-implementation-queue" },
    outcome: "HUMAN",
    reason,
    diagnostics
  };
}

export async function runWatchWithProvider(options: ProviderWatchOptions, provider: SnapshotProvider): Promise<object> {
  const sessionConfig: SessionConfig = {
    pollIntervalMinutes: defaultSessionConfig.pollIntervalMinutes,
    npfPauseThreshold: options.npfPauseThreshold ?? defaultSessionConfig.npfPauseThreshold
  };
  const maxCycles = options.maxCycles ?? Number.POSITIVE_INFINITY;
  const intervalMs = options.intervalMs ?? 0;
  const audits: CycleAuditEvent[] = [];
  let state = await loadSessionState(options.stateFilePath);

  if (state.status === "paused") {
    return {
      mode: "READ ONLY / DRY RUN",
      provider: options.providerName,
      cyclesRun: 0,
      sessionStatus: state.status,
      consecutiveNpf: state.consecutiveNpf,
      stateFile: options.stateFilePath ?? null,
      audits
    };
  }

  for (let index = 0; index < maxCycles && state.status === "active"; index += 1) {
    try {
      const snapshot = await provider(index);
      const result = runCycle(snapshot, options.labels, state, sessionConfig, true);
      state = result.state;
      audits.push(result.audit);
    } catch (error) {
      if (!(error instanceof GithubSnapshotError)) {
        throw error;
      }

      const decision = createHumanSetupDecision(options.repository ?? "unknown", error.reason, error.diagnostics);
      const nextState: SessionState = { consecutiveNpf: state.consecutiveNpf, status: "paused" };
      audits.push(createCycleAuditEvent(decision, state, nextState, true));
      state = nextState;
    }

    await saveSessionState(options.stateFilePath, state);

    if (intervalMs > 0 && index < maxCycles - 1 && state.status === "active") {
      await sleep(intervalMs);
    }
  }

  return {
    mode: "READ ONLY / DRY RUN",
    provider: options.providerName,
    cyclesRun: audits.length,
    sessionStatus: state.status,
    consecutiveNpf: state.consecutiveNpf,
    stateFile: options.stateFilePath ?? null,
    audits
  };
}

export async function runFixtureWatch(options: FixtureWatchOptions): Promise<object> {
  const { config } = await loadProjectConfig(options.repoRoot);
  const snapshots = JSON.parse(await readFile(options.fixturePath, "utf8")) as WorkflowRepositorySnapshot[];
  const maxCycles = options.maxCycles ?? snapshots.length;
  const providerOptions: ProviderWatchOptions = {
    labels: config.labels,
    providerName: "fixture",
    repository: "fixture",
    maxCycles
  };

  if (options.stateFilePath) {
    providerOptions.stateFilePath = options.stateFilePath;
  }
  if (options.intervalMs !== undefined) {
    providerOptions.intervalMs = options.intervalMs;
  }
  if (options.npfPauseThreshold !== undefined) {
    providerOptions.npfPauseThreshold = options.npfPauseThreshold;
  }

  return runWatchWithProvider(
    providerOptions,
    async (index) => {
      const snapshot = snapshots[Math.min(index, snapshots.length - 1)];

      if (!snapshot) {
        throw new Error("Fixture watch requires at least one snapshot");
      }

      return snapshot;
    }
  );
}

export async function runGithubWatch(options: GithubWatchOptions): Promise<object> {
  const { config } = await loadProjectConfig(options.repoRoot);
  const stateFilePath = options.stateFilePath ?? defaultStateFilePath(options.repoRoot);
  const providerOptions: ProviderWatchOptions = {
    labels: config.labels,
    providerName: "github",
    repository: options.repository,
    stateFilePath,
    intervalMs: options.intervalMs ?? defaultSessionConfig.pollIntervalMinutes * 60 * 1000
  };
  const snapshotOptions = { repository: options.repository };

  if (options.maxCycles !== undefined) {
    providerOptions.maxCycles = options.maxCycles;
  }
  if (options.npfPauseThreshold !== undefined) {
    providerOptions.npfPauseThreshold = options.npfPauseThreshold;
  }

  return runWatchWithProvider(
    providerOptions,
    async () => {
      if (options.issueNumber !== undefined) {
        return createGithubSnapshot({ ...snapshotOptions, issueNumber: options.issueNumber });
      }

      return createGithubSnapshot(snapshotOptions);
    }
  );
}
