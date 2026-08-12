import { describe, it, expect } from "vitest";
import { formatTime, cellTimeRange } from "@/lib/absence-grid-cell";
import { ONSITE_TRAINING_TYPE_NAME, OFFSITE_TRAINING_TYPE_NAME } from "@/lib/absence-types";

// The seven seeded names, verbatim from 20260807122840_faulty_hobgoblin.sql.
const PARTIAL_DAY_TYPES = [ONSITE_TRAINING_TYPE_NAME, OFFSITE_TRAINING_TYPE_NAME];
const FULL_DAY_ONLY_TYPES = ["urlop", "choroba", "wyjazd zagraniczny", "stała nieobecność", "urlop planowany"];

/** A partial-day absence carrying both times — the only shape that can produce a range. */
function partialDay(start = "08:00:00", end = "16:00:00") {
  return { is_full_day: false, start_time: start, end_time: end };
}

describe("formatTime", () => {
  it("strips the seconds from a Postgres time value", () => {
    expect(formatTime("08:00:00")).toBe("08:00");
    expect(formatTime("23:59:59")).toBe("23:59");
  });

  it("returns an empty string for a missing value", () => {
    expect(formatTime(null)).toBe("");
    expect(formatTime(undefined)).toBe("");
  });
});

describe("cellTimeRange — the type gate", () => {
  it.each(PARTIAL_DAY_TYPES)("renders a range for the whitelisted type %s", (typeName) => {
    expect(cellTimeRange(partialDay(), typeName)).toBe("08:00–16:00");
  });

  it.each(FULL_DAY_ONLY_TYPES)("renders nothing for %s even with both times present", (typeName) => {
    // The row is out of contract — no DB constraint ties the times to the type, so it can
    // exist. The cell renders as full-day; only the tooltip still reports the real hours.
    expect(cellTimeRange(partialDay(), typeName)).toBe("");
  });

  it("renders nothing for an unknown or absent type name", () => {
    expect(cellTimeRange(partialDay(), "szkolenie")).toBe("");
    expect(cellTimeRange(partialDay(), "")).toBe("");
    expect(cellTimeRange(partialDay(), null)).toBe("");
    expect(cellTimeRange(partialDay(), undefined)).toBe("");
  });
});

describe("cellTimeRange — the absence shape", () => {
  it("renders nothing for a full-day absence on a whitelisted type", () => {
    expect(
      cellTimeRange({ is_full_day: true, start_time: "08:00:00", end_time: "16:00:00" }, ONSITE_TRAINING_TYPE_NAME),
    ).toBe("");
  });

  it("renders nothing when either time is missing", () => {
    expect(
      cellTimeRange({ is_full_day: false, start_time: null, end_time: "16:00:00" }, ONSITE_TRAINING_TYPE_NAME),
    ).toBe("");
    expect(
      cellTimeRange({ is_full_day: false, start_time: "08:00:00", end_time: null }, ONSITE_TRAINING_TYPE_NAME),
    ).toBe("");
    expect(cellTimeRange({ is_full_day: false, start_time: null, end_time: null }, ONSITE_TRAINING_TYPE_NAME)).toBe("");
  });
});

describe("cellTimeRange — formatting", () => {
  it("strips seconds from both ends", () => {
    expect(cellTimeRange(partialDay("06:30:00", "14:45:00"), OFFSITE_TRAINING_TYPE_NAME)).toBe("06:30–14:45");
  });

  it("joins with U+2013 EN DASH and no surrounding spaces", () => {
    // The cell is ~120px wide; spaces around the dash are not affordable, and a hyphen
    // would not match the design. Pinned by codepoint so neither can drift back in.
    const range = cellTimeRange(partialDay(), ONSITE_TRAINING_TYPE_NAME);
    expect(range).toBe("08:00–16:00");
    expect(range).not.toContain(" ");
    expect(range).not.toContain("-");
    expect(range).toContain("–");
  });
});
