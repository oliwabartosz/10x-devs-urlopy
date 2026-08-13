import { describe, it, expect } from "vitest";
import { MIN_START_TIME, clampAbsenceHours } from "@/lib/absence-hours";
import { FULL_DAY_HOURS } from "@/lib/hours";
import {
  DEGREES_PER_MINUTE,
  MAX_END_MINUTES,
  MAX_SPAN_MINUTES,
  MINUTES_PER_DAY,
  MIN_START_MINUTES,
  STEP_MINUTES,
  angleToMinutes,
  announcedBounds,
  cartesianToAngle,
  constrainHandle,
  constrainPair,
  formatClockTime,
  handleBounds,
  minutesToAngle,
  parseClockTime,
  polarToCartesian,
  snapToStep,
  stepFrom,
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

describe("stepFrom", () => {
  it("moves one grid stop per step from an on-grid value", () => {
    expect(stepFrom(at("09:00"), 1)).toBe(at("09:15"));
    expect(stepFrom(at("09:00"), -1)).toBe(at("08:45"));
    expect(stepFrom(at("09:00"), 4)).toBe(at("10:00"));
    expect(stepFrom(at("09:00"), -4)).toBe(at("08:00"));
  });

  it("lands on the grid with the first press from an off-grid value", () => {
    // The trap: snapping first would take 16:27 to 16:30 and *then* step, skipping 16:30.
    expect(stepFrom(at("16:27"), 1)).toBe(at("16:30"));
    expect(stepFrom(at("16:27"), -1)).toBe(at("16:15"));
    expect(stepFrom(at("16:27"), 4)).toBe(at("17:15"));
  });

  it("snaps in place for a zero step", () => {
    expect(stepFrom(at("16:27"), 0)).toBe(at("16:30"));
  });

  it("may leave the day, for constrainHandle to fold back", () => {
    expect(stepFrom(at("00:00"), -1)).toBe(-STEP_MINUTES);
    expect(stepFrom(at("23:45"), 1)).toBe(MINUTES_PER_DAY);
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
    //
    // Swept over the shapes a pair can actually take rather than one comfortable range: the
    // 23:59 ceiling and the empty windows behind F3 are exactly where a clamp is likeliest to
    // step outside, and a single mid-day range never reaches either.
    const pairs = [
      { name: "a plain mid-day range", startMinutes: at("09:00"), endMinutes: at("13:00") },
      { name: "a range butting against the 23:59 ceiling", startMinutes: at("20:00"), endMinutes: at("23:45") },
      { name: "a legal off-grid pair", startMinutes: at("16:27"), endMinutes: at("16:52") },
      // Below the floor: the start has nowhere legal to go, the end still does.
      { name: "a pair below the 06:00 floor", startMinutes: at("00:05"), endMinutes: at("00:10") },
      // Against the ceiling: the mirror case — here it is the end whose window is empty.
      { name: "a pair pinned against midnight", startMinutes: at("23:50"), endMinutes: at("23:55") },
    ];

    for (const pair of pairs) {
      const { startMinutes, endMinutes } = pair;
      for (const handle of ["start", "end"] as const) {
        const { min, max } = handleBounds(handle, startMinutes, endMinutes);
        const current = handle === "start" ? startMinutes : endMinutes;
        for (let candidate = 0; candidate < MINUTES_PER_DAY; candidate++) {
          const result = constrainHandle({ handle, candidateMinutes: candidate, startMinutes, endMinutes });
          if (min > max) {
            // An empty window has no position to offer, so the only legal answer is "did not
            // move" — inventing one would rewrite a row on first touch.
            expect(result, `${handle} on ${pair.name}`).toBe(current);
          } else {
            expect(result, `${handle} on ${pair.name}`).toBeGreaterThanOrEqual(min);
            expect(result, `${handle} on ${pair.name}`).toBeLessThanOrEqual(max);
          }
        }
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

describe("announcedBounds", () => {
  it("matches the raw window when the handle sits inside it", () => {
    const range = { startMinutes: at("09:00"), endMinutes: at("13:00") };
    const raw = handleBounds("start", range.startMinutes, range.endMinutes);
    expect(announcedBounds("start", range.startMinutes, range.startMinutes, range.endMinutes)).toEqual({
      ...raw,
      movable: true,
    });
  });

  it("widens to contain a value that sits outside its own window", () => {
    // An inverted pair is typeable (`saveDisabled` does not require end > start), and ARIA
    // requires valuenow to lie within valuemin..valuemax — announcing 09:00 as outside its own
    // range is invalid markup, not a useful signal.
    const inverted = { startMinutes: at("14:00"), endMinutes: at("09:00") };
    const announced = announcedBounds("end", inverted.endMinutes, inverted.startMinutes, inverted.endMinutes);
    expect(announced.min).toBeLessThanOrEqual(at("09:00"));
    expect(announced.max).toBeGreaterThanOrEqual(at("09:00"));
    expect(announced.movable).toBe(true);
  });

  it("announces a single point for a handle with nowhere legal to go", () => {
    // 23:50–23:55: the end cannot step up without leaving the day, so its window is empty and
    // the raw bounds invert (min 1445 > max 1439).
    const tooLate = { startMinutes: at("23:50"), endMinutes: at("23:55") };
    expect(announcedBounds("end", tooLate.endMinutes, tooLate.startMinutes, tooLate.endMinutes)).toEqual({
      min: at("23:55"),
      max: at("23:55"),
      movable: false,
    });
  });

  it("never announces an inverted or non-containing range, for any pair on the face", () => {
    for (let start = 0; start < MINUTES_PER_DAY; start += STEP_MINUTES) {
      for (let end = 0; end < MINUTES_PER_DAY; end += 60) {
        for (const [handle, value] of [
          ["start", start],
          ["end", end],
        ] as const) {
          const { min, max } = announcedBounds(handle, value, start, end);
          expect(min).toBeLessThanOrEqual(max);
          expect(value).toBeGreaterThanOrEqual(min);
          expect(value).toBeLessThanOrEqual(max);
        }
      }
    }
  });
});

describe("constrainPair", () => {
  it("floors an illegal anchor instead of re-committing it", () => {
    // The path this closes: a start of 04:00 with an empty end never meets the blur clamp
    // (`AbsenceFormDialog.clampTimesOnBlur` returns early while either field is empty), so it
    // reaches the dial intact. Moving the *end* handle used to echo 04:00 straight back out, and
    // the API would then rewrite it to 06:00 without telling anyone.
    const illegal = { startMinutes: at("04:00"), endMinutes: at("12:00") };
    expect(constrainPair({ handle: "end", candidateMinutes: at("10:00"), ...illegal })).toEqual({
      startMinutes: at("06:00"),
      endMinutes: at("10:00"),
    });
  });

  it("measures the end's cap from the floored start, as the server does", () => {
    // Capping against the un-floored 04:00 would stop the end at 12:00, a ceiling the API does
    // not enforce — it clamps to `06:00 + 8h`. (A candidate much further round the face would
    // reach the *lower* edge instead, by the circular rule constrainHandle is tested for above.)
    const illegal = { startMinutes: at("04:00"), endMinutes: at("12:00") };
    expect(constrainPair({ handle: "end", candidateMinutes: at("15:00"), ...illegal })).toEqual({
      startMinutes: at("06:00"),
      endMinutes: at("14:00"),
    });
  });

  it("clamps the anchor without snapping it", () => {
    // Free-minute rows stay editable by typing, so dragging one handle must not drag the other
    // onto the quarter-hour grid — only the handle being moved snaps.
    const offGrid = { startMinutes: at("16:27"), endMinutes: at("16:52") };
    expect(constrainPair({ handle: "end", candidateMinutes: at("18:03"), ...offGrid })).toEqual({
      startMinutes: at("16:27"),
      endMinutes: at("18:00"),
    });
  });

  it("pulls the anchor in when the moved handle would otherwise leave it illegal", () => {
    // Dragging the start forward past `end − 8h` is impossible, but dragging it forward at all
    // must keep the end inside the span measured from the new start.
    const wide = { startMinutes: at("08:00"), endMinutes: at("16:00") };
    expect(constrainPair({ handle: "start", candidateMinutes: at("09:00"), ...wide })).toEqual({
      startMinutes: at("09:00"),
      endMinutes: at("16:00"),
    });
  });

  it("emits only pairs the server returns unchanged", () => {
    // The invariant the whole module exists for, stated as a property rather than a comment:
    // whatever leaves the dial must be a fixed point of `clampAbsenceHours`. This is the check
    // that would have caught the anchor bug at Phase 1.
    const pairs = [
      { startMinutes: at("09:00"), endMinutes: at("13:00") },
      { startMinutes: at("04:00"), endMinutes: at("12:00") }, // start below the floor
      { startMinutes: at("14:00"), endMinutes: at("09:00") }, // inverted
      { startMinutes: at("08:00"), endMinutes: at("22:00") }, // wider than the cap
      { startMinutes: at("16:27"), endMinutes: at("16:52") }, // off-grid but legal
      { startMinutes: at("20:00"), endMinutes: at("23:55") }, // against the ceiling
    ];
    for (const pair of pairs) {
      for (const handle of ["start", "end"] as const) {
        for (let candidate = 0; candidate < MINUTES_PER_DAY; candidate += STEP_MINUTES) {
          const next = constrainPair({ handle, candidateMinutes: candidate, ...pair });
          const startTime = formatClockTime(next.startMinutes);
          const endTime = formatClockTime(next.endMinutes);
          expect(clampAbsenceHours(startTime, endTime)).toEqual({ ok: true, startTime, endTime });
        }
      }
    }
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
