import * as Sentry from "@sentry/cloudflare";
import { eq, isNull, and } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/index";
import { employees } from "@/db/schema";
import { isProtectedAdmin } from "@/lib/employees";

/**
 * The guard shared by the two absence write routes (`absences/index.ts`, `absences/bulk.ts`).
 *
 * It exists because the block it replaces existed twice: `bulk.ts` copied the moderator-retarget
 * lookup from `index.ts` verbatim, and so inherited its missing `is_system` check. One home for
 * the decision means the next absence write path cannot inherit it a third time.
 *
 * Deliberately not `resolveModeratorTarget` (`employee-target-guard.ts`): that guard reads the
 * target from `context.params.id` and hard-requires a moderator caller. Absences need the opposite
 * shape — an *optional* body field, with non-moderators silently falling through to their own
 * column rather than being rejected.
 */

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Both current callers parse these ids with `z.uuid()` before handing them over, so this never
// fires today. It is here because the module's whole purpose is that the *next* absence write path
// cannot inherit a mistake: without it, a caller that forgot to validate gets PG 22P02 out of the
// lookups below, which the catch blocks turn into 503 "Błąd bazy danych." — a caller error
// reported to the user as a server outage. `employee-target-guard.ts:70-73` validates for the
// same reason.
const UUIDSchema = z.uuid();

/** The already-resolved caller row. `is_system` is why both routes widen their caller select. */
export interface AbsenceWriteCaller {
  id: string;
  role: "employee" | "moderator";
  is_system: boolean;
}

export interface AbsenceWriteTarget {
  targetEmployeeId: string;
}

/**
 * Resolves the employee an absence write lands on and refuses the writes the `is_system`
 * invariant forbids (`@/lib/employees`: RLS is bypassed on the service-role connection, so the
 * technical admin is immutable only because every write path says so).
 *
 * Gates, in the order the five pre-existing guarded routes establish — 404 before 403, so a
 * nonexistent id is never answered "forbidden":
 *
 * 1. Target = the body's `employee_id` when the caller is a moderator and supplied one, otherwise
 *    the caller's own id. A non-moderator's `employee_id` is silently ignored, not rejected —
 *    that is the existing contract and this guard does not change it.
 * 2. In the moderator branch only: the target must exist and not be soft-deleted, else 404.
 * 3. The *resolved* target must not be the protected admin, else 403. Testing the resolved target
 *    rather than the body field is what covers both entrances: the admin is seeded
 *    `role: moderator` (AGENTS.md), so it can also reach here as the caller writing its own
 *    column, and a check placed inside the moderator branch would miss that.
 * 4. A supplied `substitute_employee_id` must not be the protected admin, else 403. A
 *    *nonexistent* substitute is deliberately not checked — the FK maps it to 422 via
 *    `extractPgErrorConstraint`, which is the existing contract. A *soft-deleted* substitute stays
 *    allowed: it is plausible on a historical row, and rejecting it would break editing those.
 *
 * @returns the resolved target, or the `Response` to send when a gate refuses — the contract
 *   `resolveModeratorTarget` already established.
 */
export async function resolveAbsenceWriteTarget(
  db: Db,
  caller: AbsenceWriteCaller,
  requested: { employeeId?: string; substituteEmployeeId: string | null },
  route: string,
): Promise<Response | AbsenceWriteTarget> {
  let target: { id: string; is_system: boolean } = { id: caller.id, is_system: caller.is_system };

  if (caller.role === "moderator" && requested.employeeId) {
    if (!UUIDSchema.safeParse(requested.employeeId).success) {
      return json({ error: "Nieprawidłowy identyfikator pracownika." }, 400);
    }
    let targetRow: { id: string; is_system: boolean } | undefined;
    try {
      targetRow = await db
        .select({ id: employees.id, is_system: employees.is_system })
        .from(employees)
        .where(and(eq(employees.id, requested.employeeId), isNull(employees.deleted_at)))
        .then((r) => r[0]);
    } catch (err) {
      Sentry.captureException(err, { tags: { route } });
      return json({ error: "Błąd bazy danych." }, 503);
    }
    if (!targetRow) {
      return json({ error: "Pracownik nie został znaleziony." }, 404);
    }
    target = targetRow;
  }

  if (isProtectedAdmin(target)) {
    return json({ error: "Nie można modyfikować tego konta." }, 403);
  }

  const substituteRefusal = await assertSubstituteAllowed(db, requested.substituteEmployeeId, route);
  if (substituteRefusal) {
    return substituteRefusal;
  }

  return { targetEmployeeId: target.id };
}

/**
 * Gate 4 on its own, because `PATCH /api/absences/:id` needs it without the rest: it cannot
 * retarget a row to another employee, so gates 1–3 have nothing to decide there, but it *can*
 * set `substitute_employee_id` on an existing row and so reach the same forbidden state a POST
 * would. Kept in this module rather than copied into the route — copying is what propagated the
 * original gap.
 *
 * `null` or `undefined` means the field was not supplied (a PATCH may omit it, and clearing a
 * substitute is always allowed), so no lookup is issued.
 *
 * @returns the `Response` to send when the substitute is the protected admin, otherwise `null`.
 */
export async function assertSubstituteAllowed(
  db: Db,
  substituteEmployeeId: string | null | undefined,
  route: string,
): Promise<Response | null> {
  if (substituteEmployeeId === null || substituteEmployeeId === undefined) {
    return null;
  }
  if (!UUIDSchema.safeParse(substituteEmployeeId).success) {
    return json({ error: "Nieprawidłowy identyfikator zastępstwa." }, 400);
  }

  let substituteRow: { is_system: boolean } | undefined;
  try {
    // No `deleted_at` filter: a soft-deleted substitute is allowed (see the doc comment), so the
    // only question this lookup answers is whether the row is the protected admin.
    substituteRow = await db
      .select({ is_system: employees.is_system })
      .from(employees)
      .where(eq(employees.id, substituteEmployeeId))
      .then((r) => r[0]);
  } catch (err) {
    Sentry.captureException(err, { tags: { route } });
    return json({ error: "Błąd bazy danych." }, 503);
  }
  if (substituteRow && isProtectedAdmin(substituteRow)) {
    return json({ error: "Nie można modyfikować tego konta." }, 403);
  }

  return null;
}
