const sensitiveKeyPattern = /(token|secret|password|credential|private[_-]?key|authorization|sensitive[_-]?repository[_-]?data)/i;

export function redactForAudit(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactForAudit(item));
  }

  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      redacted[key] = sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactForAudit(nestedValue);
    }

    return redacted;
  }

  if (typeof value === "string") {
    return value
      .replace(/gh[psuor]_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  }

  return value;
}

export function createAuditLogEvent(event: string, data: Record<string, unknown>): Record<string, unknown> {
  return {
    event,
    data: redactForAudit(data)
  };
}
