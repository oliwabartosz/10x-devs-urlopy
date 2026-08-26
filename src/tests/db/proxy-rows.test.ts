import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { createDb, closeDb, absence_types, absences, employees, users, type Db } from "@/db/index";
import { migrateAndSeed } from "@/db/migrate";

// The sqlite-proxy row-shape contract is the one place in this change where a mistake is
// invisible: the callback must hand Drizzle *positional* rows (array-of-arrays for `all` and
// `values`, one flat array for `get`), and Drizzle maps them onto selected fields by index.
// Return objects instead — or flatten objects with `Object.values()` — and columns land in the
// wrong fields with no throw and no type error. These tests pin the shape at both ends: the raw
// proxy methods, and a real query-builder read whose values must round-trip.

let dir: string;
let path: string;
let db: Db;
let employeeId: string;
let typeId: number;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "urlopy-proxy-"));
  path = join(dir, "proxy.db");
  db = createDb(path);
  await migrateAndSeed(path);

  const [user] = await db.insert(users).values({ email: "proxy@example.test", password_hash: "x" }).returning();
  const [employee] = await db
    .insert(employees)
    .values({ user_id: user.id, role: "moderator", first_name: "Ada", last_name: "Lovelace" })
    .returning();
  employeeId = employee.id;
  typeId = (await db.select().from(absence_types).where(eq(absence_types.name, "urlop")))[0].id;

  await db.insert(absences).values({
    employee_id: employeeId,
    absence_type_id: typeId,
    date: "2026-08-25",
    is_full_day: false,
    start_time: "09:00",
    end_time: "11:30",
    comment: "proxy fixture",
  });
});

afterAll(() => {
  closeDb(path);
  rmSync(dir, { recursive: true, force: true });
});

describe("sqlite-proxy row mapping", () => {
  it("all() returns every row positionally", async () => {
    const rows = await db.all<[number, string, number]>(
      sql`select id, name, display_order from absence_types order by display_order`,
    );
    expect(rows).toHaveLength(7);
    // Second element is the name, third the order — not shuffled, not collapsed.
    expect(rows[0][1]).toBe("urlop");
    expect(rows[0][2]).toBe(1);
    expect(rows[6][1]).toBe("urlop planowany");
    expect(rows[6][2]).toBe(7);
  });

  it("get() returns a single flat positional row, and undefined-shaped emptiness for no match", async () => {
    const row = await db.get<[number, string, string]>(
      sql`select id, name, color from absence_types where name = 'choroba'`,
    );
    expect(Array.isArray(row)).toBe(true);
    expect(row[1]).toBe("choroba");
    expect(row[2]).toBe("#2f578c");

    // A `get` that matches nothing must not throw and must not fabricate a row. This is the
    // consequential half: Drizzle only short-circuits `get` to `undefined` on a falsy driver
    // result, so a callback returning `[]` makes `findFirst` hand back a truthy object whose
    // every field is `undefined` — a "row" that passes an `if (row)` guard and then reads as
    // corrupt data downstream.
    const missing = await db.get(sql`select id from absence_types where name = 'nie ma takiego'`);
    expect(missing).toBeUndefined();

    const noSuchEmployee = await db.query.employees.findFirst({
      where: eq(employees.id, "00000000-0000-0000-0000-000000000000"),
    });
    expect(noSuchEmployee).toBeUndefined();

    const present = await db.query.employees.findFirst({ where: eq(employees.id, employeeId) });
    expect(present?.first_name).toBe("Ada");
  });

  it("values() returns array-of-arrays", async () => {
    const rows = await db.values<[string, number]>(
      sql`select name, display_order from absence_types order by display_order limit 2`,
    );
    expect(rows).toEqual([
      ["urlop", 1],
      ["szkolenie/wyjście poza miejsce pracy", 2],
    ]);
  });

  it("maps a select onto the right fields, with each column's JS type preserved", async () => {
    const [row] = await db.select().from(absences).where(eq(absences.employee_id, employeeId));
    expect(row.employee_id).toBe(employeeId);
    expect(row.absence_type_id).toBe(typeId);
    expect(row.date).toBe("2026-08-25");
    expect(row.start_time).toBe("09:00");
    expect(row.end_time).toBe("11:30");
    expect(row.comment).toBe("proxy fixture");
    expect(row.substitute_employee_id).toBeNull();
    // integer({ mode: "boolean" }) must come back as a boolean, not 0/1 …
    expect(row.is_full_day).toBe(false);
    // … and integer({ mode: "timestamp" }) as a Date, which dashboard.astro compares as one.
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.updated_at).toBeInstanceOf(Date);
  });

  it("keeps same-named columns apart across a join", async () => {
    // Drizzle emits `"absences"."id", … , "employees"."id", …` unaliased and maps by position.
    // Flattening object rows with `Object.values()` would collapse the two `id` keys into one and
    // silently shift every later employees column left — this is the case that catches it.
    const [row] = await db
      .select()
      .from(absences)
      .innerJoin(employees, eq(absences.employee_id, employees.id))
      .where(eq(employees.id, employeeId));

    expect(row.employees.id).toBe(employeeId);
    expect(row.employees.first_name).toBe("Ada");
    expect(row.employees.last_name).toBe("Lovelace");
    expect(row.employees.role).toBe("moderator");
    expect(row.employees.is_system).toBe(false);
    expect(row.absences.id).not.toBe(row.employees.id);
    expect(row.absences.date).toBe("2026-08-25");
  });

  it("normalises driver errors into a code the db-errors helper can branch on", async () => {
    // SQLITE_CONSTRAINT_UNIQUE = 2067, on the (employee_id, date) index.
    await expect(
      db.insert(absences).values({ employee_id: employeeId, absence_type_id: typeId, date: "2026-08-25" }),
    ).rejects.toMatchObject({ cause: { code: "2067", errcode: 2067 } });

    // SQLITE_CONSTRAINT_FOREIGNKEY = 787. SQLite names neither constraint nor column here, which
    // is why Phase 3 resolves unknown references with pre-flight lookups instead.
    await expect(
      db.insert(absences).values({ employee_id: employeeId, absence_type_id: 4242, date: "2026-08-26" }),
    ).rejects.toMatchObject({ cause: { code: "787", constraint_name: undefined } });

    // SQLITE_CONSTRAINT_CHECK = 275 — and here SQLite *does* name the constraint.
    await expect(
      db.insert(absences).values({
        employee_id: employeeId,
        absence_type_id: typeId,
        date: "2026-08-27",
        is_full_day: false,
        start_time: "11:00",
        end_time: "09:00",
      }),
    ).rejects.toMatchObject({ cause: { code: "275", constraint_name: "absences_time_check" } });
  });
});
