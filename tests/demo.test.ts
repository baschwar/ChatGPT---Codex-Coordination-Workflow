import test from "node:test";
import assert from "node:assert/strict";
import { runDemo, demoArtifactMarker } from "../apps/cli/src/demo.js";
import { discoverRepositoryWork } from "../packages/core/src/discovery.js";

const repoRoot = process.cwd();
const labels = {
  implementation_ready: "codex-ready",
  implementation_in_progress: "codex-in-progress",
  manual_validation: "manual-validation",
  review_ready: "chat-review-ready"
};

test("fixture demo completes deterministically with six visible stages", async () => {
  await runDemo({ repoRoot, reset: true });
  const result = await runDemo({ repoRoot, fixture: true });

  assert.equal(result.valid, true);
  assert.equal(result.mode, "fixture");
  assert.deepEqual(result.steps.map((step) => step.title), [
    "Approved demo directive",
    "Worker pickup",
    "Implementation handoff",
    "Review correction",
    "Corrected handoff",
    "Manual validation gate"
  ]);
});

test("fixture demo write event IDs are idempotent", async () => {
  await runDemo({ repoRoot, reset: true });
  const result = await runDemo({ repoRoot, fixture: true });
  const workerPickup = result.steps.find((step) => step.title === "Worker pickup");

  assert.deepEqual(workerPickup?.evidence.replayStatuses, ["skipped", "skipped"]);
});

test("fixture demo routes older correction and newer review-ready handoff correctly", async () => {
  await runDemo({ repoRoot, reset: true });
  const result = await runDemo({ repoRoot, fixture: true });
  const correction = result.steps.find((step) => step.title === "Review correction");
  const corrected = result.steps.find((step) => step.title === "Corrected handoff");

  assert.equal(correction?.nextActor, "worker");
  assert.equal(correction?.evidence.kind, "resume-existing-pr");
  assert.equal(corrected?.nextActor, "thinker");
  assert.equal(corrected?.evidence.kind, "chat-review-ready");
});

test("fixture demo pauses at a human gate and does not auto-resume", async () => {
  await runDemo({ repoRoot, reset: true });
  const result = await runDemo({ repoRoot, fixture: true });
  const humanGate = result.steps.find((step) => step.title === "Manual validation gate");

  assert.equal(humanGate?.nextActor, "human");
  assert.equal(humanGate?.evidence.sessionStatus, "paused");
  assert.equal(humanGate?.evidence.humanGate, "manual-validation-required");
});

test("fixture demo completion requires explicit resume approval", async () => {
  await runDemo({ repoRoot, reset: true });
  await runDemo({ repoRoot, fixture: true });
  const result = await runDemo({ repoRoot, fixture: true, resume: true });

  assert.equal(result.valid, false);
  assert.equal(result.steps[0]?.title, "Resume blocked");
  assert.match(result.diagnostics.join("\n"), /Explicit demo resume approval required/);
});

test("fixture demo explicit resume records completion and replays idempotently without merge", async () => {
  await runDemo({ repoRoot, reset: true });
  await runDemo({ repoRoot, fixture: true });
  const first = await runDemo({ repoRoot, fixture: true, resume: true, approvalText: "approved" });
  const second = await runDemo({ repoRoot, fixture: true, resume: true, approvalText: "approved" });
  const firstCompletion = first.steps.find((step) => step.title === "Explicit resume completion");
  const secondCompletion = second.steps.filter((step) => step.title === "Explicit resume completion").at(-1);

  assert.equal(first.valid, true);
  assert.equal(firstCompletion?.evidence.mergePerformed, false);
  assert.deepEqual(firstCompletion?.evidence.completionStatuses, ["succeeded"]);
  assert.equal(second.valid, true);
  assert.deepEqual(secondCompletion?.evidence.completionStatuses, ["skipped"]);
  assert.equal(secondCompletion?.evidence.mergePerformed, false);
});

test("live demo write mode refuses missing or mismatched repositories", async () => {
  const missing = await runDemo({ repoRoot, executeWrites: true });
  const mismatched = await runDemo({ repoRoot, repository: "example/other", executeWrites: true });

  assert.equal(missing.valid, false);
  assert.match(missing.diagnostics.join("\n"), /Usage: demo --repo/);
  assert.equal(mismatched.valid, false);
  assert.match(mismatched.diagnostics.join("\n"), /GIT_WRITE_REPOSITORY_MISMATCH/);
});

test("demo artifacts are excluded from normal production pickup", () => {
  const result = discoverRepositoryWork({
    repository: "example/repo",
    labels,
    issues: [
      {
        number: 12,
        title: "Demo artifact",
        state: "OPEN",
        labels: ["codex-ready"],
        body: `${demoArtifactMarker}\nDemo issue.`
      }
    ],
    pullRequests: []
  });

  assert.equal(result.kind, "non-actionable-artifact");
  assert.equal(result.nextActor, "none");
});

test("demo reset returns local demo state to a known clean state", async () => {
  const result = await runDemo({ repoRoot, reset: true });

  assert.equal(result.valid, true);
  assert.equal(result.mode, "reset");
  assert.match(result.diagnostics.join("\n"), /Removed local demo state/);
});
