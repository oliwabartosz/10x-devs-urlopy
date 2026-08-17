import { describe, it, expect } from "vitest";
import { MIN_START_TIME, clampAbsenceHours } from "@/lib/absence-hours";
import { FULL_DAY_HOURS } from "@/lib/hours";

describe("MIN_START_TIME", () => {
  it("is 06:00", () => {
    expect(MIN_START_TIME).toBe("06:00");
  });
});

describe("clampAbsenceHours", () => {
  it("passes an in-bounds range through untouched", () => {
    expect(clampAbsenceHours("09:00", "13:00")).toEqual({ ok: true, startTime: "09:00", endTime: "13:00" });
  });

  it("floors a start before 06:00", () => {
    expect(clampAbsenceHours("04:00", "13:00")).toEqual({ ok: true, startTime: "06:00", endTime: "13:00" });
  });

  it("caps a range longer than a full day", () => {
    expect(clampAbsenceHours("08:00", "20:00")).toEqual({ ok: true, startTime: "08:00", endTime: "16:00" });
  });

  it("floors before capping — the ordering is the contract", () => {
    // 01:00–23:00 → floor → 06:00–23:00 → cap → 06:00–14:00 (8 h).
    // Capping first would give 01:00–09:00, then flooring 06:00–09:00 — a 3 h absence.
    const result = clampAbsenceHours("01:00", "23:00");
    expect(result).toEqual({ ok: true, startTime: "06:00", endTime: "14:00" });
    expect(result).not.toEqual({ ok: true, startTime: "06:00", endTime: "09:00" });
  });

  it("rejects a range that flooring cannot repair", () => {
    // 01:00–03:00 → floor → 06:00–03:00, which no clamp can fix.
    expect(clampAbsenceHours("01:00", "03:00")).toEqual({ ok: false, reason: "end-before-floor" });
  });

  it("rejects a range ending exactly at the floor", () => {
    expect(clampAbsenceHours("01:00", "06:00")).toEqual({ ok: false, reason: "end-before-floor" });
  });

  it("distinguishes a range disordered on arrival from one the floor broke", () => {
    // Both are unclampable, but only the second has anything to do with MIN_START_TIME, and the
    // routes turn the reason into the message the caller reads. PATCH is the path that reaches
    // the first: its refine short-circuits when the body omits `is_full_day`.
    expect(clampAbsenceHours("20:00", "11:00")).toEqual({ ok: false, reason: "end-before-start" });
    expect(clampAbsenceHours("09:00", "09:00")).toEqual({ ok: false, reason: "end-before-start" });
    expect(clampAbsenceHours("20:00", "11:00:00")).toEqual({ ok: false, reason: "end-before-start" });
    // Still end-before-floor: this one is in order on arrival and only breaks once floored.
    expect(clampAbsenceHours("01:00", "03:00")).toEqual({ ok: false, reason: "end-before-floor" });
  });

  it("needs no special case for a late start", () => {
    // start + 8 h would be 04:00 next day; end is already earlier, so nothing is capped.
    expect(clampAbsenceHours("20:00", "23:00")).toEqual({ ok: true, startTime: "20:00", endTime: "23:00" });
    expect(clampAbsenceHours("20:00", "23:59")).toEqual({ ok: true, startTime: "20:00", endTime: "23:59" });
  });

  it("leaves the boundary values alone", () => {
    // A start exactly at the floor is not floored; a range of exactly FULL_DAY_HOURS is not capped.
    expect(clampAbsenceHours("06:00", "14:00")).toEqual({ ok: true, startTime: "06:00", endTime: "14:00" });
    expect(clampAbsenceHours("06:00", "06:01")).toEqual({ ok: true, startTime: "06:00", endTime: "06:01" });
    expect(clampAbsenceHours("09:00", `${String(9 + FULL_DAY_HOURS).padStart(2, "0")}:00`)).toEqual({
      ok: true,
      startTime: "09:00",
      endTime: "17:00",
    });
  });

  it("caps one minute over the cap", () => {
    expect(clampAbsenceHours("09:00", "17:01")).toEqual({ ok: true, startTime: "09:00", endTime: "17:00" });
  });

  it("normalizes HH:MM:SS identically to HH:MM", () => {
    // Postgres returns TIME as HH:MM:SS; request bodies carry HH:MM.
    expect(clampAbsenceHours("04:00:00", "13:00:00")).toEqual(clampAbsenceHours("04:00", "13:00"));
    expect(clampAbsenceHours("01:22:00", "03:22:00")).toEqual({ ok: false, reason: "end-before-floor" });
    expect(clampAbsenceHours("09:00:00", "20:00")).toEqual({ ok: true, startTime: "09:00", endTime: "17:00" });
  });

  it("rejects values that are not real clock times", () => {
    expect(clampAbsenceHours("99:99", "13:00")).toEqual({ ok: false, reason: "invalid-time" });
    expect(clampAbsenceHours("24:00", "13:00")).toEqual({ ok: false, reason: "invalid-time" });
    expect(clampAbsenceHours("09:00", "9:00")).toEqual({ ok: false, reason: "invalid-time" });
    expect(clampAbsenceHours("", "")).toEqual({ ok: false, reason: "invalid-time" });
  });
});
