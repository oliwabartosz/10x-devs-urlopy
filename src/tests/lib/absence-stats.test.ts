import { describe, it, expect } from "vitest";
import type { Absence, EmployeeListItem, AbsenceType } from "@/types";
import { buildMatrix, getAbsenceHours } from "@/lib/absence-stats";

// Mock rows, no DB — matching src/tests/lib/medals.test.ts. Only the fields the aggregation
// reads are meaningful; the rest satisfy the row types.

const emp = (id: string): EmployeeListItem => ({
  id,
  role: "employee",
  first_name: "Test",
  last_name: id,
  deleted_at: null,
  created_at: new Date(),
  display_order: 0,
  is_system: false,
});

const type = (id: number): AbsenceType => ({
  id,
  name: `type-${String(id)}`,
  color: "#000000",
  icon: "",
  text_color: "#000000",
  display_order: id,
});

let seq = 0;
const fullDay = (employeeId: string, typeId: number): Absence =>
  ({
    id: `a-${String(seq++)}`,
    employee_id: employeeId,
    absence_type_id: typeId,
    date: "2026-01-01",
    is_full_day: true,
    start_time: null,
    end_time: null,
  }) as Absence;

const partial = (employeeId: string, typeId: number, start: string, end: string): Absence =>
  ({
    id: `a-${String(seq++)}`,
    employee_id: employeeId,
    absence_type_id: typeId,
    date: "2026-01-01",
    is_full_day: false,
    start_time: start,
    end_time: end,
  }) as Absence;

const A = emp("A");
const B = emp("B");
const T1 = type(1);
const T2 = type(2);

describe("getAbsenceHours", () => {
  it("reports a full day as the full-day hour count", () => {
    expect(getAbsenceHours(fullDay("A", 1))).toBe(8);
  });

  it("reports a partial day as its time span in hours", () => {
    expect(getAbsenceHours(partial("A", 1, "09:00", "13:00"))).toBe(4);
  });

  it("carries minutes through as a fraction of an hour", () => {
    expect(getAbsenceHours(partial("A", 1, "09:00", "11:30"))).toBe(2.5);
  });

  // Postgres TIME comes back as HH:MM:SS through postgres-js (crud.test.ts pins that), so the
  // seconds must be sliced off rather than parsed into the minute field.
  it("accepts the HH:MM:SS form the database returns", () => {
    expect(getAbsenceHours(partial("A", 1, "09:00:00", "13:00:00"))).toBe(4);
  });
});

describe("buildMatrix", () => {
  it("counts a full-day row as one day", () => {
    const m = buildMatrix([fullDay("A", 1)], [A], [T1]);
    expect(m.cells.get("A_1")).toBe(1);
    expect(m.perEmployee).toEqual([1]);
    expect(m.grand).toBe(1);
  });

  it("converts a partial-day row through the hours-to-days divisor", () => {
    // 09:00–13:00 is 4h; at 8h to the day that is half a day, not a whole one.
    const m = buildMatrix([partial("A", 1, "09:00", "13:00")], [A], [T1]);
    expect(m.cells.get("A_1")).toBe(0.5);
  });

  it("mixes whole days and partial hours inside one cell", () => {
    const m = buildMatrix([fullDay("A", 1), partial("A", 1, "09:00", "11:00")], [A], [T1]);
    expect(m.cells.get("A_1")).toBe(1.25);
  });

  it("keeps perEmployee, perType and grand in agreement", () => {
    const m = buildMatrix(
      [fullDay("A", 1), fullDay("A", 2), fullDay("B", 1), partial("B", 2, "09:00", "13:00")],
      [A, B],
      [T1, T2],
    );

    expect(m.perEmployee).toEqual([2, 1.5]);
    expect(m.perType).toEqual([2, 1.5]);
    expect(m.grand).toBe(3.5);
    expect(m.perEmployee.reduce((a, b) => a + b, 0)).toBe(m.grand);
    expect(m.perType.reduce((a, b) => a + b, 0)).toBe(m.grand);
  });

  it("yields 0, not undefined, for an employee with no absences", () => {
    const m = buildMatrix([fullDay("A", 1)], [A, B], [T1]);
    expect(m.perEmployee[1]).toBe(0);
    expect(m.cells.get("B_1")).toBeUndefined();
    expect(m.employeesWithAbsence).toBe(1);
  });

  // maxEmployeeTotal is the divisor for the per-row stacked bar. Returning 0 would render
  // NaN-width bars on an empty month, which is why the floor exists.
  it("never returns 0 for maxEmployeeTotal", () => {
    expect(buildMatrix([], [A, B], [T1]).maxEmployeeTotal).toBe(1);
    expect(buildMatrix([fullDay("A", 1)], [A, B], [T1]).maxEmployeeTotal).toBe(1);
    expect(buildMatrix([fullDay("A", 1), fullDay("A", 2)], [A, B], [T1, T2]).maxEmployeeTotal).toBe(2);
  });

  // The shape the role-scoped self view always hands it: one employee, so the grand total and
  // that employee's total are the same number — which is why the self view drops the footer.
  it("collapses to the single row for a one-employee list", () => {
    const m = buildMatrix([fullDay("A", 1), partial("A", 2, "09:00", "13:00")], [A], [T1, T2]);

    expect(m.perEmployee).toHaveLength(1);
    expect(m.grand).toBe(m.perEmployee[0]);
    expect(m.grand).toBe(1.5);
    expect(m.employeesWithAbsence).toBe(1);
  });

  // Another employee's rows in the list must not reach a one-employee matrix — the server
  // scoping is what keeps them out, and this is what proves the aggregation would not
  // silently fold them in if it ever stopped.
  it("ignores absences belonging to employees outside the list", () => {
    const m = buildMatrix([fullDay("A", 1), fullDay("B", 1)], [A], [T1]);

    expect(m.perEmployee).toEqual([1]);
    expect(m.grand).toBe(1);
  });

  it("produces an all-zero matrix for an empty absence list", () => {
    const m = buildMatrix([], [A, B], [T1, T2]);

    expect(m.cells.size).toBe(0);
    expect(m.perEmployee).toEqual([0, 0]);
    expect(m.perType).toEqual([0, 0]);
    expect(m.grand).toBe(0);
    expect(m.employeesWithAbsence).toBe(0);
  });
});
