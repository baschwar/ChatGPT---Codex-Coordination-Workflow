import type { CycleDecision } from "./session.js";

export type ActorTransportKind = "none" | "mock" | "external";

export interface ActorInvocation {
  actor: "thinker" | "worker" | "human" | "none";
  transport: ActorTransportKind;
  decision: CycleDecision;
  supported: boolean;
  diagnostics: string[];
}

export interface ActorTransport {
  kind: ActorTransportKind;
  invoke(decision: CycleDecision): ActorInvocation;
}

export function actorForDecision(decision: CycleDecision): ActorInvocation["actor"] {
  if (decision.outcome === "HUMAN") {
    return "human";
  }

  if (decision.outcome === "ACTION") {
    return "worker";
  }

  return "none";
}

export function createNoopActorTransport(): ActorTransport {
  return {
    kind: "none",
    invoke(decision) {
      return {
        actor: actorForDecision(decision),
        transport: "none",
        decision,
        supported: false,
        diagnostics: ["No actor transport is configured; leave workflow state unchanged and surface the decision."]
      };
    }
  };
}

export function createMockActorTransport(): ActorTransport {
  return {
    kind: "mock",
    invoke(decision) {
      return {
        actor: actorForDecision(decision),
        transport: "mock",
        decision,
        supported: true,
        diagnostics: []
      };
    }
  };
}
