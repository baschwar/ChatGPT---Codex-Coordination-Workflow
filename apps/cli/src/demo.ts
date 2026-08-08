import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectConfig } from "../../../packages/config/src/load.js";
import {
  actionsForCycleDecision,
  createWriteSessionState,
  executeCoordinatorAction,
  type ActionExecutionResult,
  type CoordinatorAction,
  type MutationPolicy
} from "../../../packages/core/src/actions.js";
import { discoverRepositoryWork, type RepositoryDiscoverySnapshot } from "../../../packages/core/src/discovery.js";
import { createDurableSessionState, runCycle, type WorkflowRepositorySnapshot } from "../../../packages/core/src/session.js";
import type { TaskWorkflowLabels } from "../../../packages/core/src/state.js";
import type { GitHubWriteAdapter, GitHubWriteResult } from "../../../packages/github-adapter/src/types.js";

export const demoArtifactMarker = "<!-- coordinator:demo-artifact -->";

export interface DemoOptions {
  repoRoot: string;
  fixture?: boolean;
  repository?: string;
  executeWrites?: boolean;
  reset?: boolean;
  json?: boolean;
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

function demoStateDir(repoRoot: string): string {
  return path.join(repoRoot, ".chatgpt-coordinator", "demo");
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
  state: ReturnType<typeof createWriteSessionState>;
}): Promise<{ state: ReturnType<typeof createWriteSessionState>; results: ActionExecutionResult[] }> {
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
  return {
    mode: "reset",
    valid: true,
    demoMarker: demoArtifactMarker,
    steps: [],
    writeResults: [],
    diagnostics: ["Removed local demo state."],
    resetPaths: [stateDir],
    limitations: []
  };
}

export async function runFixtureDemo(repoRoot: string): Promise<DemoResult> {
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

  await writeFile(path.join(repoRoot, "examples", "demo", "DEMO_OUTPUT.md"), `${demoArtifactMarker}\n\nCoordinator demo reached the implementation stage.\n`, "utf8");
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

  await writeFile(path.join(repoRoot, "examples", "demo", "DEMO_OUTPUT.md"), `${demoArtifactMarker}\n\nCoordinator demo reached the corrected implementation stage.\n`, "utf8");
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
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, "fixture-result.json"), `${JSON.stringify({ steps, writeResults }, null, 2)}\n`, "utf8");

  return {
    mode: "fixture",
    valid: steps.length === 6 && humanGate.state.status === "paused",
    repository: "demo/local-fixture",
    demoMarker: demoArtifactMarker,
    steps,
    writeResults,
    diagnostics: [],
    resetPaths: [stateDir, path.join(repoRoot, "examples", "demo", "DEMO_OUTPUT.md")],
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

  const valid = diagnostics.length === 0;
  return {
    mode: options.executeWrites ? "live-write" : "live-dry-run",
    valid,
    ...(repository ? { repository } : {}),
    demoMarker: demoArtifactMarker,
    steps: [
      {
        index: 1,
        title: options.executeWrites ? "Live demo write gate" : "Live demo dry run",
        summary: options.executeWrites
          ? "Live demo writes are allowed only after exact repository match and explicit write opt-in."
          : "Live demo dry run describes the safe artifact path without writing to GitHub.",
        nextActor: valid ? "human" : "human",
        evidence: {
          configuredRepository: configuredRepository ?? null,
          requestedRepository: repository ?? null,
          executeWrites: options.executeWrites === true,
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

export async function runDemo(options: DemoOptions): Promise<DemoResult> {
  if (options.reset) {
    return resetDemo(options.repoRoot);
  }
  if (options.fixture || (!options.repository && !options.executeWrites)) {
    return runFixtureDemo(options.repoRoot);
  }
  return runLiveDemoPlan(options);
}
