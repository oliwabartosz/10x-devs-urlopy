export function extractPgErrorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = e.code ?? e.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The name of the constraint a Postgres error refers to (e.g. the FK that a `23503`
 * violated), so callers can tell one FK apart from another. postgres-js exposes this as
 * `constraint_name`; mirror the direct-vs-`cause` lookup used by {@link extractPgErrorCode}.
 */
export function extractPgErrorConstraint(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const e = err as { constraint_name?: unknown; cause?: { constraint_name?: unknown } };
  const constraint = e.constraint_name ?? e.cause?.constraint_name;
  return typeof constraint === "string" ? constraint : undefined;
}
