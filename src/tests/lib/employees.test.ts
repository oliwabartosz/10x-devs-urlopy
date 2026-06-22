import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
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
  it("is the predicate `employees.is_system = false`", () => {
    // Structural equality against the reference eq() — locks the filter to exclude
    // system rows without coupling to Drizzle's internal SQL-builder API.
    expect(visibleEmployeesFilter()).toEqual(eq(employees.is_system, false));
  });
});
