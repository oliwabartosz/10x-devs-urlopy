import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absence_types } from "@/db/schema";
import { typeAllowsPriority } from "@/lib/absence-types";

// Server-only guard (imports the DB schema). Keep the DB-aware logic here so
// `@/lib/absence-types` stays dependency-free and importable from React islands.

/**
 * Does the given (absence type, is_priority) combination violate the priority rule?
 *
 * Unflagged absences are always allowed, whatever their type — so `isPriority === false`
 * short-circuits before the query. A flagged absence is allowed only for the leave types in
 * `PRIORITY_TYPE_NAMES`. A nonexistent `absenceTypeId` resolves to an undefined name → treated
 * as ineligible → violation; callers must therefore run `assertAbsenceTypeExists` first, so an
 * unknown id is reported as 422 rather than as a 400 rule violation. Callers pass the
 * *effective* values (for PATCH, the body value when present, otherwise the existing row's).
 *
 * The flag is informational: this guard is the only thing it is checked against.
 *
 * @returns `true` when the combination must be rejected (respond 400), `false` when allowed.
 */
export async function isPriorityViolation(db: Db, absenceTypeId: number, isPriority: boolean): Promise<boolean> {
  if (!isPriority) return false;

  const row: { name: string } | undefined = await db
    .select({ name: absence_types.name })
    .from(absence_types)
    .where(eq(absence_types.id, absenceTypeId))
    .then((r) => r[0]);

  return !typeAllowsPriority(row?.name);
}
