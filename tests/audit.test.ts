import test from "node:test";
import assert from "node:assert/strict";
import { createAuditLogEvent } from "../packages/core/src/audit.js";

test("structured audit logs redact tokens and credentials", () => {
  const event = createAuditLogEvent("github.request", {
    token: "ghp_abcdefghijklmnopqrstuvwxyz123456",
    authorization: "Bearer abc.def.ghi",
    nested: {
      credential: "secret value",
      safe: "visible"
    },
    message: "using Bearer abcdef123456"
  });

  assert.equal((event.data as Record<string, unknown>).token, "[REDACTED]");
  assert.equal((event.data as Record<string, unknown>).authorization, "[REDACTED]");
  assert.deepEqual((event.data as { nested: Record<string, unknown> }).nested.credential, "[REDACTED]");
  assert.deepEqual((event.data as { nested: Record<string, unknown> }).nested.safe, "visible");
  assert.match(String((event.data as Record<string, unknown>).message), /Bearer \[REDACTED\]/);
});

test("structured audit logs redact sensitive repository payloads by key", () => {
  const event = createAuditLogEvent("review.snapshot", {
    sensitiveRepositoryData: "private diff contents"
  });

  assert.equal((event.data as Record<string, unknown>).sensitiveRepositoryData, "[REDACTED]");
});
