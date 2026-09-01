import { describe, it, expect } from "vitest";
import { ABSENCE_TYPE_SEED } from "@/db/seed";
import {
  PRIORITY_TYPE_NAMES,
  typeAllowsPriority,
  LEAVE_TYPE_NAME,
  PLANNED_LEAVE_TYPE_NAME,
  TYPE_CAPTIONS,
  captionFor,
  SICK_LEAVE_TYPE_NAME,
} from "@/lib/absence-types";

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

// Same drift guard as above, for the third name-keyed rule: a caption keyed off a name that is no
// longer in the seed catalogue renders nothing, silently.
describe("captionFor", () => {
  const seededNames = ABSENCE_TYPE_SEED.map((t) => t.name);

  it("keys every caption off a name that exists in the seed catalogue", () => {
    expect(Object.keys(TYPE_CAPTIONS).length, "at least one caption should be defined").toBeGreaterThan(0);
    for (const name of Object.keys(TYPE_CAPTIONS)) {
      expect(seededNames, `"${name}" — caption key drifted from the seed catalogue?`).toContain(name);
    }
  });

  it("returns the sick-leave caption verbatim", () => {
    expect(SICK_LEAVE_TYPE_NAME).toBe("choroba");
    expect(captionFor(SICK_LEAVE_TYPE_NAME)).toBe("zwolnienie lub opieka");
  });

  it("returns undefined for every seeded type that has no caption", () => {
    const uncaptioned = seededNames.filter((name) => !Object.hasOwn(TYPE_CAPTIONS, name));
    expect(uncaptioned.length, "most seeded types should have no caption").toBeGreaterThan(0);
    for (const name of uncaptioned) {
      expect(captionFor(name), `"${name}" must not render a caption`).toBeUndefined();
    }
  });

  it("returns undefined for an unknown name, null and undefined", () => {
    expect(captionFor("nie ma takiego typu")).toBeUndefined();
    expect(captionFor(null)).toBeUndefined();
    expect(captionFor(undefined)).toBeUndefined();
  });

  it("does not answer with inherited Object properties", () => {
    // A bare index into a plain object would return a function here, typed as string.
    expect(captionFor("constructor")).toBeUndefined();
    expect(captionFor("toString")).toBeUndefined();
    expect(captionFor("__proto__")).toBeUndefined();
  });
});
