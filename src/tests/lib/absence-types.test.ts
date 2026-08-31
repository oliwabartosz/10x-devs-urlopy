import { describe, it, expect } from "vitest";
import { ABSENCE_TYPE_SEED } from "@/db/seed";
import { PRIORITY_TYPE_NAMES, typeAllowsPriority, LEAVE_TYPE_NAME, PLANNED_LEAVE_TYPE_NAME } from "@/lib/absence-types";

// The rule is keyed off exact seed names (`absence_types` has no code/slug column), so the
// constants are asserted against src/db/seed.ts here rather than trusted. A seed rename that
// is not mirrored into `absence-types.ts` disables the feature silently otherwise — the same
// drift `partial-day-guard.test.ts:36-40` guards against on the DB side.
describe("typeAllowsPriority", () => {
  const seededNames = ABSENCE_TYPE_SEED.map((t) => t.name);

  it("names both eligible leave types, and both exist in the seed catalogue", () => {
    expect(PRIORITY_TYPE_NAMES).toEqual([LEAVE_TYPE_NAME, PLANNED_LEAVE_TYPE_NAME]);
    for (const name of PRIORITY_TYPE_NAMES) {
      expect(seededNames, `"${name}" — constant drifted from the seed catalogue?`).toContain(name);
    }
  });

  it("allows the two leave types", () => {
    expect(typeAllowsPriority("urlop")).toBe(true);
    expect(typeAllowsPriority("urlop planowany")).toBe(true);
  });

  it("rejects every other seeded type", () => {
    const ineligible = seededNames.filter((name) => !PRIORITY_TYPE_NAMES.includes(name));
    expect(ineligible.length, "the seed catalogue should hold more than the two eligible types").toBeGreaterThan(0);
    for (const name of ineligible) {
      expect(typeAllowsPriority(name), `"${name}" must not be priority-eligible`).toBe(false);
    }
  });

  it("rejects an unknown name, null and undefined", () => {
    expect(typeAllowsPriority("nie ma takiego typu")).toBe(false);
    expect(typeAllowsPriority(null)).toBe(false);
    expect(typeAllowsPriority(undefined)).toBe(false);
  });

  it("does not match on a prefix — `urlop` must not make `urlop planowany` eligible by accident", () => {
    // Both are eligible, so the real risk is the inverse: a substring match would wrongly
    // admit any future "urlop bezpłatny"-style type. `includes` on the array is exact.
    expect(typeAllowsPriority("urlop bezpłatny")).toBe(false);
    expect(typeAllowsPriority("urlop ")).toBe(false);
  });
});
