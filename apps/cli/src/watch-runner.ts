import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadProjectConfig } from "../../../packages/config/src/load.js";
import {
  actionsForCycleDecision,
  executeCoordinatorAction,
  type CoordinatorAction,
  type ActionExecutionResult,
  type MutationPolicy
} from "../../../packages/core/src/actions.js";
import {
  createCycleAuditEvent,
  createDurableSessionState,
  createSessionConfig,
  defaultSessionConfig,
  runCycle,
  type CycleAuditEvent,
  type CycleDecision,
  type SessionConfig,
  type SessionState,
  type WorkflowRepositorySnapshot
} from "../../../packages/core/src/session.js";
import type { TaskWorkflowLabels } from "../../../packages/core/src/state.js";
import type { GitHubWriteAdapter } from "../../../packages/github-adapter/src/types.js";
import { createGhWriteAdapter } from "./github-write-adapter.js";
import { createGithubSnapshot, GithubSnapshotError } from "./github-dry-run.js";
import { defaultWriteStateFile, loadWriteState, saveWriteState } from "./directive-create.js";

export interface FixtureWatchOptions {
  repoRoot: string;
  fixturePath: string;
  maxCycles?: number;
  intervalMs?: number;
  npfPauseThreshold?: number;
  stateFilePath?: string;
  resume?: boolean;
  executeWrites?: boolean;
  writeStateFilePath?: string;
}

export interface GithubWatchOptions {
  repoRoot: string;
  repository: string;
  issueNumber?: number;
  maxCycles?: number;
  intervalMs?: number;
  npfPauseThreshold?: number;
  stateFilePath?: string;
  resume?: boolean;
  executeWrites?: boolean;
  writeStateFilePath?: string;
}

export interface ProviderWatchOptions {
  labels: TaskWorkflowLabels;
  providerName: string;
  repository?: string;
  stateFilePath?: string;
  maxCycles?: number;
  intervalMs?: number;
  pollIntervalMinutes?: number;
  npfPauseThreshold?: number;
  inactivityTimeoutMinutes?: number;
  resume?: boolean;
  executeWrites?: boolean;
  mutationPolicy?: MutationPolicy;
  configuredWriteRepository?: string;
  writeStateFilePath?: string;
  writeAdapter?: GitHubWriteAdapter;
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

  const candidate = value as {
    consecutiveNpf?: unknown;
    status?: unknown;
    repository?: unknown;
    activeIssueNumber?: unknown;
    nextActor?: unknown;
    lastMeaningfulActivityAt?: unknown;
    inactivityTimeoutMinutes?: unknown;
    currentHumanGate?: unknown;
    lastProcessedEventId?: unknown;
  };
  return (
    typeof candidate.consecutiveNpf === "number" &&
    Number.isInteger(candidate.consecutiveNpf) &&
    candidate.consecutiveNpf >= 0 &&
    (candidate.status === "active" || candidate.status === "paused") &&
    (candidate.repository === undefined || typeof candidate.repository === "string") &&
    (candidate.activeIssueNumber === undefined || typeof candidate.activeIssueNumber === "number") &&
    (candidate.nextActor === undefined ||
      candidate.nextActor === "thinker" ||
      candidate.nextActor === "worker" ||
      candidate.nextActor === "human" ||
      candidate.nextActor === "none") &&
    (candidate.lastMeaningfulActivityAt === undefined || typeof candidate.lastMeaningfulActivityAt === "string") &&
    (candidate.inactivityTimeoutMinutes === undefined || typeof candidate.inactivityTimeoutMinutes === "number") &&
    (candidate.currentHumanGate === undefined ||
      candidate.currentHumanGate === "approval-required" ||
      candidate.currentHumanGate === "manual-validation-required" ||
      candidate.currentHumanGate === "decision-required" ||
      candidate.currentHumanGate === "blocked" ||
      candidate.currentHumanGate === "complete") &&
    (candidate.lastProcessedEventId === undefined || typeof candidate.lastProcessedEventId === "string")
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
    eventId: `${repository}|setup:${reason}`,
    pickup: { action: "wait", reason: "not-in-implementation-queue" },
    outcome: "HUMAN",
    reason,
    diagnostics
  };
}

function createHumanSetupResult(options: {
  providerName: string;
  reason: string;
  diagnostics: string[];
  state: SessionState;
  stateFilePath?: string | undefined;
  writeStateFilePath?: string | undefined;
  writeResults: ActionExecutionResult[];
  audits: CycleAuditEvent[];
  repository?: string | undefined;
}): { decision: CycleDecision; nextState: SessionState; response: object } {
  const repository = options.repository ?? "unknown";
  const decision = createHumanSetupDecision(repository, options.reason, options.diagnostics);
  const nextState: SessionState = { consecutiveNpf: options.state.consecutiveNpf, status: "paused" };
  options.audits.push(createCycleAuditEvent(decision, options.state, nextState, true));

  return {
    decision,
    nextState,
    response: {
      mode: "READ ONLY / DRY RUN",
      provider: options.providerName,
      cyclesRun: options.audits.length,
      sessionStatus: nextState.status,
      consecutiveNpf: nextState.consecutiveNpf,
      stateFile: options.stateFilePath ?? null,
      writeStateFile: options.writeStateFilePath ?? null,
      writeResults: options.writeResults,
      audits: options.audits
    }
  };
}

function parseWorkflowEventIdentity(eventId: string): { repository: string; issueNumber: number } | undefined {
  const [repository, ...parts] = eventId.split("|");
  if (!repository?.includes("/")) {
    return undefined;
  }

  const issuePart = parts.find((part) => part.startsWith("issue:"));
  const match = /^issue:(\d+)(?::|$)/.exec(issuePart ?? "");
  if (!match?.[1]) {
    return undefined;
  }

  return {
    repository,
    issueNumber: Number.parseInt(match[1], 10)
  };
}

function recoveryEventMatchesIssue(options: {
  baseEventId: string;
  repository: string;
  issueNumber: number;
}): boolean {
  const identity = parseWorkflowEventIdentity(options.baseEventId);
  return identity?.repository === options.repository && identity.issueNumber === options.issueNumber;
}

function pendingTransitionActions(options: {
  snapshot: WorkflowRepositorySnapshot;
  repository: string;
  labels: TaskWorkflowLabels;
  writeState: NonNullable<Awaited<ReturnType<typeof loadWriteState>>>;
}): CoordinatorAction[] {
  const actions: CoordinatorAction[] = [];
  const records = options.writeState.handledWriteEvents;

  for (const issue of options.snapshot.issues) {
    const issueLabels = new Set(issue.labels);

    for (const [eventId, record] of Object.entries(records)) {
      if (record.status !== "failed") {
        continue;
      }

      if (eventId.endsWith(":remove-ready")) {
        const baseEventId = eventId.slice(0, -":remove-ready".length);
        const addEvent = records[`${baseEventId}:add-in-progress`];
        const matchesIssue = recoveryEventMatchesIssue({
          baseEventId,
          repository: options.repository,
          issueNumber: issue.number
        });
        if (
          matchesIssue &&
          addEvent?.status === "succeeded" &&
          issueLabels.has(options.labels.implementation_ready) &&
          issueLabels.has(options.labels.implementation_in_progress)
        ) {
          actions.push({
            type: "REMOVE_LABEL",
            eventId,
            repository: options.repository,
            issueNumber: issue.number,
            labels: [options.labels.implementation_ready]
          });
        }
      }

      if (eventId.endsWith(":remove-in-progress")) {
        const baseEventId = eventId.slice(0, -":remove-in-progress".length);
        const addEvent = records[`${baseEventId}:add-review-ready`];
        const matchesIssue = recoveryEventMatchesIssue({
          baseEventId,
          repository: options.repository,
          issueNumber: issue.number
        });
        if (
          matchesIssue &&
          addEvent?.status === "succeeded" &&
          issueLabels.has(options.labels.review_ready) &&
          issueLabels.has(options.labels.implementation_in_progress)
        ) {
          actions.push({
            type: "REMOVE_LABEL",
            eventId,
            repository: options.repository,
            issueNumber: issue.number,
            labels: [options.labels.implementation_in_progress]
          });
        }
      }
    }
  }

  return actions;
}

export async function runWatchWithProvider(options: ProviderWatchOptions, provider: SnapshotProvider): Promise<object> {
  const inactivityTimeoutMinutes =
    options.inactivityTimeoutMinutes ?? defaultSessionConfig.pollIntervalMinutes * defaultSessionConfig.npfPauseThreshold;
  const pollIntervalMinutes = options.pollIntervalMinutes ?? defaultSessionConfig.pollIntervalMinutes;
  const sessionConfig: SessionConfig =
    options.npfPauseThreshold === undefined
      ? createSessionConfig(pollIntervalMinutes, inactivityTimeoutMinutes)
      : {
          pollIntervalMinutes,
          npfPauseThreshold: options.npfPauseThreshold
        };
  const maxCycles = options.maxCycles ?? Number.POSITIVE_INFINITY;
  const intervalMs = options.intervalMs ?? 0;
  const audits: CycleAuditEvent[] = [];
  const writeResults: ActionExecutionResult[] = [];
  let state = await loadSessionState(options.stateFilePath);
  let writeState = options.writeStateFilePath ? await loadWriteState(options.writeStateFilePath) : undefined;

  if (options.repository && state.repository === undefined) {
    state = createDurableSessionState({ repository: options.repository, inactivityTimeoutMinutes });
  }

  if (options.resume) {
    state = { ...state, consecutiveNpf: 0, status: "active" };
    delete state.currentHumanGate;
    if (state.repository !== undefined && !state.nextActor) {
      state.nextActor = "none";
    }
    await saveSessionState(options.stateFilePath, state);
  }

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

  if (options.executeWrites && !options.configuredWriteRepository) {
    const setup = createHumanSetupResult({
      providerName: options.providerName,
      reason: "GIT_WRITE_REPOSITORY_REQUIRED",
      diagnostics: ["Write-enabled watch requires config.project.repo / configuredWriteRepository."],
      state,
      stateFilePath: options.stateFilePath,
      writeStateFilePath: options.writeStateFilePath,
      writeResults,
      audits,
      repository: options.repository
    });
    state = setup.nextState;
    await saveSessionState(options.stateFilePath, state);
    return setup.response;
  }

  if (options.executeWrites && (!options.repository || options.repository !== options.configuredWriteRepository)) {
    const setup = createHumanSetupResult({
      providerName: options.providerName,
      reason: "GIT_WRITE_REPOSITORY_MISMATCH",
      diagnostics: [
        `Write-enabled watch target ${options.repository ?? "unknown"} does not match configured repository ${options.configuredWriteRepository}.`
      ],
      state,
      stateFilePath: options.stateFilePath,
      writeStateFilePath: options.writeStateFilePath,
      writeResults,
      audits,
      repository: options.repository
    });
    state = setup.nextState;
    await saveSessionState(options.stateFilePath, state);
    return setup.response;
  }

  for (let index = 0; index < maxCycles && state.status === "active"; index += 1) {
    try {
      const snapshot = await provider(index);
      if (options.executeWrites && writeState && options.writeAdapter && options.repository) {
        const recoveryActions = pendingTransitionActions({
          snapshot,
          repository: options.repository,
          labels: options.labels,
          writeState
        });

        if (recoveryActions.length > 0) {
          for (const action of recoveryActions) {
            const actionOptions = {
              action,
              state: writeState,
              adapter: options.writeAdapter
            };
            const executed = await executeCoordinatorAction(
              options.mutationPolicy ? { ...actionOptions, policy: options.mutationPolicy } : actionOptions
            );
            writeState = executed.state;
            writeResults.push(...executed.results);
            await saveWriteState(options.writeStateFilePath as string, writeState);
            if (executed.results.some((writeResult) => writeResult.status === "failed")) {
              break;
            }
          }
          await saveSessionState(options.stateFilePath, state);
          continue;
        }
      }
      const result = runCycle(snapshot, options.labels, state, sessionConfig, true);
      state = result.state;
      audits.push(result.audit);

      if (options.executeWrites && writeState && options.writeAdapter) {
        for (const action of actionsForCycleDecision({ decision: result.decision, labels: options.labels })) {
          const actionOptions = {
            action,
            state: writeState,
            adapter: options.writeAdapter
          };
          const executed = await executeCoordinatorAction(
            options.mutationPolicy ? { ...actionOptions, policy: options.mutationPolicy } : actionOptions
          );
          writeState = executed.state;
          writeResults.push(...executed.results);
          await saveWriteState(options.writeStateFilePath as string, writeState);
          if (executed.results.some((writeResult) => writeResult.status === "failed")) {
            break;
          }
        }
      }
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
    writeStateFile: options.writeStateFilePath ?? null,
    writeResults,
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
    maxCycles,
    pollIntervalMinutes: config.polling.interval_minutes,
    inactivityTimeoutMinutes: config.polling.inactivity_timeout_minutes
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
  if (options.resume !== undefined) {
    providerOptions.resume = options.resume;
  }
  if (options.executeWrites !== undefined) {
    providerOptions.executeWrites = options.executeWrites;
  }
  if (options.writeStateFilePath !== undefined) {
    providerOptions.writeStateFilePath = options.writeStateFilePath;
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
  const writeStateFilePath = options.writeStateFilePath ?? defaultWriteStateFile(options.repoRoot);
  const providerOptions: ProviderWatchOptions = {
    labels: config.labels,
    providerName: "github",
    repository: options.repository,
    stateFilePath,
    intervalMs: options.intervalMs ?? config.polling.interval_minutes * 60 * 1000,
    pollIntervalMinutes: config.polling.interval_minutes,
    inactivityTimeoutMinutes: config.polling.inactivity_timeout_minutes,
    writeStateFilePath,
    writeAdapter: createGhWriteAdapter()
  };
  if (config.github_writes) {
    providerOptions.mutationPolicy = config.github_writes;
  }
  if (config.project.repo) {
    providerOptions.configuredWriteRepository = config.project.repo;
  }
  const snapshotOptions = { repository: options.repository };

  if (options.maxCycles !== undefined) {
    providerOptions.maxCycles = options.maxCycles;
  }
  if (options.npfPauseThreshold !== undefined) {
    providerOptions.npfPauseThreshold = options.npfPauseThreshold;
  }
  if (options.resume !== undefined) {
    providerOptions.resume = options.resume;
  }
  if (options.executeWrites !== undefined) {
    providerOptions.executeWrites = options.executeWrites;
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
