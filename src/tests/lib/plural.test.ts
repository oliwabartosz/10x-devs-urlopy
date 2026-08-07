import { describe, it, expect } from "vitest";
import { pluralPl, entryCountLabel } from "@/lib/plural";

describe("pluralPl", () => {
  it("uses the singular only for exactly 1", () => {
    expect(pluralPl(1, "wpis", "wpisy", "wpisów")).toBe("wpis");
    expect(pluralPl(0, "wpis", "wpisy", "wpisów")).toBe("wpisów");
  });

  it("uses the few form for 2-4", () => {
    for (const n of [2, 3, 4]) expect(pluralPl(n, "wpis", "wpisy", "wpisów")).toBe("wpisy");
  });

  it("uses the many form for 5-21 except where the last digit is 2-4", () => {
    for (const n of [5, 9, 11, 20, 21]) expect(pluralPl(n, "wpis", "wpisy", "wpisów")).toBe("wpisów");
  });

  it("treats 12-14 as the many form despite ending in 2-4", () => {
    for (const n of [12, 13, 14, 112, 113, 114]) expect(pluralPl(n, "wpis", "wpisy", "wpisów")).toBe("wpisów");
  });

  it("uses the few form for higher numbers ending in 2-4", () => {
    for (const n of [22, 23, 24, 122, 1002]) expect(pluralPl(n, "wpis", "wpisy", "wpisów")).toBe("wpisy");
  });
});

describe("entryCountLabel", () => {
  it("covers the plan's cases", () => {
    expect(entryCountLabel(0)).toBe("0 wpisów");
    expect(entryCountLabel(1)).toBe("1 wpis");
    expect(entryCountLabel(2)).toBe("2 wpisy");
    expect(entryCountLabel(5)).toBe("5 wpisów");
    expect(entryCountLabel(12)).toBe("12 wpisów");
    expect(entryCountLabel(22)).toBe("22 wpisy");
    expect(entryCountLabel(25)).toBe("25 wpisów");
  });
});
