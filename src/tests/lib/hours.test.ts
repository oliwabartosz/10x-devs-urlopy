import { describe, it, expect } from "vitest";
import { FULL_DAY_HOURS, hoursToDays, formatDayCount } from "@/lib/hours";

describe("hoursToDays", () => {
  it("treats a full day as 8 hours", () => {
    expect(FULL_DAY_HOURS).toBe(8);
    expect(hoursToDays(8)).toBe(1);
    expect(hoursToDays(16)).toBe(2);
  });

  it("converts a half day", () => {
    expect(hoursToDays(4)).toBe(0.5);
  });

  it("returns zero for zero", () => {
    expect(hoursToDays(0)).toBe(0);
  });

  it("does not round — the balance service computes with this value", () => {
    // 3h45m. Rounding here would move the used-days figure on the balance card.
    expect(hoursToDays(3.75)).toBeCloseTo(0.46875, 10);
    expect(hoursToDays(1)).toBeCloseTo(0.125, 10);
  });
});

describe("formatDayCount", () => {
  it("drops the fraction on whole days", () => {
    expect(formatDayCount(0)).toBe("0");
    expect(formatDayCount(3)).toBe("3");
  });

  it("uses a Polish decimal comma", () => {
    expect(formatDayCount(0.5)).toBe("0,5");
    expect(formatDayCount(2.5)).toBe("2,5");
  });

  it("rounds a 3h45m absence to 0,5 rather than 0,4", () => {
    expect(formatDayCount(hoursToDays(3.75))).toBe("0,5");
  });

  it("rounds below the boundary down", () => {
    // 0.4 days is 3h12m; anything under 0.45 must not read as 0,5.
    expect(formatDayCount(hoursToDays(3.2))).toBe("0,4");
  });
});
