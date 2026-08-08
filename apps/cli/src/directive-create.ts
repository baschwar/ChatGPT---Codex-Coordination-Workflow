import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectConfig } from "../../../packages/config/src/load.js";
import {
  executeCoordinatorAction,
  createWriteSessionState,
  type ActionExecutionResult,
  type CoordinatorAction,
  type WriteSessionState
} from "../../../packages/core/src/actions.js";
import { evaluateExplicitApproval } from "../../../packages/core/src/approval.js";
import { renderImplementationIssue, validateDirective, type ApprovedDirective } from "../../../packages/core/src/templates.js";
import type { GitHubWriteAdapter } from "../../../packages/github-adapter/src/types.js";
import { createGhWriteAdapter } from "./github-write-adapter.js";

export interface DirectiveCreateOptions {
  repoRoot: string;
  directivePath: string;
  approvalText?: string;
  dryRun?: boolean;
  eventId?: string;
  stateFilePath?: string;
  adapter?: GitHubWriteAdapter;
}

export interface DirectiveCreateResult {
  mode: "DRY RUN" | "WRITE";
  valid: boolean;
  eventId: string;
  repository?: string;
  title?: string;
  issueBody?: string;
  alreadyHandled: boolean;
  errors: string[];
  results: ActionExecutionResult[];
}

export function defaultWriteStateFile(repoRoot: string): string {
  return path.join(repoRoot, ".chatgpt-coordinator", "write-events.json");
}

function stableEventId(directive: ApprovedDirective): string {
  const hash = createHash("sha256").update(JSON.stringify(directive)).digest("hex").slice(0, 16);
  return `directive:create-issue:${hash}`;
}

function isWriteSessionState(value: unknown): value is WriteSessionState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { handledWriteEvents?: unknown };
  return typeof candidate.handledWriteEvents === "object" && candidate.handledWriteEvents !== null;
}

export async function loadWriteState(stateFilePath: string): Promise<WriteSessionState> {
  try {
    const parsed = JSON.parse(await readFile(stateFilePath, "utf8")) as unknown;
    if (!isWriteSessionState(parsed)) {
      throw new Error("write state file does not contain a valid coordinator write session");
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return createWriteSessionState();
    }
    throw error;
  }
}

export async function saveWriteState(stateFilePath: string, state: WriteSessionState): Promise<void> {
  await mkdir(path.dirname(stateFilePath), { recursive: true });
  await writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function createDirectiveIssue(options: DirectiveCreateOptions): Promise<DirectiveCreateResult> {
  const rawDirective = JSON.parse(await readFile(options.directivePath, "utf8")) as Partial<ApprovedDirective>;
  const directiveErrors = validateDirective(rawDirective);
  const approval = evaluateExplicitApproval(options.approvalText);
  const errors = [...directiveErrors];

  if (approval.status !== "approved") {
    errors.push(approval.reason ?? "Explicit approval is required.");
  }

  if (errors.length > 0) {
    return {
      mode: options.dryRun ? "DRY RUN" : "WRITE",
      valid: false,
      eventId: options.eventId ?? "unavailable",
      alreadyHandled: false,
      errors,
      results: []
    };
  }

  const directive = rawDirective as ApprovedDirective;
  const { config } = await loadProjectConfig(options.repoRoot);
  const eventId = options.eventId ?? stableEventId(directive);
  const issueBody = renderImplementationIssue(directive);
  const repository = config.project.repo;
  const stateFilePath = options.stateFilePath ?? defaultWriteStateFile(options.repoRoot);

  if (!repository) {
    return {
      mode: options.dryRun ? "DRY RUN" : "WRITE",
      valid: false,
      eventId,
      title: directive.objective,
      issueBody,
      alreadyHandled: false,
      errors: ["project.repo is required before creating GitHub issues."],
      results: []
    };
  }

  if (config.approval_gates.create_implementation_issue !== "explicit") {
    return {
      mode: options.dryRun ? "DRY RUN" : "WRITE",
      valid: false,
      eventId,
      repository,
      title: directive.objective,
      issueBody,
      alreadyHandled: false,
      errors: ["create_implementation_issue approval gate must be explicit."],
      results: []
    };
  }

  const state = await loadWriteState(stateFilePath);
  if (state.handledWriteEvents[eventId]?.status === "succeeded") {
    return {
      mode: options.dryRun ? "DRY RUN" : "WRITE",
      valid: true,
      eventId,
      repository,
      title: directive.objective,
      issueBody,
      alreadyHandled: true,
      errors: [],
      results: [
        {
          action: "CREATE_ISSUE",
          eventId,
          status: "skipped",
          diagnostics: [`Write event has already been handled: ${eventId}`],
          ...(state.handledWriteEvents[eventId].url ? { url: state.handledWriteEvents[eventId].url } : {}),
          ...(state.handledWriteEvents[eventId].issueNumber ? { issueNumber: state.handledWriteEvents[eventId].issueNumber } : {})
        }
      ]
    };
  }

  if (options.dryRun) {
    return {
      mode: "DRY RUN",
      valid: true,
      eventId,
      repository,
      title: directive.objective,
      issueBody,
      alreadyHandled: false,
      errors: [],
      results: []
    };
  }

  const action: CoordinatorAction = {
    type: "CREATE_ISSUE",
    eventId,
    repository,
    title: directive.objective,
    body: issueBody,
    labels: [config.labels.implementation_ready]
  };
  const actionOptions = {
    action,
    state,
    adapter: options.adapter ?? createGhWriteAdapter()
  };
  const { state: nextState, results } = await executeCoordinatorAction(
    config.github_writes ? { ...actionOptions, policy: config.github_writes } : actionOptions
  );
  await saveWriteState(stateFilePath, nextState);

  return {
    mode: "WRITE",
    valid: results.every((result) => result.status === "succeeded"),
    eventId,
    repository,
    title: directive.objective,
    issueBody,
    alreadyHandled: false,
    errors: results.flatMap((result) => (result.status === "failed" ? result.diagnostics : [])),
    results
  };
}
