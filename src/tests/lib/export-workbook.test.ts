import { describe, it, expect } from "vitest";
import type { Absence, AbsenceType, EmployeeListItem } from "@/types";
import {
  absenceNote,
  buildExportWorkbook,
  employeeColumnLabel,
  employeesForYear,
  EXPORT_YEARS_BACK,
  exportYearOptions,
  FULL_DAY_LABEL,
  monthSheetName,
  type ExportSheet,
} from "@/lib/export-workbook";
import { ONSITE_TRAINING_TYPE_NAME } from "@/lib/absence-types";

// Mock rows, no DB — matching src/tests/lib/absence-stats.test.ts. Only the fields the model
// reads are meaningful; the rest satisfy the row types.

const emp = (id: string, over: Partial<EmployeeListItem> = {}): EmployeeListItem => ({
  id,
  role: "employee",
  first_name: "Jan",
  last_name: id,
  deleted_at: null,
  created_at: new Date(2020, 0, 1),
  display_order: 0,
  is_system: false,
  ...over,
});

const VACATION_TYPE_ID = 1;
const TRAINING_TYPE_ID = 2;

const types: AbsenceType[] = [
  {
    id: VACATION_TYPE_ID,
    name: "urlop wypoczynkowy",
    color: "#b4dceb",
    icon: "",
    text_color: "#072143",
    display_order: 1,
  },
  {
    id: TRAINING_TYPE_ID,
    name: ONSITE_TRAINING_TYPE_NAME,
    color: "#c5ac75",
    icon: "",
    text_color: "#000000",
    display_order: 2,
  },
];

let seq = 0;
const absence = (over: Partial<Absence> & Pick<Absence, "employee_id" | "date">): Absence => ({
  id: `abs-${++seq}`,
  absence_type_id: VACATION_TYPE_ID,
  is_full_day: true,
  start_time: null,
  end_time: null,
  comment: null,
  substitute_employee_id: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...over,
});

const build = (over: Partial<Parameters<typeof buildExportWorkbook>[0]> = {}): ExportSheet[] =>
  buildExportWorkbook({
    year: 2026,
    employees: [emp("a"), emp("b")],
    absences: [],
    absenceTypes: types,
    currentEmployeeId: "a",
    ...over,
  });

/** Row 4 is the header; rows 5+ are day rows, so day `d` sits at index `3 + d`. */
const dayRow = (sheet: ExportSheet, day: number) => sheet.rows[3 + day];
/** Column 0 is the date column, so employee column `i` sits at cell index `i + 1`. */
const HEADER_ROW = 3;
const FIRST_DAY_ROW = 4;

describe("monthSheetName", () => {
  it("capitalises the pl-PL month name", () => {
    expect(monthSheetName(2026, 1)).toBe("Styczeń");
    expect(monthSheetName(2026, 12)).toBe("Grudzień");
  });
});

describe("employeeColumnLabel", () => {
  it("is first name then last name", () => {
    expect(employeeColumnLabel(emp("x", { first_name: "Ewa", last_name: "Żółć" }))).toBe("Ewa Żółć");
  });

  it("appends the deactivation suffix the grid header uses", () => {
    expect(employeeColumnLabel(emp("x", { first_name: "Ewa", last_name: "Nowak", deleted_at: new Date() }))).toBe(
      "Ewa Nowak (nieakt.)",
    );
  });
});

describe("employeesForYear", () => {
  it("keeps someone hired mid-year", () => {
    const list = [emp("hired", { created_at: new Date(2026, 5, 15) })];
    expect(employeesForYear(list, 2026).map((e) => e.id)).toEqual(["hired"]);
  });

  it("drops someone hired after the year ends", () => {
    const list = [emp("later", { created_at: new Date(2027, 0, 2) })];
    expect(employeesForYear(list, 2026)).toEqual([]);
  });

  it("keeps someone deactivated mid-year", () => {
    const list = [emp("gone", { deleted_at: new Date(2026, 3, 1) })];
    expect(employeesForYear(list, 2026).map((e) => e.id)).toEqual(["gone"]);
  });

  it("drops someone deactivated before the year starts", () => {
    const list = [emp("old", { deleted_at: new Date(2025, 11, 31) })];
    expect(employeesForYear(list, 2026)).toEqual([]);
  });

  it("accepts the ISO strings island props actually carry", () => {
    // Astro serialises the Date objects into the page HTML, so an island receives strings even
    // though the row type says Date. Comparing them as Date operands would compare codepoints.
    const list = [
      emp("stringy", {
        created_at: "2026-06-15T10:00:00.000Z" as unknown as Date,
        deleted_at: "2026-09-01T10:00:00.000Z" as unknown as Date,
      }),
    ];
    expect(employeesForYear(list, 2026).map((e) => e.id)).toEqual(["stringy"]);
    expect(employeesForYear(list, 2025)).toEqual([]);
    expect(employeesForYear(list, 2027)).toEqual([]);
  });

  it("preserves the incoming order", () => {
    const list = [emp("c"), emp("a"), emp("b")];
    expect(employeesForYear(list, 2026).map((e) => e.id)).toEqual(["c", "a", "b"]);
  });
});

describe("exportYearOptions", () => {
  const thisYear = 2026;

  it("offers next year first, then this year, then backwards", () => {
    const years = exportYearOptions([emp("a")], thisYear);
    expect(years[0]).toBe(thisYear + 1);
    expect(years[1]).toBe(thisYear);
    expect(years).toEqual([...years].sort((x, y) => y - x));
  });

  it("reaches EXPORT_YEARS_BACK years back even when everyone was hired this year", () => {
    // The bug this replaced: deriving the floor from the earliest created_at made a back-filled
    // year unreachable, because every employee row was created the year the app shipped.
    const years = exportYearOptions([emp("a", { created_at: new Date(thisYear, 5, 1) })], thisYear);
    expect(years).toContain(thisYear - EXPORT_YEARS_BACK);
    expect(years).toHaveLength(EXPORT_YEARS_BACK + 2);
  });

  it("widens past the floor for someone hired earlier still", () => {
    const years = exportYearOptions([emp("old", { created_at: new Date(thisYear - 9, 0, 1) })], thisYear);
    expect(years).toContain(thisYear - 9);
    expect(Math.min(...years)).toBe(thisYear - 9);
  });

  it("never returns a duplicate", () => {
    const years = exportYearOptions([emp("a"), emp("b"), emp("c")], thisYear);
    expect(new Set(years).size).toBe(years.length);
  });

  it("still offers the full range with no employees at all", () => {
    const years = exportYearOptions([], thisYear);
    expect(years).toEqual([2027, 2026, 2025, 2024, 2023, 2022, 2021]);
  });

  it("accepts the ISO strings island props actually carry", () => {
    const years = exportYearOptions(
      [emp("stringy", { created_at: "2019-03-04T10:00:00.000Z" as unknown as Date })],
      thisYear,
    );
    expect(Math.min(...years)).toBe(2019);
  });
});

describe("absenceNote", () => {
  const fullDay = { is_full_day: true, start_time: null, end_time: null, comment: null };

  it("reports a full day as cały dzień", () => {
    expect(absenceNote({ absence: fullDay, typeName: "urlop wypoczynkowy" })).toBe(
      "Typ: urlop wypoczynkowy\nGodziny: cały dzień",
    );
  });

  it("omits Komentarz and Zastępstwo when absent", () => {
    const note = absenceNote({ absence: fullDay, typeName: "urlop wypoczynkowy" });
    expect(note).not.toContain("Komentarz:");
    expect(note).not.toContain("Zastępstwo:");
  });

  it("appends Komentarz and Zastępstwo when present", () => {
    const note = absenceNote({
      absence: { ...fullDay, comment: "wyjazd służbowy" },
      typeName: "urlop wypoczynkowy",
      substituteName: "Ewa Żółć",
    });
    expect(note.split("\n")).toEqual([
      "Typ: urlop wypoczynkowy",
      "Godziny: cały dzień",
      "Komentarz: wyjazd służbowy",
      "Zastępstwo: Ewa Żółć",
    ]);
  });

  it("reports stored hours ungated — even on a type that forbids partial days", () => {
    // Deliberately rawTimeRange, not cellTimeRange: a legacy out-of-contract row must stay
    // visible to a moderator here rather than being silently hidden. Mirrors buildTooltip.
    expect(
      absenceNote({
        absence: { is_full_day: false, start_time: "08:00:00", end_time: "12:00:00", comment: null },
        typeName: "urlop wypoczynkowy",
      }),
    ).toBe("Typ: urlop wypoczynkowy\nGodziny: 08:00–12:00");
  });
});

describe("buildExportWorkbook — sheet structure", () => {
  it("always produces twelve sheets, named Styczeń through Grudzień", () => {
    const sheets = build();
    expect(sheets).toHaveLength(12);
    expect(sheets.map((s) => s.name)).toEqual([
      "Styczeń",
      "Luty",
      "Marzec",
      "Kwiecień",
      "Maj",
      "Czerwiec",
      "Lipiec",
      "Sierpień",
      "Wrzesień",
      "Październik",
      "Listopad",
      "Grudzień",
    ]);
  });

  it("produces twelve sheets even with no absences at all", () => {
    expect(build({ absences: [] })).toHaveLength(12);
  });

  it("freezes the date column and nothing else on every sheet", () => {
    for (const sheet of build()) {
      expect(sheet.freezeRows).toBe(0);
      expect(sheet.freezeColumns).toBe(1);
    }
  });

  it("gives one column width per column, date column first", () => {
    const sheet = build()[0];
    expect(sheet.columnWidths).toHaveLength(3);
  });

  it("titles row 1 with the month and year, bold", () => {
    const sheet = build()[2];
    expect(sheet.rows[0][0]).toMatchObject({ text: "Nieobecności — Marzec 2026", bold: true });
  });

  it("puts every type in the legend row in catalogue order, filled and wrapped", () => {
    const legend = build()[0].rows[1];
    expect(legend).toHaveLength(types.length);
    expect(legend[0]).toMatchObject({
      text: "urlop wypoczynkowy",
      fill: "#b4dceb",
      textColor: "#072143",
      wrap: true,
      border: true,
    });
    expect(legend[1].text).toBe(ONSITE_TRAINING_TYPE_NAME);
  });

  it("leaves row 3 as a spacer", () => {
    expect(build()[0].rows[2]).toEqual([]);
  });

  it("heads the date column Dzień", () => {
    expect(build()[0].rows[HEADER_ROW][0]).toMatchObject({ text: "Dzień", bold: true });
  });

  it("gives every month the same column set so the sheets line up", () => {
    const sheets = build({ employees: [emp("a"), emp("b"), emp("c")] });
    const labels = sheets.map((s) => s.rows[HEADER_ROW].map((c) => c.text));
    for (const l of labels) expect(l).toEqual(labels[0]);
  });

  it("yields 29 day rows for a leap-year February", () => {
    const feb = build({ year: 2024 })[1];
    expect(feb.rows).toHaveLength(4 + 29);
  });

  it("yields 28 day rows for a non-leap February", () => {
    const feb = build({ year: 2026 })[1];
    expect(feb.rows).toHaveLength(4 + 28);
  });
});

describe("buildExportWorkbook — columns", () => {
  it("puts the viewer's own column immediately after the date column", () => {
    const sheet = build({ employees: [emp("a"), emp("b"), emp("c")], currentEmployeeId: "c" })[0];
    const header = sheet.rows[HEADER_ROW];
    expect(header[1].text).toBe("Jan c");
    expect(header.slice(1).map((c) => c.text)).toEqual(["Jan c", "Jan a", "Jan b"]);
  });

  it("gives a mid-year hire a column on every sheet, including months before their start", () => {
    const sheets = build({
      employees: [emp("a"), emp("hired", { created_at: new Date(2026, 8, 1) })],
    });
    for (const sheet of sheets) {
      expect(sheet.rows[HEADER_ROW].map((c) => c.text)).toContain("Jan hired");
    }
    // January — three months before the hire date — still carries the column.
    expect(dayRow(sheets[0], 1)).toHaveLength(3);
  });

  it("keeps a mid-year deactivation as a column, suffixed and on its own header band", () => {
    const sheet = build({
      employees: [emp("a"), emp("gone", { deleted_at: new Date(2026, 4, 1) })],
    })[0];
    const cell = sheet.rows[HEADER_ROW][2];
    expect(cell.text).toBe("Jan gone (nieakt.)");
    expect(cell.fill).toBe("#dcdcdc");
    expect(cell.textColor).toBe("#6f6f6f");
  });

  it("excludes someone who left before the exported year", () => {
    const sheet = build({
      employees: [emp("a"), emp("old", { deleted_at: new Date(2025, 0, 5) })],
    })[0];
    expect(sheet.rows[HEADER_ROW].map((c) => c.text)).not.toContain("Jan old (nieakt.)");
    expect(sheet.rows[HEADER_ROW]).toHaveLength(2);
  });
});

describe("buildExportWorkbook — day rows", () => {
  it("labels the date column with the day number and the pl-PL short weekday", () => {
    const jan = build()[0];
    expect(dayRow(jan, 1).at(0)?.text).toBe("1 czw.");
    expect(dayRow(jan, 5).at(0)?.text).toBe("5 pon.");
  });

  it("shades weekend rows and leaves weekdays white", () => {
    // 2026-01-03 is a Saturday, 2026-01-04 a Sunday, 2026-01-05 a Monday.
    const jan = build()[0];
    for (const cell of dayRow(jan, 3)) expect(cell.fill).toBe("#f4f4f4");
    for (const cell of dayRow(jan, 4)) expect(cell.fill).toBe("#f4f4f4");
    for (const cell of dayRow(jan, 5)) expect(cell.fill).toBe("#ffffff");
  });

  it("borders every day cell, absence or not", () => {
    const sheet = build({ absences: [absence({ employee_id: "a", date: "2026-03-10" })] })[2];
    for (const row of sheet.rows.slice(FIRST_DAY_ROW)) {
      for (const cell of row) expect(cell.border).toBe(true);
    }
  });

  it("borders the legend and header rows but not the title", () => {
    const sheet = build()[0];
    for (const cell of sheet.rows[1]) expect(cell.border).toBe(true);
    for (const cell of sheet.rows[HEADER_ROW]) expect(cell.border).toBe(true);
    expect(sheet.rows[0][0].border).toBeUndefined();
  });

  it("starts the day rows at row 5", () => {
    expect(build()[0].rows[FIRST_DAY_ROW][0].text).toBe("1 czw.");
  });

  it("leaves a day with no absence empty and carrying no note", () => {
    const cell = dayRow(build()[0], 5)[1];
    expect(cell.text).toBe("");
    expect(cell.note).toBeUndefined();
  });
});

describe("buildExportWorkbook — absence cells", () => {
  it("renders a full-day absence as `cały dzień` with a fill and a note", () => {
    const sheet = build({ absences: [absence({ employee_id: "a", date: "2026-03-10" })] })[2];
    const cell = dayRow(sheet, 10)[1];
    expect(cell.text).toBe(FULL_DAY_LABEL);
    expect(cell.fill).toBe("#b4dceb");
    expect(cell.textColor).toBe("#072143");
    expect(cell.note).toBe("Typ: urlop wypoczynkowy\nGodziny: cały dzień");
  });

  it("overrides the weekend shade with the type colour", () => {
    const sheet = build({ absences: [absence({ employee_id: "a", date: "2026-01-03" })] })[0];
    expect(dayRow(sheet, 3)[1].fill).toBe("#b4dceb");
    // The date cell on that row keeps the weekend shade.
    expect(dayRow(sheet, 3)[0].fill).toBe("#f4f4f4");
  });

  it("places the absence on the right employee column and only there", () => {
    const sheet = build({ absences: [absence({ employee_id: "b", date: "2026-03-10" })] })[2];
    expect(dayRow(sheet, 10)[1].note).toBeUndefined();
    expect(dayRow(sheet, 10)[2].note).toBeDefined();
  });

  it("buckets absences into the month their stored date names", () => {
    const sheets = build({ absences: [absence({ employee_id: "a", date: "2026-12-31" })] });
    expect(dayRow(sheets[11], 31)[1].note).toBeDefined();
    expect(dayRow(sheets[10], 30)[1].note).toBeUndefined();
  });

  it("ignores an absence from another year", () => {
    const sheets = build({ absences: [absence({ employee_id: "a", date: "2025-03-10" })] });
    expect(dayRow(sheets[2], 10)[1].note).toBeUndefined();
  });

  it("renders a partial day on a whitelisted type as HH:MM–HH:MM", () => {
    const sheet = build({
      absences: [
        absence({
          employee_id: "a",
          date: "2026-03-10",
          absence_type_id: TRAINING_TYPE_ID,
          is_full_day: false,
          start_time: "08:00:00",
          end_time: "12:00:00",
        }),
      ],
    })[2];
    const text = dayRow(sheet, 10)[1].text;
    expect(text).toBe("08:00–12:00");
    // Pinned by codepoint, as src/tests/lib/absence-grid-cell.test.ts does — neither a hyphen
    // nor surrounding spaces may drift back in.
    expect(text).toContain("–");
    expect(text).not.toContain("-");
    expect(text).not.toContain(" ");
  });

  it("reads a partial day on a non-whitelisted type as a full day while the note keeps the hours", () => {
    const sheet = build({
      absences: [
        absence({
          employee_id: "a",
          date: "2026-03-10",
          absence_type_id: VACATION_TYPE_ID,
          is_full_day: false,
          start_time: "08:00:00",
          end_time: "12:00:00",
        }),
      ],
    })[2];
    const cell = dayRow(sheet, 10)[1];
    expect(cell.text).toBe(FULL_DAY_LABEL);
    expect(cell.note).toBe("Typ: urlop wypoczynkowy\nGodziny: 08:00–12:00");
  });

  it("names the substitute in the note, even one who is not a column this year", () => {
    const sheet = build({
      employees: [emp("a"), emp("sub", { first_name: "Ewa", last_name: "Żółć", deleted_at: new Date(2024, 0, 1) })],
      absences: [absence({ employee_id: "a", date: "2026-03-10", substitute_employee_id: "sub" })],
    })[2];
    expect(sheet.rows[HEADER_ROW]).toHaveLength(2);
    expect(dayRow(sheet, 10)[1].note).toContain("Zastępstwo: Ewa Żółć");
  });

  it("reads a gated partial day as its hours, never as cały dzień", () => {
    const sheet = build({
      absences: [
        absence({
          employee_id: "a",
          date: "2026-03-10",
          absence_type_id: TRAINING_TYPE_ID,
          is_full_day: false,
          start_time: "08:00:00",
          end_time: "12:00:00",
        }),
      ],
    })[2];
    expect(dayRow(sheet, 10)[1].text).not.toBe(FULL_DAY_LABEL);
  });

  it("carries the comment into the note", () => {
    const sheet = build({
      absences: [absence({ employee_id: "a", date: "2026-03-10", comment: "zjazd rodzinny" })],
    })[2];
    expect(dayRow(sheet, 10)[1].note).toContain("Komentarz: zjazd rodzinny");
  });

  it("also puts the comment in the cell, on its own line under the time text", () => {
    // A note is invisible until pointed at; the cell is not. Both carry it.
    const sheet = build({
      absences: [absence({ employee_id: "a", date: "2026-03-10", comment: "zjazd rodzinny" })],
    })[2];
    const cell = dayRow(sheet, 10)[1];
    expect(cell.text).toBe(`${FULL_DAY_LABEL}\nzjazd rodzinny`);
    expect(cell.wrap).toBe(true);
  });

  it("puts the comment under the hours on a gated partial day", () => {
    const sheet = build({
      absences: [
        absence({
          employee_id: "a",
          date: "2026-03-10",
          absence_type_id: TRAINING_TYPE_ID,
          is_full_day: false,
          start_time: "08:00:00",
          end_time: "12:00:00",
          comment: "u klienta",
        }),
      ],
    })[2];
    expect(dayRow(sheet, 10)[1].text).toBe("08:00–12:00\nu klienta");
  });

  it("leaves a comment-less absence cell unwrapped and single-line", () => {
    const sheet = build({ absences: [absence({ employee_id: "a", date: "2026-03-10" })] })[2];
    const cell = dayRow(sheet, 10)[1];
    expect(cell.text).toBe(FULL_DAY_LABEL);
    expect(cell.text).not.toContain("\n");
    expect(cell.wrap).toBeUndefined();
  });

  it("falls back to an empty, note-less cell when the type is not in the catalogue", () => {
    const sheet = build({ absences: [absence({ employee_id: "a", date: "2026-03-10", absence_type_id: 99 })] })[2];
    const cell = dayRow(sheet, 10)[1];
    expect(cell.text).toBe("");
    expect(cell.note).toBeUndefined();
    expect(cell.fill).toBe("#ffffff");
  });
});
