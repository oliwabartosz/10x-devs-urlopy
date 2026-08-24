// The XLSX export's content model: a year of absence data turned into a writer-agnostic
// description of twelve sheets.
//
// Everything that can be *wrong* about the exported file — which employees are columns, which
// rows are weekends, which cell gets which fill, what a hover note says — is decided here, in
// pure functions, so it is covered by unit tests rather than eyeballed in a spreadsheet. The
// module that knows a writer library exists (src/lib/export-xlsx.ts) consumes `ExportSheet[]`
// and nothing else; swapping writers rewrites that adapter, not this file.
//
// Dependency-free on purpose: safe to import from both React islands and server routes.
import type { Absence, AbsenceType, EmployeeListItem } from "@/types";
import { cellTimeRange, rawTimeRange } from "@/lib/absence-grid-cell";
import { selfFirst } from "@/lib/employee-order";

/** Header band behind `Dzień` and every active employee column. */
const HEADER_FILL = "#e8e8e8";
/** Header band for a deactivated employee — matches the grid's own `bg-[#dcdcdc]`. */
const INACTIVE_HEADER_FILL = "#dcdcdc";
const INACTIVE_HEADER_TEXT = "#6f6f6f";
const WEEKEND_FILL = "#f4f4f4";
const WEEKDAY_FILL = "#ffffff";

// Only the date column is pinned. Freezing rows is top-anchored, so pinning the header row
// necessarily pins the title and legend above it too, and a reader scrolling a 31-day month
// judged that band more costly than the header it buys.
const FREEZE_ROWS = 0;
/** The date column. */
const FREEZE_COLUMNS = 1;

const DATE_COLUMN_WIDTH = 12;
const EMPLOYEE_COLUMN_WIDTH = 16;

/** The literal suffix the grid's own header builds for a deactivated colleague. */
const INACTIVE_SUFFIX = " (nieakt.)";

/** What an absence cell reads when it has no time range to show. */
export const FULL_DAY_LABEL = "cały dzień";

export interface ExportCell {
  /** `cały dzień` for a full-day absence; `HH:MM–HH:MM` for a gated partial day. */
  text: string;
  /** `#rrggbb` — type colour, weekend shade, or header band. */
  fill?: string;
  /** `#rrggbb` — straight from `absence_types.text_color`; never computed from the fill. */
  textColor?: string;
  bold?: boolean;
  wrap?: boolean;
  /** Draw a thin dotted black outline on all four sides — the grid's eye-navigation aid. */
  border?: boolean;
  /** `absenceNote()` output — rendered as an Excel hover note. */
  note?: string;
}

export interface ExportSheet {
  /** `Styczeń` … `Grudzień`, pl-PL. */
  name: string;
  columnWidths: number[];
  freezeRows: number;
  freezeColumns: number;
  rows: ExportCell[][];
}

export interface BuildExportWorkbookInput {
  year: number;
  /** `allEmployees` in server order — deactivated rows included. */
  employees: EmployeeListItem[];
  /** The whole calendar year, as returned by `GET /api/absences?year=`. */
  absences: Absence[];
  absenceTypes: AbsenceType[];
  currentEmployeeId: string;
}

const monthFmt = new Intl.DateTimeFormat("pl-PL", { month: "long" });
const weekdayFmt = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });

// `created_at` / `deleted_at` arrive as ISO **strings** in island props — Astro serialises the
// Date objects on their way into the page HTML — even though the row type says `Date`. Relying
// on `Date` operands would therefore compare strings by codepoint at runtime. Construct
// explicitly instead.
function asDate(value: Date | string): Date {
  return new Date(value);
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** `Styczeń`, `Luty`, … — pl-PL month names are lower-case, a sheet tab reads better capitalised. */
export function monthSheetName(year: number, month: number): string {
  const name = monthFmt.format(new Date(year, month - 1, 1));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The employee columns for a whole year: everyone who existed at any point during it.
 *
 * Mirrors the per-month membership rule at `dashboard.astro` widened to a year window, so the
 * same column set serves all twelve sheets and the months line up. Input order is preserved;
 * `selfFirst` is the caller's job, not this function's.
 */
export function employeesForYear(employees: EmployeeListItem[], year: number): EmployeeListItem[] {
  const yearStart = new Date(year, 0, 1);
  const nextYearStart = new Date(year + 1, 0, 1);
  return employees.filter(
    (e) => asDate(e.created_at) < nextYearStart && (e.deleted_at === null || asDate(e.deleted_at) >= yearStart),
  );
}

/**
 * The header label for an employee column — the same string `SortableEmployeeHeader` builds, so
 * a deactivated colleague is as recognisable in the file as on screen.
 */
export function employeeColumnLabel(emp: EmployeeListItem): string {
  return `${emp.first_name} ${emp.last_name}${emp.deleted_at ? INACTIVE_SUFFIX : ""}`;
}

/**
 * The Excel hover note for an absence cell: the in-app tooltip minus the two lines the
 * spreadsheet already carries positionally (the employee is the column, the date is the row).
 *
 * Uses `rawTimeRange`, deliberately **not** `cellTimeRange` — exactly as `buildTooltip` does. A
 * legacy row carrying hours on a type the product forbids partial days on renders as a plain
 * coloured cell, while this line still reports the hours actually stored, so such a row stays
 * visible to a moderator instead of being silently hidden.
 */
export function absenceNote(input: {
  absence: Pick<Absence, "is_full_day" | "start_time" | "end_time" | "comment">;
  typeName: string;
  substituteName?: string;
}): string {
  const range = rawTimeRange(input.absence);
  const lines = [`Typ: ${input.typeName}`, `Godziny: ${range || "cały dzień"}`];
  if (input.absence.comment) lines.push(`Komentarz: ${input.absence.comment}`);
  if (input.substituteName) lines.push(`Zastępstwo: ${input.substituteName}`);
  return lines.join("\n");
}

/**
 * A year of data as twelve sheet descriptions — always twelve, regardless of content, so an
 * empty month is a legend-only tab rather than a missing one.
 */
export function buildExportWorkbook(input: BuildExportWorkbookInput): ExportSheet[] {
  const { year, employees, absences, absenceTypes, currentEmployeeId } = input;

  const columns = selfFirst(employeesForYear(employees, year), currentEmployeeId);
  const typeById = new Map(absenceTypes.map((t) => [t.id, t]));
  // Built over the full input list, not the column set: a substitute may be someone this year's
  // columns do not include, and the note should still name them.
  const employeeNameById = new Map(employees.map((e) => [e.id, `${e.first_name} ${e.last_name}`]));

  // Keyed on the stored `YYYY-MM-DD` string. `absences.date` is a Postgres `date` and arrives as
  // that string, so the lookup key is built from year/month/day arithmetic and never from
  // `toISOString()` — Warsaw is UTC+1/+2, where that reports the previous day.
  const byEmployeeAndDate = new Map<string, Absence>();
  for (const a of absences) {
    byEmployeeAndDate.set(`${a.employee_id}|${a.date}`, a);
  }

  const columnWidths = [DATE_COLUMN_WIDTH, ...columns.map(() => EMPLOYEE_COLUMN_WIDTH)];

  const sheets: ExportSheet[] = [];
  for (let month = 1; month <= 12; month++) {
    const rows: ExportCell[][] = [];

    // Row 1 — title.
    rows.push([{ text: `Nieobecności — ${monthSheetName(year, month)} ${year}`, bold: true }]);

    // Row 2 — the legend, one wrapped colour-filled cell per type in catalogue order. One row
    // rather than seven stacked ones: freezing is top-anchored, so every legend row it takes
    // comes straight out of the visible day rows below.
    rows.push(
      absenceTypes.map((t) => ({
        text: t.name,
        fill: t.color,
        textColor: t.text_color,
        wrap: true,
        border: true,
      })),
    );

    // Row 3 — spacer.
    rows.push([]);

    // Row 4 — header.
    rows.push([
      { text: "Dzień", fill: HEADER_FILL, bold: true, border: true },
      ...columns.map((emp) => ({
        text: employeeColumnLabel(emp),
        fill: emp.deleted_at ? INACTIVE_HEADER_FILL : HEADER_FILL,
        textColor: emp.deleted_at ? INACTIVE_HEADER_TEXT : undefined,
        bold: true,
        wrap: true,
        border: true,
      })),
    ]);

    // Rows 5+ — one per day of the month. `new Date(year, month, 0)` is the last day of `month`.
    const dayCount = new Date(year, month, 0).getDate();
    for (let day = 1; day <= dayCount; day++) {
      const date = new Date(year, month - 1, day);
      const weekday = date.getDay();
      const rowFill = weekday === 0 || weekday === 6 ? WEEKEND_FILL : WEEKDAY_FILL;
      const dateKey = `${year}-${pad2(month)}-${pad2(day)}`;

      const row: ExportCell[] = [{ text: `${day} ${weekdayFmt.format(date)}`, fill: rowFill, border: true }];

      for (const emp of columns) {
        const absence = byEmployeeAndDate.get(`${emp.id}|${dateKey}`);
        const type = absence ? typeById.get(absence.absence_type_id) : undefined;
        if (!absence || !type) {
          row.push({ text: "", fill: rowFill, border: true });
          continue;
        }
        const substituteName = absence.substitute_employee_id
          ? employeeNameById.get(absence.substitute_employee_id)
          : undefined;
        // Gated, matching what the screen shows: an out-of-contract row carrying hours on a
        // type the product forbids partial days on reads as a full day here, exactly as it
        // renders on the grid. The note below stays ungated and still reports those hours.
        const timeText = cellTimeRange(absence, type.name) || FULL_DAY_LABEL;
        row.push({
          // The comment goes in the cell as well as in the note, on its own line, so it is
          // readable without hovering — a note is invisible until pointed at, and on a printed
          // or scrolled sheet it may as well not exist.
          text: absence.comment ? `${timeText}\n${absence.comment}` : timeText,
          fill: type.color,
          textColor: type.text_color,
          border: true,
          // Only when there is a second line to wrap: an unwrapped one-liner keeps its row at
          // the default height.
          wrap: absence.comment ? true : undefined,
          note: absenceNote({ absence, typeName: type.name, substituteName }),
        });
      }

      rows.push(row);
    }

    sheets.push({
      name: monthSheetName(year, month),
      columnWidths,
      freezeRows: FREEZE_ROWS,
      freezeColumns: FREEZE_COLUMNS,
      rows,
    });
  }

  return sheets;
}
