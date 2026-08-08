import test from "node:test";
import assert from "node:assert/strict";
import { discoverRepositoryWork, findRelatedPullRequests, type RepositoryDiscoverySnapshot } from "../packages/core/src/discovery.js";

const labels = {
  implementation_ready: "codex-ready",
  implementation_in_progress: "codex-in-progress",
  manual_validation: "manual-validation",
  review_ready: "chat-review-ready"
};

function snapshot(input: Partial<RepositoryDiscoverySnapshot>): RepositoryDiscoverySnapshot {
  return {
    repository: "example/repo",
    labels,
    issues: [],
    pullRequests: [],
    ...input
  };
}

test("discovers a new codex-ready issue as worker implementation work", () => {
  const result = discoverRepositoryWork(snapshot({
    issues: [{ number: 9, title: "Beta 4", labels: ["codex-ready"], updatedAt: "2026-08-08T18:35:08Z" }]
  }));

  assert.equal(result.kind, "new-ready-issue");
  assert.equal(result.nextActor, "worker");
  assert.equal(result.issue?.number, 9);
  assert.equal(result.reason, "implementation-ready-label");
});

test("discovers continuation on an existing PR when no ready issue exists", () => {
  const result = discoverRepositoryWork(snapshot({
    issues: [{ number: 6, title: "Beta 3", labels: ["codex-in-progress"], updatedAt: "2026-08-08T18:00:00Z" }],
    pullRequests: [
      {
        number: 8,
        title: "Beta 3 PR",
        state: "OPEN",
        headRefName: "codex/issue-6-beta-3-github-writes",
        headRefOid: "abc123",
        updatedAt: "2026-08-08T18:10:00Z",
        closingIssueNumbers: [6],
        comments: [
          {
            id: "comment-1",
            body: "CONTINUE BETA 3 CORRECTIONS. Please address requested corrections.",
            updatedAt: "2026-08-08T18:12:00Z"
          }
        ]
      }
    ]
  }));

  assert.equal(result.kind, "resume-existing-pr");
  assert.equal(result.nextActor, "worker");
  assert.equal(result.issue?.number, 6);
  assert.equal(result.pullRequest?.number, 8);
  assert.equal(result.latestEvent?.id, "comment-1");
});

test("latest requested-changes review selects Codex as next actor", () => {
  const result = discoverRepositoryWork(snapshot({
    issues: [{ number: 6, title: "Beta 3", labels: ["chat-review-ready"] }],
    pullRequests: [
      {
        number: 8,
        title: "Beta 3 PR",
        state: "OPEN",
        headRefName: "codex/issue-6",
        headRefOid: "def456",
        reviews: [{ id: "review-1", state: "CHANGES_REQUESTED", submittedAt: "2026-08-08T18:20:00Z" }]
      }
    ]
  }));

  assert.equal(result.kind, "resume-existing-pr");
  assert.equal(result.nextActor, "worker");
  assert.equal(result.reason, "latest-pr-event-requests-codex-corrections");
});

test("chat-review-ready label selects ChatGPT with PR and check context", () => {
  const result = discoverRepositoryWork(snapshot({
    issues: [{ number: 6, title: "Beta 3", labels: ["chat-review-ready"] }],
    pullRequests: [
      {
        number: 8,
        title: "Beta 3 PR",
        state: "OPEN",
        headRefName: "codex/issue-6",
        headRefOid: "fedcba",
        isDraft: true,
        checks: [{ name: "test", status: "COMPLETED", conclusion: "SUCCESS" }]
      }
    ]
  }));

  assert.equal(result.kind, "chat-review-ready");
  assert.equal(result.nextActor, "thinker");
  assert.equal(result.pullRequest?.number, 8);
  assert.equal(result.pullRequest?.checkState, "passing");
  assert.equal(result.pullRequest?.isDraft, true);
});

test("associates PRs through explicit issue references and branch convention", () => {
  const issue = { number: 12, title: "Discovery", labels: ["codex-in-progress"] };
  const pullRequests = [
    { number: 10, title: "Unrelated", state: "OPEN" as const, headRefName: "codex/other" },
    { number: 11, title: "Fixes #12", state: "OPEN" as const, body: "Closes #12" },
    { number: 12, title: "Branch", state: "OPEN" as const, headRefName: "codex/issue-12-discovery" }
  ];

  assert.deepEqual(findRelatedPullRequests(issue, pullRequests).map((pullRequest) => pullRequest.number), [11, 12]);
});

test("ambiguous deterministic PR association returns a human gate", () => {
  const result = discoverRepositoryWork(snapshot({
    issues: [{ number: 12, title: "Discovery", labels: ["codex-in-progress"] }],
    pullRequests: [
      { number: 11, title: "Fixes #12", state: "OPEN", body: "Fixes #12" },
      { number: 12, title: "Branch", state: "OPEN", headRefName: "codex/issue-12-discovery" }
    ]
  }));

  assert.equal(result.kind, "human-gate");
  assert.equal(result.nextActor, "human");
  assert.equal(result.reason, "ambiguous-related-pull-requests");
});

test("non-actionable artifacts are excluded from implementation pickup", () => {
  const result = discoverRepositoryWork(snapshot({
    issues: [
      {
        number: 7,
        title: "Smoke artifact",
        labels: ["codex-ready"],
        body: "<!-- coordinator:non-actionable-artifact -->\nDo not claim."
      }
    ]
  }));

  assert.equal(result.kind, "non-actionable-artifact");
  assert.equal(result.nextActor, "none");
});

test("legacy smoke-test artifact guard phrase remains excluded", () => {
  const result = discoverRepositoryWork(snapshot({
    issues: [
      {
        number: 7,
        title: "Smoke artifact",
        labels: ["chat-review-ready"],
        body: "Do not implement the smoke-test issue as product work."
      }
    ]
  }));

  assert.equal(result.kind, "non-actionable-artifact");
  assert.equal(result.nextActor, "none");
});

test("head SHA and no-check-runs are surfaced explicitly", () => {
  const result = discoverRepositoryWork(snapshot({
    issues: [{ number: 6, title: "Beta 3", labels: ["chat-review-ready"] }],
    pullRequests: [
      {
        number: 8,
        title: "Beta 3 PR",
        state: "OPEN",
        headRefName: "codex/issue-6",
        headRefOid: "new-head"
      }
    ],
    lastProcessedEventId: "different-event"
  }));

  assert.equal(result.pullRequest?.headRefOid, "new-head");
  assert.equal(result.pullRequest?.checkState, "no-check-runs");
});

test("unchanged event id returns quiet no-pending-work", () => {
  const first = discoverRepositoryWork(snapshot({
    issues: [{ number: 9, title: "Beta 4", labels: ["codex-ready"], updatedAt: "2026-08-08T18:35:08Z" }]
  }));
  const second = discoverRepositoryWork(snapshot({
    issues: [{ number: 9, title: "Beta 4", labels: ["codex-ready"], updatedAt: "2026-08-08T18:35:08Z" }],
    lastProcessedEventId: first.eventId
  }));

  assert.equal(second.kind, "no-pending-work");
  assert.equal(second.reason, "unchanged-event-already-handled");
  assert.equal(second.nextActor, "none");
});

test("GitHub check failures are not treated as local validation success", () => {
  const result = discoverRepositoryWork(snapshot({
    issues: [{ number: 6, title: "Beta 3", labels: ["chat-review-ready"] }],
    pullRequests: [
      {
        number: 8,
        title: "Beta 3 PR",
        state: "OPEN",
        headRefName: "codex/issue-6",
        checks: [{ name: "ci", status: "COMPLETED", conclusion: "FAILURE" }]
      }
    ]
  }));

  assert.equal(result.pullRequest?.checkState, "failing");
});

test("governance files are carried into discovery results", () => {
  const result = discoverRepositoryWork(snapshot({
    issues: [{ number: 9, title: "Beta 4", labels: ["codex-ready"] }],
    governanceFiles: [{ path: "AGENTS.md", exists: true, bytes: 123, excerpt: "Preserve gates." }]
  }));

  assert.equal(result.governanceFiles?.[0]?.path, "AGENTS.md");
  assert.equal(result.governanceFiles?.[0]?.exists, true);
});

test("Beta 1-3 style pickup remains available for ready issue with open PR", () => {
  const result = discoverRepositoryWork(snapshot({
    issues: [{ number: 2, title: "Beta 1", labels: ["codex-ready"] }],
    pullRequests: [{ number: 3, title: "Beta 1 PR", state: "OPEN", closingIssueNumbers: [2], headRefOid: "head" }]
  }));

  assert.equal(result.kind, "resume-existing-pr");
  assert.equal(result.reason, "ready-issue-has-open-pr");
});
