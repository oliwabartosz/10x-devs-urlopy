import { describe, it, expect } from "vitest";
import {
  dateKey,
  isWeekend,
  isWeekendDateKey,
  selectionSpan,
  isRangeGesture,
  isCellSelected,
  expandSpanToWeekdays,
  partitionRange,
} from "@/lib/absence-range";
import type { Absence } from "@/types";

// August 2026 is the reference month throughout — it is the month the plan's own manual test
// walks through, and it opens on a Saturday and closes on a Monday, so the first and last
// rendered rows exercise both sides of the weekend rule without a second fixture.
//
//   Sa Su Mo Tu We Th Fr    (1 Aug 2026 is a Saturday)
//    1  2  3  4  5  6  7
//    8  9 10 11 12 13 14
//   15 16 17 18 19 20 21
//   22 23 24 25 26 27 28
//   29 30 31
//
// 31 days, 10 of them weekend (Sat 1/8/15/22/29, Sun 2/9/16/23/30), so 21 weekdays.
const YEAR = 2026;
const MONTH = 8;

/** The rendered month, built exactly as AbsenceGrid.getDaysInMonth builds it. */
function monthDays(year: number, month: number): Date[] {
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, i) => new Date(year, month - 1, i + 1));
}

const AUGUST = monthDays(YEAR, MONTH);

/** Index into `AUGUST` for a day of the month. Keeps the tests readable as calendar dates. */
function idx(dayOfMonth: number): number {
  return dayOfMonth - 1;
}

/** The day-of-month numbers a span expands to — the assertion shape most tests want. */
function expandedDays(from: number, to: number, days: readonly Date[] = AUGUST): number[] {
  return expandSpanToWeekdays(days, selectionSpan({ anchorIndex: idx(from), currentIndex: idx(to) })).map((d) =>
    d.getDate(),
  );
}

function absence(overrides: Partial<Absence> = {}): Absence {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    employee_id: "22222222-2222-4222-8222-222222222222",
    absence_type_id: 1,
    date: "2026-08-12",
    is_full_day: true,
    start_time: null,
    end_time: null,
    comment: null,
    substitute_employee_id: null,
    created_at: new Date("2026-08-01T00:00:00Z"),
    updated_at: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

describe("dateKey", () => {
  it("formats a date as YYYY-MM-DD with both parts padded", () => {
    expect(dateKey(new Date(2026, 7, 13))).toBe("2026-08-13");
    expect(dateKey(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(dateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("reports the local calendar day for every day of the reference month", () => {
    // The property the whole module rests on: the key is the day the *user* sees in the row,
    // never a UTC reinterpretation of it.
    for (const date of AUGUST) {
      const expected = `2026-08-${String(date.getDate()).padStart(2, "0")}`;
      expect(dateKey(date)).toBe(expected);
    }
  });

  it("ignores the time of day, so any moment within a day keys the same", () => {
    expect(dateKey(new Date(2026, 7, 13, 0, 0, 0))).toBe("2026-08-13");
    expect(dateKey(new Date(2026, 7, 13, 23, 59, 59))).toBe("2026-08-13");
  });

  it("does not shift a day in a positive UTC offset", () => {
    // The regression this guards: the grid builds days at *local* midnight, which in any
    // positive offset is the previous day in UTC — so `toISOString().slice(0, 10)` would key
    // 12 August for the row the user clicked as 13 August, and every occupied-day lookup
    // would silently miss. Asserted against the runner's actual offset so the test stays
    // honest both in CI (UTC, where the two agree) and locally (Warsaw, where they diverge).
    const localMidnight = new Date(2026, 7, 13);
    expect(dateKey(localMidnight)).toBe("2026-08-13");

    const isoKey = localMidnight.toISOString().slice(0, 10);
    if (localMidnight.getTimezoneOffset() < 0) {
      expect(isoKey).not.toBe(dateKey(localMidnight));
    } else {
      expect(isoKey).toBe(dateKey(localMidnight));
    }
  });
});

describe("isWeekend", () => {
  it("is true for Saturday and Sunday only", () => {
    expect(AUGUST.filter(isWeekend).map((d) => d.getDate())).toEqual([1, 2, 8, 9, 15, 16, 22, 23, 29, 30]);
  });
});

describe("isWeekendDateKey — the server's half of the guard", () => {
  it("agrees with isWeekend for every day of the reference month", () => {
    // One rule, two call sites. The client drops these days; the route rejects the request.
    for (const date of AUGUST) {
      expect(isWeekendDateKey(dateKey(date))).toBe(isWeekend(date));
    }
  });

  it("names the weekend days of the reference month", () => {
    expect(AUGUST.map(dateKey).filter(isWeekendDateKey)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-08",
      "2026-08-09",
      "2026-08-15",
      "2026-08-16",
      "2026-08-22",
      "2026-08-23",
      "2026-08-29",
      "2026-08-30",
    ]);
  });

  it("reads the key as UTC, so the answer does not depend on where the server runs", () => {
    // 15 August 2026 is a Saturday everywhere. A local-time parse would keep saying so on this
    // machine and could disagree elsewhere; pinning to UTC is what makes the rule portable.
    expect(isWeekendDateKey("2026-08-15")).toBe(true);
    expect(isWeekendDateKey("2026-08-16")).toBe(true);
    expect(isWeekendDateKey("2026-08-17")).toBe(false);
    expect(isWeekendDateKey("2026-08-14")).toBe(false);
  });

  it("defers format rejection to DateSchema rather than answering for a malformed key", () => {
    expect(isWeekendDateKey("nonsense")).toBe(false);
    expect(isWeekendDateKey("")).toBe(false);
  });
});

describe("selectionSpan — direction normalisation", () => {
  it("returns the span unchanged for a downward drag", () => {
    expect(selectionSpan({ anchorIndex: 3, currentIndex: 9 })).toEqual({ start: 3, end: 9 });
  });

  it("flips an upward drag onto the same span", () => {
    expect(selectionSpan({ anchorIndex: 9, currentIndex: 3 })).toEqual({ start: 3, end: 9 });
  });

  it("produces one identical span for both directions over the same days", () => {
    expect(selectionSpan({ anchorIndex: 9, currentIndex: 3 })).toEqual(
      selectionSpan({ anchorIndex: 3, currentIndex: 9 }),
    );
  });

  it("collapses a single-cell press to a one-day span", () => {
    expect(selectionSpan({ anchorIndex: 5, currentIndex: 5 })).toEqual({ start: 5, end: 5 });
  });
});

describe("isRangeGesture — the commit predicate", () => {
  it("rejects a press that never left its cell, so the ordinary click still runs", () => {
    expect(isRangeGesture({ anchorIndex: 5, currentIndex: 5 })).toBe(false);
  });

  it("accepts two distinct days", () => {
    expect(isRangeGesture({ anchorIndex: 5, currentIndex: 6 })).toBe(true);
  });

  it("accepts an upward two-day drag on the same terms", () => {
    expect(isRangeGesture({ anchorIndex: 6, currentIndex: 5 })).toBe(true);
  });

  it("counts days rather than distance, so a month-long drag is not a special case", () => {
    expect(isRangeGesture({ anchorIndex: 0, currentIndex: 30 })).toBe(true);
  });
});

describe("isCellSelected", () => {
  const selection = { employeeId: "emp-a", anchorIndex: 9, currentIndex: 3 };

  it("highlights nothing when no drag is active", () => {
    expect(isCellSelected(null, "emp-a", 5)).toBe(false);
  });

  it("highlights the interior of an upward drag", () => {
    expect(isCellSelected(selection, "emp-a", 5)).toBe(true);
  });

  it("includes both ends", () => {
    expect(isCellSelected(selection, "emp-a", 3)).toBe(true);
    expect(isCellSelected(selection, "emp-a", 9)).toBe(true);
  });

  it("excludes the days just outside the span", () => {
    expect(isCellSelected(selection, "emp-a", 2)).toBe(false);
    expect(isCellSelected(selection, "emp-a", 10)).toBe(false);
  });

  it("never spreads into another employee's column", () => {
    // The horizontal-spread guard. Same day, same span, different column.
    expect(isCellSelected(selection, "emp-b", 5)).toBe(false);
  });
});

describe("expandSpanToWeekdays", () => {
  it("drops the weekend an ordinary range crosses", () => {
    // The plan's worked example: 12 -> 21 August is ten calendar days and eight weekdays.
    expect(expandedDays(12, 21)).toEqual([12, 13, 14, 17, 18, 19, 20, 21]);
  });

  it("expands an upward drag to the same days as the downward one", () => {
    expect(expandedDays(21, 12)).toEqual(expandedDays(12, 21));
  });

  it("yields two days for a Friday-to-Monday drag whose whole interior is weekend", () => {
    expect(expandedDays(7, 10)).toEqual([7, 10]);
  });

  it("yields nothing for a span that is only weekend", () => {
    // Unreachable from the UI — weekend cells receive no drag handlers, so neither end of a
    // real selection can be one — but the module answers rather than assuming.
    expect(expandedDays(8, 9)).toEqual([]);
  });

  it("yields a single day for a one-cell span on a weekday", () => {
    expect(expandedDays(12, 12)).toEqual([12]);
  });

  it("yields only the weekdays of a whole-month span", () => {
    const all = expandedDays(1, 31);
    expect(all).toHaveLength(21);
    expect(all).not.toContain(1);
    expect(all).not.toContain(2);
    expect(all.every((day) => !isWeekend(new Date(YEAR, MONTH - 1, day)))).toBe(true);
  });

  it("handles a span anchored on the first rendered day, which is a Saturday", () => {
    expect(expandedDays(1, 3)).toEqual([3]);
  });

  it("handles a span reaching the last rendered day, which is a Monday", () => {
    expect(expandedDays(29, 31)).toEqual([31]);
  });

  it("clamps indices to the rendered month rather than reading past its ends", () => {
    expect(expandSpanToWeekdays(AUGUST, { start: -5, end: 2 }).map((d) => d.getDate())).toEqual([3]);
    expect(expandSpanToWeekdays(AUGUST, { start: 28, end: 99 }).map((d) => d.getDate())).toEqual([31]);
  });

  it("returns the caller's own Date objects, not copies", () => {
    const [first] = expandSpanToWeekdays(AUGUST, { start: idx(12), end: idx(12) });
    expect(first).toBe(AUGUST[idx(12)]);
  });

  it("crosses a month boundary when the caller renders two months", () => {
    // Not something today's grid does — it renders one month — but the span carries no month
    // of its own, so the behaviour should follow the array it is given.
    const twoMonths = [...monthDays(2026, 8), ...monthDays(2026, 9)];
    const acrossTheBoundary = expandSpanToWeekdays(twoMonths, { start: 30, end: 32 }).map(dateKey);
    expect(acrossTheBoundary).toEqual(["2026-08-31", "2026-09-01", "2026-09-02"]);
  });
});

describe("partitionRange", () => {
  const fullDay = absence({ date: "2026-08-13", absence_type_id: 1 });
  const partialDay = absence({
    id: "33333333-3333-4333-8333-333333333333",
    date: "2026-08-18",
    absence_type_id: 6,
    is_full_day: false,
    start_time: "09:00:00",
    end_time: "13:00:00",
  });

  const existing = new Map<string, Absence>([
    ["2026-08-13", fullDay],
    ["2026-08-18", partialDay],
  ]);
  const lookup = (key: string) => existing.get(key);

  it("separates free days from a mix of full-day and partial-day entries", () => {
    const dates = expandSpanToWeekdays(AUGUST, selectionSpan({ anchorIndex: idx(12), currentIndex: idx(21) }));
    const { free, occupied } = partitionRange(dates, lookup);

    expect(free.map((d) => d.key)).toEqual([
      "2026-08-12",
      "2026-08-14",
      "2026-08-17",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
    ]);
    expect(occupied.map((d) => d.key)).toEqual(["2026-08-13", "2026-08-18"]);
  });

  it("carries the existing entry through, so the confirmation needs no second lookup", () => {
    const dates = expandSpanToWeekdays(AUGUST, selectionSpan({ anchorIndex: idx(12), currentIndex: idx(21) }));
    const { occupied } = partitionRange(dates, lookup);

    // Everything the overwrite confirmation has to render about what it will destroy.
    expect(occupied[0]?.absence).toBe(fullDay);
    expect(occupied[1]?.absence).toBe(partialDay);
    expect(occupied[1]?.absence.start_time).toBe("09:00:00");
    expect(occupied[1]?.absence.end_time).toBe("13:00:00");
    expect(occupied[1]?.absence.is_full_day).toBe(false);
  });

  it("pairs each day with its date as well as its key", () => {
    const { free } = partitionRange([AUGUST[idx(12)]], lookup);
    expect(free[0]?.date).toBe(AUGUST[idx(12)]);
    expect(free[0]?.key).toBe("2026-08-12");
  });

  it("reports every day free when the range crosses nothing", () => {
    const dates = expandSpanToWeekdays(AUGUST, selectionSpan({ anchorIndex: idx(19), currentIndex: idx(21) }));
    const { free, occupied } = partitionRange(dates, lookup);

    expect(free.map((d) => d.key)).toEqual(["2026-08-19", "2026-08-20", "2026-08-21"]);
    expect(occupied).toEqual([]);
  });

  it("reports every day occupied when the range crosses nothing free", () => {
    const { free, occupied } = partitionRange([AUGUST[idx(13)], AUGUST[idx(18)]], lookup);

    expect(free).toEqual([]);
    expect(occupied.map((d) => d.key)).toEqual(["2026-08-13", "2026-08-18"]);
  });

  it("returns two empty sides for an empty range", () => {
    expect(partitionRange([], lookup)).toEqual({ free: [], occupied: [] });
  });

  it("asks the caller's lookup for each day, never assuming a key format", () => {
    const asked: string[] = [];
    partitionRange([AUGUST[idx(12)], AUGUST[idx(13)]], (key) => {
      asked.push(key);
      return undefined;
    });
    expect(asked).toEqual(["2026-08-12", "2026-08-13"]);
  });
});
