import { eq } from "drizzle-orm";
import { employees } from "@/db/schema";

/**
 * The single source of truth for the technical-admin (`is_system`) invariant.
 *
 * Supabase RLS is bypassed on the service-role Drizzle connection (AGENTS.md), so
 * "the admin is hidden and immutable" cannot be enforced in the database — it must
 * be re-asserted in every read surface (via {@link visibleEmployeesFilter}) and
 * every write path (via {@link isProtectedAdmin}). Keep these dependency-light so
 * they stay unit-testable with plain mock rows.
 */

/**
 * Drizzle `where`-fragment selecting only visible (non-system) employees.
 * Compose into a list query's `where` clause, e.g.
 * `and(isNull(employees.deleted_at), visibleEmployeesFilter())`.
 */
export function visibleEmployeesFilter() {
  return eq(employees.is_system, false);
}

/** True iff the row is the protected technical admin. Call before any mutation. */
export function isProtectedAdmin(row: { is_system: boolean }): boolean {
  return row.is_system === true;
}
