import { describe, it, expect } from "vitest";
import { isProtectedAdmin, visibleEmployeesFilter } from "@/lib/employees";
import { employees } from "@/db/schema";

describe("isProtectedAdmin", () => {
  it("returns true only for is_system rows", () => {
    expect(isProtectedAdmin({ is_system: true })).toBe(true);
  });

  it("returns false for normal (non-system) rows", () => {
    expect(isProtectedAdmin({ is_system: false })).toBe(false);
  });
});

describe("visibleEmployeesFilter", () => {
  it("builds an equality predicate on employees.is_system = false", () => {
    const filter = visibleEmployeesFilter();
    // Drizzle eq() yields an SQL object; assert it references the is_system column
    // and binds the literal false, so the predicate can only ever exclude system rows.
    const { sql, params } = filter.getSQL().toQuery({
      escapeName: (n) => `"${n}"`,
      escapeParam: (i) => `$${i + 1}`,
      escapeString: (s) => `'${s}'`,
      casing: { getColumnCasing: (c) => c.name },
    });

    expect(sql).toContain(employees.is_system.name);
    expect(params).toEqual([false]);
  });
});
