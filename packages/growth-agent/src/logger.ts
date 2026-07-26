const SECRET_PATTERN = /(token|secret|password|authorization|cookie|api[_-]?key)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_PATTERN.test(key) ? "[REDACTED]" : redact(item)]));
  }
  return value;
}

export function log(level: "debug" | "info" | "warn" | "error", message: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...redact(fields) as object })}\n`);
}
