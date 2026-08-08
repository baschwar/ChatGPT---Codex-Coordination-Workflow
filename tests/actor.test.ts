import test from "node:test";
import assert from "node:assert/strict";
import { actorForDecision, createMockActorTransport, createNoopActorTransport } from "../packages/core/src/actor.js";
import type { CycleDecision } from "../packages/core/src/session.js";

function decision(outcome: CycleDecision["outcome"]): CycleDecision {
  return {
    repository: "example/repo",
    eventId: `example/repo|${outcome}`,
    pickup: { action: outcome === "ACTION" ? "claim-and-branch" : "wait", reason: outcome === "ACTION" ? "new-ready-issue" : "not-in-implementation-queue" },
    outcome,
    reason: outcome === "ACTION" ? "new-ready-issue" : "no-eligible-open-work",
    diagnostics: []
  };
}

test("actor boundary maps workflow outcomes to next actors", () => {
  assert.equal(actorForDecision(decision("ACTION")), "worker");
  assert.equal(actorForDecision(decision("HUMAN")), "human");
  assert.equal(actorForDecision(decision("NPF")), "none");
});

test("noop actor transport is explicit about unsupported automation", () => {
  const result = createNoopActorTransport().invoke(decision("ACTION"));

  assert.equal(result.supported, false);
  assert.equal(result.transport, "none");
  assert.match(result.diagnostics[0] ?? "", /No actor transport/);
});

test("mock actor transport supports test-only invocation", () => {
  const result = createMockActorTransport().invoke(decision("ACTION"));

  assert.equal(result.supported, true);
  assert.equal(result.actor, "worker");
  assert.equal(result.transport, "mock");
});

test("mock actor transport leaves NPF quiet", () => {
  const result = createMockActorTransport().invoke(decision("NPF"));

  assert.equal(result.supported, true);
  assert.equal(result.actor, "none");
  assert.equal(result.transport, "mock");
});
