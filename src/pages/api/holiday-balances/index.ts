export const prerender = false;

import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import { createDb } from "@/db/index";
import { DATABASE_URL } from "astro:env/server";
import { employees, holiday_balances } from "@/db/index";
import { and, eq, isNull } from "drizzle-orm";
import { DateSchema } from "@/lib/validators";
import { extractPgErrorCode } from "@/lib/db-errors";
import { buildBalanceView } from "@/lib/services/holiday-balance";
import type { HolidayBalance, HolidayBalanceView } from "@/types";

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const YearSchema = z.string().regex(/^\d{4}$/);

/** Resolve the authenticated caller to a non-deleted employees row. */
async function resolveCaller(
  db: ReturnType<typeof createDb>,
  userId: string,
): Promise<{ id: string; role: "employee" | "moderator" } | undefined> {
  return db
    .select({ id: employees.id, role: employees.role })
    .from(employees)
    .where(and(eq(employees.user_id, userId), isNull(employees.deleted_at)))
    .then((r) => r[0]);
}

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const yearParsed = YearSchema.safeParse(context.url.searchParams.get("year"));
  if (!yearParsed.success) {
    return json({ error: "Provide year=YYYY" }, 400);
  }
  const year = parseInt(yearParsed.data, 10);
  if (year < 2000 || year > 2100) {
    return json({ error: "year out of range" }, 400);
  }

  const employeeIdParam = context.url.searchParams.get("employee_id");
  if (employeeIdParam !== null && !z.uuid().safeParse(employeeIdParam).success) {
    return json({ error: "Invalid employee_id" }, 400);
  }

  const db = createDb(DATABASE_URL);

  let caller: { id: string; role: "employee" | "moderator" } | undefined;
  try {
    caller = await resolveCaller(db, context.locals.user.id);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "GET /api/holiday-balances" } });
    return json({ error: "Database error" }, 503);
  }
  if (!caller) {
    return json({ error: "Employee record not found" }, 403);
  }

  // Default to the caller's own balance; an explicit employee_id must resolve to an existing row
  // (soft-deleted allowed only for moderators, mirroring the absences route).
  let targetEmployeeId = caller.id;
  if (employeeIdParam !== null && employeeIdParam !== caller.id) {
    const targetCond =
      caller.role === "moderator"
        ? eq(employees.id, employeeIdParam)
        : and(eq(employees.id, employeeIdParam), isNull(employees.deleted_at));
    let targetRow: { id: string } | undefined;
    try {
      targetRow = await db
        .select({ id: employees.id })
        .from(employees)
        .where(targetCond)
        .then((r) => r[0]);
    } catch (err) {
      Sentry.captureException(err, { tags: { route: "GET /api/holiday-balances" } });
      return json({ error: "Database error" }, 503);
    }
    if (!targetRow) {
      return json({ error: "Pracownik nie został znaleziony." }, 404);
    }
    targetEmployeeId = targetRow.id;
  }

  try {
    const row: HolidayBalance | undefined = await db
      .select()
      .from(holiday_balances)
      .where(and(eq(holiday_balances.employee_id, targetEmployeeId), eq(holiday_balances.year, year)))
      .then((r) => r[0]);
    const view = await buildBalanceView(db, targetEmployeeId, year, row ?? null);
    return json(view, 200);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "GET /api/holiday-balances" } });
    return json({ error: "Database error" }, 500);
  }
};

const HolidayBalanceUpsertSchema = z.object({
  employee_id: z.uuid(),
  year: z.number().int().min(2000).max(2100),
  current_entitlement_days: z.number().int().min(0),
  carryover_days: z.number().int().min(0),
  used_adjustment_days: z.number().int().min(0).optional().default(0),
  valid_until: DateSchema.nullable().optional(),
});

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const db = createDb(DATABASE_URL);

  let caller: { id: string; role: "employee" | "moderator" } | undefined;
  try {
    caller = await resolveCaller(db, context.locals.user.id);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/holiday-balances" } });
    return json({ error: "Database error" }, 503);
  }
  if (!caller) {
    return json({ error: "Employee record not found" }, 403);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = HolidayBalanceUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }
  const { employee_id, year, current_entitlement_days, carryover_days, used_adjustment_days, valid_until } =
    parsed.data;

  // Both roles may edit any balance — no role gate on the write — but the target must exist.
  // Moderators may target soft-deleted employees; regular employees only active ones.
  const targetCond =
    caller.role === "moderator"
      ? eq(employees.id, employee_id)
      : and(eq(employees.id, employee_id), isNull(employees.deleted_at));
  let targetRow: { id: string } | undefined;
  try {
    targetRow = await db
      .select({ id: employees.id })
      .from(employees)
      .where(targetCond)
      .then((r) => r[0]);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/holiday-balances" } });
    return json({ error: "Database error" }, 503);
  }
  if (!targetRow) {
    return json({ error: "Pracownik nie został znaleziony." }, 404);
  }

  let row: HolidayBalance;
  try {
    const inserted = await db
      .insert(holiday_balances)
      .values({
        employee_id,
        year,
        current_entitlement_days,
        carryover_days,
        used_adjustment_days,
        valid_until: valid_until ?? null,
      })
      .onConflictDoUpdate({
        target: [holiday_balances.employee_id, holiday_balances.year],
        set: {
          current_entitlement_days,
          carryover_days,
          used_adjustment_days,
          valid_until: valid_until ?? null,
          updated_at: new Date(),
        },
      })
      .returning();
    row = inserted[0];
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/holiday-balances" } });
    const code = extractPgErrorCode(err);
    if (code === "42501") return json({ error: "Forbidden" }, 403);
    if (code === "23503") return json({ error: "Pracownik nie został znaleziony." }, 404);
    if (code === "23514") return json({ error: "Invalid balance values" }, 400);
    return json({ error: "Database error" }, 500);
  }

  // The upsert has committed. A failure building the response view (the Used aggregate query)
  // must NOT be mapped as a write error — report success with a degraded view (Used falls back
  // to the stored adjustment, matching buildBalanceView's own missing-type degradation) and let
  // the client reload to fetch the fully computed values.
  try {
    const view = await buildBalanceView(db, employee_id, year, row);
    return json(view, 200);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/holiday-balances (post-write view)" } });
    const usedFallback = row.used_adjustment_days;
    return json(
      {
        balance_id: row.id,
        employee_id,
        year,
        current_entitlement_days: row.current_entitlement_days,
        carryover_days: row.carryover_days,
        used_adjustment_days: row.used_adjustment_days,
        valid_until: row.valid_until,
        used_days: usedFallback,
        left_days: row.current_entitlement_days + row.carryover_days - usedFallback,
      } satisfies HolidayBalanceView,
      200,
    );
  }
};
