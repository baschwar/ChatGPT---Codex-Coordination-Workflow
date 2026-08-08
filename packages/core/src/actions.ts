import type { GitHubWriteAdapter, GitHubWriteResult } from "../../github-adapter/src/types.js";
import type { CycleDecision } from "./session.js";
import type { TaskWorkflowLabels } from "./state.js";

export type CoordinatorActionType =
  | "CREATE_ISSUE"
  | "ADD_LABEL"
  | "REMOVE_LABEL"
  | "POST_HANDOFF_COMMENT"
  | "MARK_REVIEW_READY"
  | "PAUSE_FOR_HUMAN"
  | "NO_ACTION"
  | "UPDATE_ISSUE_STATE";

export interface MutationPolicy {
  enabled?: boolean;
  allowed_actions?: CoordinatorActionType[];
}

export interface WriteEventRecord {
  eventId: string;
  action: CoordinatorActionType;
  status: "succeeded" | "failed" | "skipped";
  url?: string;
  issueNumber?: number;
  diagnostics: string[];
}

export interface WriteSessionState {
  handledWriteEvents: Record<string, WriteEventRecord>;
}

export type CoordinatorAction =
  | {
      type: "CREATE_ISSUE";
      eventId: string;
      repository: string;
      title: string;
      body: string;
      labels: string[];
    }
  | {
      type: "ADD_LABEL" | "REMOVE_LABEL";
      eventId: string;
      repository: string;
      issueNumber: number;
      labels: string[];
    }
  | {
      type: "POST_HANDOFF_COMMENT";
      eventId: string;
      repository: string;
      issueNumber: number;
      body: string;
    }
  | {
      type: "MARK_REVIEW_READY";
      eventId: string;
      repository: string;
      issueNumber: number;
      inProgressLabel: string;
      reviewReadyLabel: string;
      commentBody?: string;
    }
  | {
      type: "UPDATE_ISSUE_STATE";
      eventId: string;
      repository: string;
      issueNumber: number;
      state: "open" | "closed";
    }
  | {
      type: "PAUSE_FOR_HUMAN" | "NO_ACTION";
      eventId: string;
      reason: string;
    };

export interface ActionExecutionResult {
  action: CoordinatorActionType;
  eventId: string;
  status: "succeeded" | "failed" | "skipped";
  url?: string;
  issueNumber?: number;
  diagnostics: string[];
}

export function createWriteSessionState(): WriteSessionState {
  return { handledWriteEvents: {} };
}

export function isActionAllowed(policy: MutationPolicy | undefined, action: CoordinatorActionType): boolean {
  if (!policy?.enabled) {
    return false;
  }

  return policy.allowed_actions?.includes(action) === true;
}

function skipped(action: CoordinatorAction, diagnostics: string[]): ActionExecutionResult {
  return {
    action: action.type,
    eventId: action.eventId,
    status: "skipped",
    diagnostics
  };
}

function failed(action: CoordinatorAction, diagnostics: string[]): ActionExecutionResult {
  return {
    action: action.type,
    eventId: action.eventId,
    status: "failed",
    diagnostics
  };
}

function resultFromWrite(action: CoordinatorAction, write: GitHubWriteResult): ActionExecutionResult {
  const result: ActionExecutionResult = {
    action: action.type,
    eventId: action.eventId,
    status: write.ok ? "succeeded" : "failed",
    diagnostics: write.diagnostics
  };

  if (write.url) {
    result.url = write.url;
  }
  if (write.issue) {
    result.issueNumber = write.issue.number;
  }

  return result;
}

function recordResult(state: WriteSessionState, result: ActionExecutionResult): WriteSessionState {
  return {
    handledWriteEvents: {
      ...state.handledWriteEvents,
      [result.eventId]: {
        eventId: result.eventId,
        action: result.action,
        status: result.status,
        diagnostics: result.diagnostics,
        ...(result.url ? { url: result.url } : {}),
        ...(result.issueNumber ? { issueNumber: result.issueNumber } : {})
      }
    }
  };
}

async function executeAllowedAction(action: CoordinatorAction, adapter: GitHubWriteAdapter): Promise<ActionExecutionResult[]> {
  if (action.type === "CREATE_ISSUE") {
    return [resultFromWrite(action, await adapter.createIssue(action))];
  }

  if (action.type === "ADD_LABEL") {
    return [resultFromWrite(action, await adapter.addLabels(action))];
  }

  if (action.type === "REMOVE_LABEL") {
    return [resultFromWrite(action, await adapter.removeLabels(action))];
  }

  if (action.type === "POST_HANDOFF_COMMENT") {
    return [resultFromWrite(action, await adapter.postComment({ ...action, body: action.body }))];
  }

  if (action.type === "UPDATE_ISSUE_STATE") {
    return [resultFromWrite(action, await adapter.updateIssueState(action))];
  }

  if (action.type === "MARK_REVIEW_READY") {
    const removeResult = resultFromWrite(
      action,
      await adapter.removeLabels({
        repository: action.repository,
        issueNumber: action.issueNumber,
        labels: [action.inProgressLabel],
        eventId: `${action.eventId}:remove-in-progress`
      })
    );

    if (removeResult.status !== "succeeded") {
      return [removeResult];
    }

    const addResult = resultFromWrite(
      action,
      await adapter.addLabels({
        repository: action.repository,
        issueNumber: action.issueNumber,
        labels: [action.reviewReadyLabel],
        eventId: `${action.eventId}:add-review-ready`
      })
    );
    const results = [removeResult, addResult];

    if (addResult.status === "succeeded" && action.commentBody) {
      results.push(
        resultFromWrite(
          action,
          await adapter.postComment({
            repository: action.repository,
            issueNumber: action.issueNumber,
            body: action.commentBody,
            eventId: `${action.eventId}:comment`
          })
        )
      );
    }

    return results;
  }

  return [skipped(action, ["No GitHub write is associated with this action."])];
}

export async function executeCoordinatorAction(options: {
  action: CoordinatorAction;
  policy?: MutationPolicy;
  state: WriteSessionState;
  adapter: GitHubWriteAdapter;
}): Promise<{ state: WriteSessionState; results: ActionExecutionResult[] }> {
  const { action, policy, adapter } = options;
  let state = options.state;

  if (action.type === "NO_ACTION" || action.type === "PAUSE_FOR_HUMAN") {
    const result = skipped(action, ["Action is intentionally quiet."]);
    return { state: recordResult(state, result), results: [result] };
  }

  if (state.handledWriteEvents[action.eventId]?.status === "succeeded") {
    return {
      state,
      results: [skipped(action, [`Write event has already been handled: ${action.eventId}`])]
    };
  }

  if (!isActionAllowed(policy, action.type)) {
    const result = failed(action, [`Mutation policy does not allow ${action.type}.`]);
    return { state: recordResult(state, result), results: [result] };
  }

  const results = await executeAllowedAction(action, adapter);
  for (const result of results) {
    state = recordResult(state, result);
  }

  return { state, results };
}

export function actionsForCycleDecision(options: {
  decision: CycleDecision;
  labels: TaskWorkflowLabels;
  handoffBody?: string;
}): CoordinatorAction[] {
  const { decision, labels } = options;

  if (decision.outcome === "NPF") {
    return [{ type: "NO_ACTION", eventId: `${decision.eventId}:no-action`, reason: decision.reason }];
  }

  if (decision.outcome === "HUMAN") {
    return [{ type: "PAUSE_FOR_HUMAN", eventId: `${decision.eventId}:human`, reason: decision.reason }];
  }

  if (!decision.issue) {
    return [{ type: "NO_ACTION", eventId: `${decision.eventId}:missing-issue`, reason: "actionable decision has no issue context" }];
  }

  const actions: CoordinatorAction[] = [];

  if (decision.pickup.action === "claim-and-branch") {
    actions.push({
      type: "REMOVE_LABEL",
      eventId: `${decision.eventId}:remove-ready`,
      repository: decision.repository,
      issueNumber: decision.issue.number,
      labels: [labels.implementation_ready]
    });
    actions.push({
      type: "ADD_LABEL",
      eventId: `${decision.eventId}:add-in-progress`,
      repository: decision.repository,
      issueNumber: decision.issue.number,
      labels: [labels.implementation_in_progress]
    });
  }

  if (options.handoffBody) {
    actions.push({
      type: "POST_HANDOFF_COMMENT",
      eventId: `${decision.eventId}:handoff-comment`,
      repository: decision.repository,
      issueNumber: decision.issue.number,
      body: options.handoffBody
    });
  }

  if (actions.length === 0) {
    return [{ type: "NO_ACTION", eventId: `${decision.eventId}:no-write-action`, reason: "No configured write action for decision." }];
  }

  return actions;
}
