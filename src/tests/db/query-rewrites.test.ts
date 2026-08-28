import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { createDb, closeDb, absence_types, absences, employees, users, type Db } from "@/db/index";
import { migrateAndSeed } from "@/db/migrate";
import { reorderEmployeesStatement } from "@/lib/employee-reorder";
import { computeUsedDays } from "@/lib/services/holiday-balance";

// The two Postgres-only query constructs this change had to rewrite, exercised against a real
// SQLite database rather than asserted on the SQL string: `extract(epoch from (end - start))`,
// which SQLite cannot express at all, and `UPDATE ... FROM (SELECT UNNEST(ARRAY[...]))`, which
// loses both the array and the cast operator.

let dir: string;
let path: string;
let db: Db;
let urlopId: number;

async function makeEmployee(name: string, isSystem = false): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: `${name}@example.test`, password_hash: "x" })
    .returning();
  const [employee] = await db
    .insert(employees)
    .values({ user_id: user.id, role: "employee", first_name: name, last_name: "T", is_system: isSystem })
    .returning();
  return employee.id;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "urlopy-queries-"));
  path = join(dir, "queries.db");
  db = createDb(path);
  await migrateAndSeed(path);
  urlopId = (await db.select().from(absence_types).where(eq(absence_types.name, "urlop")))[0].id;
});

afterAll(() => {
  closeDb(path);
  rmSync(dir, { recursive: true, force: true });
});

describe("bulk employee reorder", () => {
  it("applies every new position in one statement", async () => {
    const a = await makeEmployee("ra");
    const b = await makeEmployee("rb");
    const c = await makeEmployee("rc");

    await db.run(
      reorderEmployeesStatement([
        { id: a, display_order: 20 },
        { id: b, display_order: 10 },
        { id: c, display_order: 30 },
      ]),
    );

    const rows = await db
      .select({ id: employees.id, display_order: employees.display_order })
      .from(employees)
      .orderBy(asc(employees.display_order));
    const byId = new Map(rows.map((r) => [r.id, r.display_order]));
    expect(byId.get(a)).toBe(20);
    expect(byId.get(b)).toBe(10);
    expect(byId.get(c)).toBe(30);
  });

  it("no-ops on the technical admin even when the payload names it", async () => {
    const admin = await makeEmployee("radmin", true);
    const normal = await makeEmployee("rnormal");

    // Exactly the crafted payload the guard exists for: a valid reorder that also tries to move
    // the hidden admin. Everyone else must move; the admin must not.
    await db.run(
      reorderEmployeesStatement([
        { id: admin, display_order: 99 },
        { id: normal, display_order: 7 },
      ]),
    );

    const [adminRow] = await db.select().from(employees).where(eq(employees.id, admin));
    const [normalRow] = await db.select().from(employees).where(eq(employees.id, normal));
    expect(adminRow.display_order).toBe(0);
    expect(adminRow.is_system).toBe(true);
    expect(normalRow.display_order).toBe(7);
  });
});

describe("computeUsedDays", () => {
  it("counts full days, folds partial days in as fractions, and adds the adjustment", async () => {
    const employeeId = await makeEmployee("used");
    await db.insert(absences).values([
      // Two full days.
      { employee_id: employeeId, absence_type_id: urlopId, date: "2026-03-02" },
      { employee_id: employeeId, absence_type_id: urlopId, date: "2026-03-03" },
      // 2h30m + 4h = 6.5h = 0.8125 days at FULL_DAY_HOURS = 8.
      {
        employee_id: employeeId,
        absence_type_id: urlopId,
        date: "2026-03-04",
        is_full_day: false,
        start_time: "09:00",
        end_time: "11:30",
      },
      {
        employee_id: employeeId,
        absence_type_id: urlopId,
        date: "2026-03-05",
        is_full_day: false,
        start_time: "08:00",
        end_time: "12:00",
      },
    ]);

    expect(await computeUsedDays(db, employeeId, 2026, 0)).toBeCloseTo(2 + 6.5 / 8, 10);
    expect(await computeUsedDays(db, employeeId, 2026, 3)).toBeCloseTo(2 + 6.5 / 8 + 3, 10);
  });

  it("bounds the count to the calendar year and to the 'urlop' type", async () => {
    const employeeId = await makeEmployee("bounded");
    const plannedId = (await db.select().from(absence_types).where(eq(absence_types.name, "urlop planowany")))[0].id;

    await db.insert(absences).values([
      { employee_id: employeeId, absence_type_id: urlopId, date: "2026-12-31" },
      // Just outside the window on each side.
      { employee_id: employeeId, absence_type_id: urlopId, date: "2025-12-31" },
      { employee_id: employeeId, absence_type_id: urlopId, date: "2027-01-01" },
      // Right window, wrong type — "urlop planowany" must not count as used (S-13).
      { employee_id: employeeId, absence_type_id: plannedId, date: "2026-06-15" },
    ]);

    expect(await computeUsedDays(db, employeeId, 2026, 0)).toBe(1);
  });

  it("returns only the adjustment for an employee with no absences", async () => {
    const employeeId = await makeEmployee("empty");
    expect(await computeUsedDays(db, employeeId, 2026, 0)).toBe(0);
    expect(await computeUsedDays(db, employeeId, 2026, 5)).toBe(5);
  });
});
