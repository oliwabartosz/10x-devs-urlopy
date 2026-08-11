import { describe, it, expect } from "vitest";
import { MIN_START_TIME } from "@/lib/absence-hours";
import { FULL_DAY_HOURS } from "@/lib/hours";
import {
  DEGREES_PER_MINUTE,
  MAX_END_MINUTES,
  MAX_SPAN_MINUTES,
  MINUTES_PER_DAY,
  MIN_START_MINUTES,
  STEP_MINUTES,
  angleToMinutes,
  cartesianToAngle,
  constrainHandle,
  formatClockTime,
  handleBounds,
  minutesToAngle,
  parseClockTime,
  polarToCartesian,
  snapToStep,
} from "@/lib/time-dial";

/** `"HH:MM"` → minutes, for readable expectations. Throws rather than returning null. */
function at(time: string): number {
  const minutes = parseClockTime(time);
  if (minutes === null) throw new Error(`bad fixture time: ${time}`);
  return minutes;
}

describe("derived constants", () => {
  it("takes the floor from MIN_START_TIME, not a literal", () => {
    expect(MIN_START_MINUTES).toBe(parseClockTime(MIN_START_TIME));
    expect(formatClockTime(MIN_START_MINUTES)).toBe(MIN_START_TIME);
  });

  it("takes the span cap from FULL_DAY_HOURS, not a literal", () => {
    expect(MAX_SPAN_MINUTES).toBe(FULL_DAY_HOURS * 60);
  });

  it("stops the end at 23:59, matching absences_time_check's no-midnight-crossing rule", () => {
    expect(formatClockTime(MAX_END_MINUTES)).toBe("23:59");
  });

  it("puts 96 quarter-hour stops on the face", () => {
    expect(MINUTES_PER_DAY / STEP_MINUTES).toBe(96);
    expect(STEP_MINUTES * DEGREES_PER_MINUTE).toBe(3.75);
  });
});

describe("minutesToAngle / angleToMinutes", () => {
  it("puts midnight at 12 o'clock and runs clockwise at 0.25°/min", () => {
    expect(minutesToAngle(at("00:00"))).toBe(0);
    expect(minutesToAngle(at("06:00"))).toBe(90);
    expect(minutesToAngle(at("12:00"))).toBe(180);
    expect(minutesToAngle(at("18:00"))).toBe(270);
    expect(minutesToAngle(at("23:59"))).toBeCloseTo(359.75, 10);
  });

  it("round-trips every minute of the day", () => {
    for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes++) {
      expect(angleToMinutes(minutesToAngle(minutes))).toBe(minutes);
    }
  });

  it("keeps an angle just past 12 o'clock on today's face", () => {
    // The wraparound guard. 360.5° is one revolution plus two minutes; reading it as 1442
    // would hand callers a next-day value that looks like a legal time.
    expect(angleToMinutes(360.5)).toBe(2);
    expect(angleToMinutes(360)).toBe(0);
    expect(angleToMinutes(-0.25)).toBe(MINUTES_PER_DAY - 1);
    expect(angleToMinutes(720 + 90)).toBe(at("06:00"));
  });
});

describe("snapToStep", () => {
  it("rounds to the nearest quarter hour, ties up", () => {
    expect(snapToStep(at("07:07"))).toBe(at("07:00"));
    expect(snapToStep(at("07:08"))).toBe(at("07:15"));
    expect(snapToStep(at("07:00"))).toBe(at("07:00"));
    expect(snapToStep(at("07:15"))).toBe(at("07:15"));
  });

  it("leaves every grid stop untouched", () => {
    for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes += STEP_MINUTES) {
      expect(snapToStep(minutes)).toBe(minutes);
    }
  });

  it("folds a snap past midnight back onto the same face", () => {
    // 23:53 is nearer to 24:00 than to 23:45, and 24:00 is 00:00 today.
    expect(snapToStep(at("23:53"))).toBe(at("00:00"));
    expect(snapToStep(at("23:52"))).toBe(at("23:45"));
  });
});

describe("handleBounds", () => {
  it("anchors the start against the end", () => {
    expect(handleBounds("start", at("09:00"), at("13:00"))).toEqual({
      min: at("06:00"), // the floor, not 13:00 − 8h = 05:00
      max: at("12:45"), // one step below the end
    });
    expect(handleBounds("start", at("15:00"), at("20:00"))).toEqual({
      min: at("12:00"), // the cap bites before the floor does
      max: at("19:45"),
    });
  });

  it("anchors the end against the start", () => {
    expect(handleBounds("end", at("09:00"), at("13:00"))).toEqual({
      min: at("09:15"),
      max: at("17:00"), // start + 8h
    });
    expect(handleBounds("end", at("20:00"), at("21:00"))).toEqual({
      min: at("20:15"),
      max: at("23:59"), // the ceiling bites before the cap does
    });
  });
});

describe("constrainHandle", () => {
  const range = { startMinutes: at("09:00"), endMinutes: at("13:00") };

  it("passes a legal candidate through, snapped", () => {
    expect(constrainHandle({ handle: "start", candidateMinutes: at("10:07"), ...range })).toBe(at("10:00"));
    expect(constrainHandle({ handle: "end", candidateMinutes: at("14:08"), ...range })).toBe(at("14:15"));
  });

  it("stops the start at the 06:00 floor", () => {
    expect(constrainHandle({ handle: "start", candidateMinutes: at("05:45"), ...range })).toBe(at("06:00"));
    expect(constrainHandle({ handle: "start", candidateMinutes: at("02:00"), ...range })).toBe(at("06:00"));
  });

  it("pins the end at start + 8h", () => {
    expect(constrainHandle({ handle: "end", candidateMinutes: at("17:15"), ...range })).toBe(at("17:00"));
    expect(constrainHandle({ handle: "end", candidateMinutes: at("22:00"), ...range })).toBe(at("17:00"));
  });

  it("pins the start at end − 8h, so widening from the other side is no easier", () => {
    // The trap this guards: with only the end anchored, a user drags the *start* backwards and
    // opens a 12-hour range the server would then silently cut back to 8.
    const late = { startMinutes: at("15:00"), endMinutes: at("20:00") };
    expect(constrainHandle({ handle: "start", candidateMinutes: at("11:00"), ...late })).toBe(at("12:00"));
    expect(constrainHandle({ handle: "start", candidateMinutes: at("08:00"), ...late })).toBe(at("12:00"));
  });

  it("stops the end at the 23:59 ceiling", () => {
    const evening = { startMinutes: at("20:00"), endMinutes: at("22:00") };
    expect(constrainHandle({ handle: "end", candidateMinutes: at("23:45"), ...evening })).toBe(at("23:45"));
    // The ceiling is the true boundary, not the grid stop below it.
    expect(constrainHandle({ handle: "end", candidateMinutes: at("23:53"), ...evening })).toBe(at("23:59"));
  });

  it("keeps the handles from crossing or meeting", () => {
    expect(constrainHandle({ handle: "end", candidateMinutes: at("09:00"), ...range })).toBe(at("09:15"));
    expect(constrainHandle({ handle: "end", candidateMinutes: at("07:00"), ...range })).toBe(at("09:15"));
    expect(constrainHandle({ handle: "start", candidateMinutes: at("13:00"), ...range })).toBe(at("12:45"));
    expect(constrainHandle({ handle: "start", candidateMinutes: at("14:00"), ...range })).toBe(at("12:45"));
  });

  it("clamps to the circularly nearer edge, so a drag past midnight does not fling the handle", () => {
    // Dragging the end clockwise past 12 o'clock lands the candidate near 00:15. Numeric
    // clamping would return 20:15 — three quarters of a turn back the way it came.
    const evening = { startMinutes: at("20:00"), endMinutes: at("22:00") };
    expect(constrainHandle({ handle: "end", candidateMinutes: at("00:15"), ...evening })).toBe(at("23:59"));
    expect(constrainHandle({ handle: "end", candidateMinutes: at("01:00"), ...evening })).toBe(at("23:59"));

    // Same in reverse: dragging the start anticlockwise past midnight stops at the floor.
    expect(constrainHandle({ handle: "start", candidateMinutes: at("23:00"), ...range })).toBe(at("06:00"));
  });

  it("never lands outside the announced window, for any candidate on the face", () => {
    // aria-valuemin/max come from handleBounds; a reachable position outside them would make the
    // screen-reader announcement a lie.
    for (const handle of ["start", "end"] as const) {
      const { min, max } = handleBounds(handle, range.startMinutes, range.endMinutes);
      for (let candidate = 0; candidate < MINUTES_PER_DAY; candidate++) {
        const result = constrainHandle({ handle, candidateMinutes: candidate, ...range });
        expect(result).toBeGreaterThanOrEqual(min);
        expect(result).toBeLessThanOrEqual(max);
      }
    }
  });

  it("refuses to move a handle whose window is empty", () => {
    // A pair from before this rule existed: 00:05–00:10 leaves the start nowhere legal to go
    // (the floor is above the end). Inventing a position here would corrupt the row on first
    // touch; the dial simply does not move.
    const degenerate = { startMinutes: at("00:05"), endMinutes: at("00:10") };
    expect(constrainHandle({ handle: "start", candidateMinutes: at("09:00"), ...degenerate })).toBe(at("00:05"));

    const tooLate = { startMinutes: at("23:50"), endMinutes: at("23:55") };
    expect(constrainHandle({ handle: "end", candidateMinutes: at("12:00"), ...tooLate })).toBe(at("23:55"));
  });

  it("lets a legal off-grid pair be moved onto the grid without jumping", () => {
    // Typed entry keeps free-minute precision, so rows like 16:27–16:52 exist. Touching one
    // handle snaps only that handle.
    const offGrid = { startMinutes: at("16:27"), endMinutes: at("16:52") };
    expect(constrainHandle({ handle: "end", candidateMinutes: at("18:03"), ...offGrid })).toBe(at("18:00"));
    expect(constrainHandle({ handle: "start", candidateMinutes: at("16:20"), ...offGrid })).toBe(at("16:15"));
  });
});

describe("polarToCartesian / cartesianToAngle", () => {
  const face = { cx: 100, cy: 100, radius: 80 };

  it("places midnight at the top and runs clockwise", () => {
    const midnight = polarToCartesian({ ...face, degrees: minutesToAngle(at("00:00")) });
    expect(midnight.x).toBeCloseTo(100, 10);
    expect(midnight.y).toBeCloseTo(20, 10);

    const sixAm = polarToCartesian({ ...face, degrees: minutesToAngle(at("06:00")) });
    expect(sixAm.x).toBeCloseTo(180, 10);
    expect(sixAm.y).toBeCloseTo(100, 10);

    const noon = polarToCartesian({ ...face, degrees: minutesToAngle(at("12:00")) });
    expect(noon.x).toBeCloseTo(100, 10);
    expect(noon.y).toBeCloseTo(180, 10);
  });

  it("round-trips every grid stop back to its own minute", () => {
    for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes += STEP_MINUTES) {
      const point = polarToCartesian({ ...face, degrees: minutesToAngle(minutes) });
      const angle = cartesianToAngle(point.x - face.cx, point.y - face.cy);
      expect(angleToMinutes(angle)).toBe(minutes);
    }
  });

  it("reads direction only, ignoring how far from the centre the pointer is", () => {
    // Pointer drag should keep working when the cursor wanders off the ring.
    expect(cartesianToAngle(0, -1)).toBeCloseTo(0, 10);
    expect(cartesianToAngle(0, -500)).toBeCloseTo(0, 10);
    expect(cartesianToAngle(3, 0)).toBeCloseTo(90, 10);
    expect(cartesianToAngle(0, 7)).toBeCloseTo(180, 10);
    expect(cartesianToAngle(-2, 0)).toBeCloseTo(270, 10);
  });
});

describe("parseClockTime / formatClockTime", () => {
  it("accepts both the form's HH:MM and Postgres's HH:MM:SS", () => {
    expect(parseClockTime("06:00")).toBe(360);
    expect(parseClockTime("06:00:00")).toBe(360);
    expect(parseClockTime("23:59")).toBe(MAX_END_MINUTES);
  });

  it("returns null rather than arithmetic on a non-time", () => {
    expect(parseClockTime("")).toBeNull();
    expect(parseClockTime("9:00")).toBeNull();
    expect(parseClockTime("24:00")).toBeNull();
    expect(parseClockTime("12:60")).toBeNull();
  });

  it("round-trips every minute of the day", () => {
    for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes++) {
      expect(parseClockTime(formatClockTime(minutes))).toBe(minutes);
    }
  });
});
