import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectConfig } from "../../../packages/config/src/load.js";
import {
  actionsForCycleDecision,
  createWriteSessionState,
  executeCoordinatorAction,
  type ActionExecutionResult,
  type CoordinatorAction,
  type MutationPolicy,
  type WriteSessionState
} from "../../../packages/core/src/actions.js";
import { evaluateExplicitApproval } from "../../../packages/core/src/approval.js";
import { discoverRepositoryWork, type RepositoryDiscoverySnapshot } from "../../../packages/core/src/discovery.js";
import { createDurableSessionState, runCycle, type WorkflowRepositorySnapshot } from "../../../packages/core/src/session.js";
import type { TaskWorkflowLabels } from "../../../packages/core/src/state.js";
import type { GitHubWriteAdapter, GitHubWriteResult } from "../../../packages/github-adapter/src/types.js";
import { createGhWriteAdapter } from "./github-write-adapter.js";
import { loadWriteState, saveWriteState } from "./directive-create.js";

export const demoArtifactMarker = "<!-- coordinator:demo-artifact -->";
export const demoOutputBaseline = `${demoArtifactMarker}\n\nCoordinator demo ready. Run \`npm run coordinator -- demo --fixture\` to update this file.\n`;

export interface DemoOptions {
  repoRoot: string;
  fixture?: boolean;
  repository?: string;
  executeWrites?: boolean;
  reset?: boolean;
  json?: boolean;
  resume?: boolean;
  approvalText?: string;
  adapter?: GitHubWriteAdapter;
}

export interface DemoStep {
  index: number;
  title: string;
  summary: string;
  nextActor: "thinker" | "worker" | "human" | "none";
  evidence: Record<string, unknown>;
}

export interface DemoResult {
  mode: "fixture" | "live-dry-run" | "live-write" | "reset";
  valid: boolean;
  repository?: string;
  demoMarker: string;
  steps: DemoStep[];
  writeResults: ActionExecutionResult[];
  diagnostics: string[];
  resetPaths: string[];
  limitations: string[];
}

interface DemoIssueState {
  labels: string[];
  comments: string[];
}

interface PersistedDemoState {
  status: "paused" | "complete";
  currentStage: "manual-validation" | "complete";
  mergePerformed: false;
  writeState: WriteSessionState;
  steps: DemoStep[];
  writeResults: ActionExecutionResult[];
  approvalEvidence?: string;
}

function demoStateDir(repoRoot: string): string {
  return path.join(repoRoot, ".chatgpt-coordinator", "demo");
}

function demoStatePath(repoRoot: string): string {
  return path.join(demoStateDir(repoRoot), "fixture-state.json");
}

function liveWriteStatePath(repoRoot: string): string {
  return path.join(demoStateDir(repoRoot), "live-write-events.json");
}

function demoOutputPath(repoRoot: string): string {
  return path.join(repoRoot, "examples", "demo", "DEMO_OUTPUT.md");
}

async function writeDemoOutput(repoRoot: string, body: string): Promise<void> {
  await writeFile(demoOutputPath(repoRoot), body, "utf8");
}

function demoIssue(labels: string[], eventId: string): WorkflowRepositorySnapshot {
  return {
    repository: "demo/local-fixture",
    repositoryLabels: ["codex-ready", "codex-in-progress", "manual-validation", "chat-review-ready"],
    issues: [{ number: 9001, title: "Coordinator demo task", labels, eventId }]
  };
}

function writeResult(action: string, eventId: string, diagnostics: string[], url?: string): GitHubWriteResult {
  return {
    ok: true,
    action,
    eventId,
    diagnostics,
    ...(url ? { url } : {})
  };
}

function demoAdapter(issue: DemoIssueState, calls: string[]): GitHubWriteAdapter {
  return {
    async createIssue(input) {
      calls.push(`create:${input.title}`);
      issue.labels = [...input.labels];
      return writeResult("CREATE_ISSUE", input.eventId, ["Demo issue created."], "https://github.com/demo/local-fixture/issues/9001");
    },
    async addLabels(input) {
      calls.push(`add:${input.issueNumber}:${input.labels.join(",")}`);
      issue.labels = [...new Set([...issue.labels, ...input.labels])];
      return writeResult("ADD_LABEL", input.eventId, [`Demo labels added: ${input.labels.join(", ")}`]);
    },
    async removeLabels(input) {
      calls.push(`remove:${input.issueNumber}:${input.labels.join(",")}`);
      const remove = new Set(input.labels);
      issue.labels = issue.labels.filter((label) => !remove.has(label));
      return writeResult("REMOVE_LABEL", input.eventId, [`Demo labels removed: ${input.labels.join(", ")}`]);
    },
    async postComment(input) {
      calls.push(`comment:${input.issueNumber}`);
      issue.comments.push(input.body);
      return writeResult("POST_HANDOFF_COMMENT", input.eventId, ["Demo comment posted."], "https://github.com/demo/local-fixture/issues/9001#issuecomment-demo");
    },
    async updateIssueState(input) {
      calls.push(`state:${input.issueNumber}:${input.state}`);
      return writeResult("UPDATE_ISSUE_STATE", input.eventId, [`Demo issue state set to ${input.state}.`]);
    }
  };
}

async function executeActions(options: {
  actions: CoordinatorAction[];
  adapter: GitHubWriteAdapter;
  policy: MutationPolicy;
  state: WriteSessionState;
}): Promise<{ state: WriteSessionState; results: ActionExecutionResult[] }> {
  let state = options.state;
  const results: ActionExecutionResult[] = [];

  for (const action of options.actions) {
    const executed = await executeCoordinatorAction({ action, policy: options.policy, state, adapter: options.adapter });
    state = executed.state;
    results.push(...executed.results);
  }

  return { state, results };
}

function discoverySnapshotFor(options: {
  labels: TaskWorkflowLabels;
  issueLabels: string[];
  issueComments?: string[];
  prComments?: string[];
  prHead?: string;
}): RepositoryDiscoverySnapshot {
  return {
    repository: "demo/local-fixture",
    labels: options.labels,
    issues: [
      {
        number: 9001,
        title: "Coordinator demo task",
        state: "OPEN",
        labels: options.issueLabels,
        body: "Demo command active fixture issue.",
        comments: (options.issueComments ?? []).map((body, index) => ({
          id: `issue-comment-${index + 1}`,
          body,
          createdAt: `2026-08-08T00:0${index}:00Z`,
          updatedAt: `2026-08-08T00:0${index}:00Z`
        }))
      }
    ],
    pullRequests: [
      {
        number: 9002,
        title: "Demo implementation handoff",
        state: "OPEN",
        isDraft: true,
        headRefName: "codex/demo-fixture",
        headRefOid: options.prHead ?? "demo-head-1",
        body: "Closes #9001",
        closingIssueNumbers: [9001],
        comments: (options.prComments ?? []).map((body, index) => ({
          id: `pr-comment-${index + 1}`,
          body,
          createdAt: `2026-08-08T00:1${index}:00Z`,
          updatedAt: `2026-08-08T00:1${index}:00Z`
        })),
        checks: []
      }
    ]
  };
}

export async function resetDemo(repoRoot: string): Promise<DemoResult> {
  const stateDir = demoStateDir(repoRoot);
  await rm(stateDir, { recursive: true, force: true });
  await writeDemoOutput(repoRoot, demoOutputBaseline);
  return {
    mode: "reset",
    valid: true,
    demoMarker: demoArtifactMarker,
    steps: [],
    writeResults: [],
    diagnostics: ["Removed local demo state and restored demo output baseline."],
    resetPaths: [stateDir, demoOutputPath(repoRoot)],
    limitations: []
  };
}

async function loadPersistedDemoState(repoRoot: string): Promise<PersistedDemoState | undefined> {
  try {
    return JSON.parse(await readFile(demoStatePath(repoRoot), "utf8")) as PersistedDemoState;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function savePersistedDemoState(repoRoot: string, state: PersistedDemoState): Promise<void> {
  await mkdir(demoStateDir(repoRoot), { recursive: true });
  await writeFile(demoStatePath(repoRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function resumeFixtureDemo(repoRoot: string, approvalText: string | undefined): Promise<DemoResult> {
  const approval = evaluateExplicitApproval(approvalText);
  const persisted = await loadPersistedDemoState(repoRoot);
  const diagnostics: string[] = [];

  if (!persisted || (persisted.currentStage !== "manual-validation" && persisted.currentStage !== "complete")) {
    diagnostics.push("Demo resume requires a persisted manual-validation gate. Run `npm run coordinator -- demo --fixture` first.");
  }
  if (approval.status !== "approved") {
    diagnostics.push(`Explicit demo resume approval required: ${approval.reason ?? "approval missing"}`);
  }

  if (diagnostics.length > 0 || !persisted) {
    return {
      mode: "fixture",
      valid: false,
      repository: "demo/local-fixture",
      demoMarker: demoArtifactMarker,
      steps: [
        {
          index: 7,
          title: "Resume blocked",
          summary: "Completion cannot occur without a persisted HUMAN gate and explicit approval.",
          nextActor: "human",
          evidence: {
            persistedGate: persisted?.currentStage ?? "missing",
            approvalStatus: approval.status,
            mergePerformed: false
          }
        }
      ],
      writeResults: [],
      diagnostics,
      resetPaths: [demoStateDir(repoRoot)],
      limitations: ["Default demo behavior does not merge a pull request."]
    };
  }

  if (persisted.currentStage === "complete") {
    return {
      mode: "fixture",
      valid: true,
      repository: "demo/local-fixture",
      demoMarker: demoArtifactMarker,
      steps: persisted.steps,
      writeResults: persisted.writeResults,
      diagnostics: ["Demo completion already recorded; replay made no durable changes."],
      resetPaths: [demoStateDir(repoRoot), demoOutputPath(repoRoot)],
      limitations: [
        "Fixture resume records completion but does not merge a pull request.",
        "Fixture mode does not wake ChatGPT Web or Codex actors."
      ]
    };
  }

  const issue: DemoIssueState = { labels: ["manual-validation"], comments: [] };
  const calls: string[] = [];
  const adapter = demoAdapter(issue, calls);
  const policy: MutationPolicy = {
    enabled: true,
    allowed_actions: ["POST_HANDOFF_COMMENT"]
  };
  const completion = await executeActions({
    actions: [{
      type: "POST_HANDOFF_COMMENT",
      eventId: "demo/local-fixture|issue:9001|completion",
      repository: "demo/local-fixture",
      issueNumber: 9001,
      body: "DEMO COMPLETE\n\nExplicit demo resume approval recorded. Default demo did not merge the PR."
    }],
    adapter,
    policy,
    state: persisted.writeState
  });
  const writeResults = [...persisted.writeResults, ...completion.results];
  const completionStep: DemoStep = {
    index: persisted.steps.length + 1,
    title: "Explicit resume completion",
    summary: "Human approval resumes the paused demo and records completion without merging.",
    nextActor: "human",
    evidence: {
      approval: approval.evidence,
      completionStatuses: completion.results.map((result) => result.status),
      mergePerformed: false,
      adapterCalls: calls
    }
  };
  const steps = [...persisted.steps, completionStep];
  const nextState: PersistedDemoState = {
    status: "complete",
    currentStage: "complete",
    mergePerformed: false,
    writeState: completion.state,
    steps,
    writeResults,
    ...(approval.evidence ? { approvalEvidence: approval.evidence } : {})
  };
  await savePersistedDemoState(repoRoot, nextState);
  await writeDemoOutput(repoRoot, `${demoArtifactMarker}\n\nCoordinator demo reached the corrected implementation stage.\n\nCoordinator demo recorded explicit resume completion.\n`);

  return {
    mode: "fixture",
    valid: completion.results.every((result) => result.status === "succeeded" || result.status === "skipped"),
    repository: "demo/local-fixture",
    demoMarker: demoArtifactMarker,
    steps,
    writeResults,
    diagnostics: [],
    resetPaths: [demoStateDir(repoRoot), demoOutputPath(repoRoot)],
    limitations: [
      "Fixture resume records completion but does not merge a pull request.",
      "Fixture mode does not wake ChatGPT Web or Codex actors."
    ]
  };
}

export async function runFixtureDemo(repoRoot: string, options: Pick<DemoOptions, "resume" | "approvalText"> = {}): Promise<DemoResult> {
  if (options.resume) {
    return resumeFixtureDemo(repoRoot, options.approvalText);
  }

  const { config } = await loadProjectConfig(repoRoot);
  const labels = config.labels;
  const issue: DemoIssueState = { labels: [labels.implementation_ready], comments: [] };
  const calls: string[] = [];
  const adapter = demoAdapter(issue, calls);
  const policy: MutationPolicy = {
    enabled: true,
    allowed_actions: ["ADD_LABEL", "REMOVE_LABEL", "POST_HANDOFF_COMMENT", "MARK_REVIEW_READY"]
  };
  const steps: DemoStep[] = [];
  let writeState = createWriteSessionState();
  const writeResults: ActionExecutionResult[] = [];
  const sessionState = createDurableSessionState({ repository: "demo/local-fixture", inactivityTimeoutMinutes: 60 });

  steps.push({
    index: 1,
    title: "Approved demo directive",
    summary: "Approved demo directive becomes a demo-only codex-ready issue.",
    nextActor: "worker",
    evidence: {
      marker: demoArtifactMarker,
      issueNumber: 9001,
      labels: [...issue.labels],
      eventId: "demo|directive-approved"
    }
  });

  const pickup = runCycle(demoIssue(issue.labels, "demo/local-fixture|issue:9001|labels:codex-ready"), labels, sessionState, {
    pollIntervalMinutes: 10,
    npfPauseThreshold: 6
  }, true);
  const claim = await executeActions({
    actions: actionsForCycleDecision({ decision: pickup.decision, labels }),
    adapter,
    policy,
    state: writeState
  });
  writeState = claim.state;
  writeResults.push(...claim.results);
  const duplicateClaim = await executeActions({
    actions: actionsForCycleDecision({ decision: pickup.decision, labels }),
    adapter,
    policy,
    state: writeState
  });
  writeState = duplicateClaim.state;
  writeResults.push(...duplicateClaim.results);
  steps.push({
    index: 2,
    title: "Worker pickup",
    summary: "Coordinator routes the ready issue to the worker and applies the claim transition idempotently.",
    nextActor: "worker",
    evidence: {
      decision: pickup.decision.reason,
      labels: [...issue.labels],
      firstWriteStatuses: claim.results.map((result) => result.status),
      replayStatuses: duplicateClaim.results.map((result) => result.status),
      adapterCalls: [...calls]
    }
  });

  await writeDemoOutput(repoRoot, `${demoArtifactMarker}\n\nCoordinator demo reached the implementation stage.\n`);
  const handoff = await executeActions({
    actions: [{
      type: "MARK_REVIEW_READY",
      eventId: "demo/local-fixture|issue:9001|handoff",
      repository: "demo/local-fixture",
      issueNumber: 9001,
      inProgressLabel: labels.implementation_in_progress,
      reviewReadyLabel: labels.review_ready,
      commentBody: "CHAT REVIEW READY\n\nDemo fixture implementation handoff."
    }],
    adapter,
    policy,
    state: writeState
  });
  writeState = handoff.state;
  writeResults.push(...handoff.results);
  steps.push({
    index: 3,
    title: "Implementation handoff",
    summary: "Sample output is written and the demo issue moves to chat-review-ready with a handoff comment.",
    nextActor: "thinker",
    evidence: {
      output: "examples/demo/DEMO_OUTPUT.md",
      labels: [...issue.labels],
      handoffStatuses: handoff.results.map((result) => result.status)
    }
  });

  const correction = discoverRepositoryWork(discoverySnapshotFor({
    labels,
    issueLabels: [labels.review_ready],
    prComments: ["CHANGES_REQUESTED\n\nPlease add the word corrected to the demo output."]
  }));
  steps.push({
    index: 4,
    title: "Review correction",
    summary: "A newer correction event routes ownership back to the worker.",
    nextActor: correction.nextActor,
    evidence: {
      kind: correction.kind,
      reason: correction.reason,
      latestEvent: correction.latestEvent?.summary
    }
  });

  await writeDemoOutput(repoRoot, `${demoArtifactMarker}\n\nCoordinator demo reached the corrected implementation stage.\n`);
  const corrected = discoverRepositoryWork(discoverySnapshotFor({
    labels,
    issueLabels: [labels.review_ready],
    prComments: [
      "CHANGES_REQUESTED\n\nPlease add the word corrected to the demo output.",
      "CHAT REVIEW READY\n\nDemo correction applied."
    ],
    prHead: "demo-head-2"
  }));
  steps.push({
    index: 5,
    title: "Corrected handoff",
    summary: "The newer CHAT REVIEW READY event returns ownership to ChatGPT and the older correction no longer reclaims it.",
    nextActor: corrected.nextActor,
    evidence: {
      kind: corrected.kind,
      reason: corrected.reason,
      latestEvent: corrected.latestEvent?.summary,
      output: "examples/demo/DEMO_OUTPUT.md"
    }
  });

  const humanGate = runCycle(demoIssue([labels.manual_validation], "demo/local-fixture|issue:9001|labels:manual-validation"), labels, {
    ...pickup.state,
    status: "active",
    nextActor: "none"
  }, {
    pollIntervalMinutes: 10,
    npfPauseThreshold: 6
  }, true);
  steps.push({
    index: 6,
    title: "Manual validation gate",
    summary: "Manual validation pauses the workflow until an explicit human resume/approval.",
    nextActor: humanGate.state.nextActor ?? "human",
    evidence: {
      outcome: humanGate.decision.outcome,
      reason: humanGate.decision.reason,
      sessionStatus: humanGate.state.status,
      humanGate: humanGate.state.currentHumanGate
    }
  });

  const stateDir = demoStateDir(repoRoot);
  await savePersistedDemoState(repoRoot, {
    status: "paused",
    currentStage: "manual-validation",
    mergePerformed: false,
    writeState,
    steps,
    writeResults
  });
  await writeFile(path.join(stateDir, "fixture-result.json"), `${JSON.stringify({ steps, writeResults }, null, 2)}\n`, "utf8");

  return {
    mode: "fixture",
    valid: steps.length === 6 && humanGate.state.status === "paused",
    repository: "demo/local-fixture",
    demoMarker: demoArtifactMarker,
    steps,
    writeResults,
    diagnostics: [],
    resetPaths: [stateDir, demoOutputPath(repoRoot)],
    limitations: [
      "Fixture mode does not wake ChatGPT Web or Codex actors.",
      "Default demo stops before merge and manual validation completion."
    ]
  };
}

export async function runLiveDemoPlan(options: DemoOptions): Promise<DemoResult> {
  const { config } = await loadProjectConfig(options.repoRoot);
  const configuredRepository = config.project.repo;
  const repository = options.repository;
  const diagnostics: string[] = [];

  if (!repository) {
    diagnostics.push("Usage: demo --repo <owner/repo> [--execute-writes].");
  }
  if (options.executeWrites && !configuredRepository) {
    diagnostics.push("GIT_WRITE_REPOSITORY_REQUIRED: live demo writes require config.project.repo.");
  }
  if (options.executeWrites && repository && configuredRepository && repository !== configuredRepository) {
    diagnostics.push(`GIT_WRITE_REPOSITORY_MISMATCH: live demo target ${repository} does not match configured repository ${configuredRepository}.`);
  }

  if (!options.executeWrites) {
    const valid = diagnostics.length === 0;
    return {
      mode: "live-dry-run",
      valid,
      ...(repository ? { repository } : {}),
      demoMarker: demoArtifactMarker,
      steps: [
        {
          index: 1,
          title: "Live demo dry run",
          summary: "Live demo dry run describes the safe artifact path without writing to GitHub.",
          nextActor: "human",
          evidence: {
            configuredRepository: configuredRepository ?? null,
            requestedRepository: repository ?? null,
            executeWrites: false,
            marker: demoArtifactMarker
          }
        }
      ],
      writeResults: [],
      diagnostics,
      resetPaths: [demoStateDir(options.repoRoot)],
      limitations: [
        "Live demo does not fabricate ChatGPT Web or Codex actor wake-up.",
        "Live write mode must use demo-marked artifacts and remains stopped before merge by default."
      ]
    };
  }

  if (diagnostics.length > 0 || !repository) {
    return {
      mode: "live-write",
      valid: false,
      ...(repository ? { repository } : {}),
      demoMarker: demoArtifactMarker,
      steps: [
        {
          index: 1,
          title: "Live demo write gate",
          summary: "Live demo writes are allowed only after exact repository match and explicit write opt-in.",
          nextActor: "human",
          evidence: {
            configuredRepository: configuredRepository ?? null,
            requestedRepository: repository ?? null,
            executeWrites: true,
            marker: demoArtifactMarker
          }
        }
      ],
      writeResults: [],
      diagnostics,
      resetPaths: [demoStateDir(options.repoRoot)],
      limitations: [
        "Live demo does not fabricate ChatGPT Web or Codex actor wake-up.",
        "Live write mode must use demo-marked artifacts and remains stopped before merge by default."
      ]
    };
  }

  const eventId = `${repository}|demo:create-issue:first-run`;
  const stateFilePath = liveWriteStatePath(options.repoRoot);
  const state = await loadWriteState(stateFilePath);
  const action: CoordinatorAction = {
    type: "CREATE_ISSUE",
    eventId,
    repository,
    title: "Coordinator demo artifact (non-production)",
    body: `${demoArtifactMarker}\n\nThis issue was created by the guarded live coordinator demo. It is a non-production artifact and must not be picked up as normal implementation work.`,
    labels: []
  };
  const actionOptions = {
    action,
    state,
    adapter: options.adapter ?? createGhWriteAdapter()
  };
  const executed = await executeCoordinatorAction(
    config.github_writes ? { ...actionOptions, policy: config.github_writes } : actionOptions
  );
  await saveWriteState(stateFilePath, executed.state);
  const valid = executed.results.every((result) => result.status === "succeeded" || result.status === "skipped");

  return {
    mode: "live-write",
    valid,
    repository,
    demoMarker: demoArtifactMarker,
    steps: [
      {
        index: 1,
        title: "Live demo write",
        summary: "Explicit live write mode created or replayed one demo-marked non-production GitHub issue through the governed write adapter.",
        nextActor: "human",
        evidence: {
          configuredRepository,
          requestedRepository: repository,
          eventId,
          action: "CREATE_ISSUE",
          marker: demoArtifactMarker,
          statuses: executed.results.map((result) => result.status)
        }
      }
    ],
    writeResults: executed.results,
    diagnostics,
    resetPaths: [demoStateDir(options.repoRoot), stateFilePath],
    limitations: [
      "Live demo does not fabricate ChatGPT Web or Codex actor wake-up.",
      "Live write mode creates only a demo-marked issue and remains stopped before merge by default."
    ]
  };
}

export async function runDemo(options: DemoOptions): Promise<DemoResult> {
  if (options.reset) {
    return resetDemo(options.repoRoot);
  }
  if (options.fixture || (!options.repository && !options.executeWrites)) {
    return runFixtureDemo(options.repoRoot, options);
  }
  return runLiveDemoPlan(options);
}
