import { eq } from "drizzle-orm";
import type { Db } from "@/db/index";
import { absence_types } from "@/db/schema";
import { typeAllowsPartialDay } from "@/lib/absence-types";

// Server-only guard (imports the DB schema). Keep the DB-aware logic here so
// `@/lib/absence-types` stays dependency-free and importable from React islands.

/**
 * Does the given (absence type, is_full_day) combination violate the partial-day rule?
 *
 * Full-day entries are always allowed. Partial-day entries (`isFullDay === false`) are
 * allowed only for the training types in `PARTIAL_DAY_TYPE_NAMES`. A nonexistent
 * `absenceTypeId` resolves to an undefined name → treated as ineligible → violation.
 * Callers pass the *effective*
 * values (for PATCH, the body value when present, otherwise the existing row's value).
 *
 * @returns `true` when the combination must be rejected (respond 400), `false` when allowed.
 */
export async function isPartialDayViolation(db: Db, absenceTypeId: number, isFullDay: boolean): Promise<boolean> {
  if (isFullDay) return false;

  const row: { name: string } | undefined = await db
    .select({ name: absence_types.name })
    .from(absence_types)
    .where(eq(absence_types.id, absenceTypeId))
    .then((r) => r[0]);

  return !typeAllowsPartialDay(row?.name);
}
