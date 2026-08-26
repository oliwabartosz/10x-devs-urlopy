/**
 * SQLite's *extended* result codes for the three constraint failures the routes branch on, as the
 * decimal strings `src/db/index.ts` normalises driver errors into.
 *
 * Extended rather than primary: `node:sqlite` reports every failure with the same
 * `code: 'ERR_SQLITE_ERROR'`, and the primary result code (`SQLITE_CONSTRAINT` = 19) cannot tell a
 * duplicate key from a bad reference — which is exactly the distinction the 409 / 422 / 400
 * contracts rest on. `SqliteDriverError` lifts the extended code onto `code` for that reason.
 *
 * These replace the Postgres SQLSTATEs the routes used to compare (`23505`, `23503`, `23514`).
 * `42501` (insufficient privilege) has no analogue and its branches are gone: it came from RLS,
 * which never applied on the service-role connection and does not exist at all on a local file.
 */
export const SQLITE_CONSTRAINT_UNIQUE = "2067";
export const SQLITE_CONSTRAINT_FOREIGNKEY = "787";
export const SQLITE_CONSTRAINT_CHECK = "275";

/**
 * The constraint code a driver error carries, or `undefined` for anything that is not one.
 *
 * The `err.code ?? err.cause?.code` indirection survives the port unchanged: Drizzle still wraps
 * whatever the proxy callback throws in a `DrizzleQueryError`, so the normalised
 * `SqliteDriverError` arrives on `cause` at every call site.
 */
export function extractDbErrorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = e.code ?? e.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Whatever the driver named after `constraint failed: ` — the constraint name for a CHECK
 * violation (`absences_time_check`), a `table.column` list for a UNIQUE one.
 *
 * **Meaningful for CHECK violations only.** Under Postgres this told one FK apart from another,
 * which is how the two absence routes chose between "unknown absence type" and "unknown
 * substitute". SQLite names *nothing* in a `SQLITE_CONSTRAINT_FOREIGNKEY` message — not the
 * constraint, not the column — so that discrimination is unavailable and both cases are resolved
 * by pre-flight lookups instead (`@/lib/absence-write-target`).
 */
export function extractDbErrorConstraint(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const e = err as { constraint_name?: unknown; cause?: { constraint_name?: unknown } };
  const constraint = e.constraint_name ?? e.cause?.constraint_name;
  return typeof constraint === "string" ? constraint : undefined;
}
