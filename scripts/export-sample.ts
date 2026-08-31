/**
 * Dev-only harness: produce a sample XLSX from fixture data, without running the app.
 *
 * The point is that the *format* — fills, notes, freeze panes, Polish tab names, diacritics —
 * is verifiable in Excel and LibreOffice before any UI exists, and re-verifiable later without
 * clicking through the dashboard. The fixture year deliberately exercises every case the
 * Phase 1 unit tests cover: a full-day absence, a gated partial day, a partial day on a type
 * that forbids them, a comment, a substitute, an employee deactivated mid-year, and one hired
 * mid-year.
 *
 * Runs under `tsx` rather than plain node — like `scripts/seed-admin.ts` and
 * `scripts/team-digest.ts` — because it imports the `@/`-aliased source modules directly. There
 * is no DB and no env: the fixtures are inline and the modules are pure.
 *
 * Not wired into CI.
 *
 * Usage: `npm run sample:xlsx [output-path]`
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Absence, AbsenceType, EmployeeListItem } from "@/types";
import { buildExportWorkbook } from "@/lib/export-workbook";
import { writeWorkbook } from "@/lib/export-xlsx";

const YEAR = 2026;
const DEFAULT_OUT = ".scratch/nieobecnosci-sample.xlsx";

// The live palette, copied from 20260807122840_faulty_hobgoblin.sql so the colours in the sample
// are the ones a moderator actually sees. A fresh environment carries the superseded 2026-05
// palette — that migration is hand-authored and absent from _journal.json — so comparing this
// file against such a database will disagree on colour and be right to.
const absenceTypes: AbsenceType[] = [
  { id: 1, name: "urlop", color: "#cceeff", text_color: "#0b5a72", icon: "🌴", display_order: 1 },
  {
    id: 2,
    name: "szkolenie/wyjście poza miejsce pracy",
    color: "#ffcc99",
    text_color: "#8a4a00",
    icon: "🏃🏼‍♂️‍➡️",
    display_order: 2,
  },
  { id: 3, name: "szkolenie w miejscu pracy", color: "#ffe8a8", text_color: "#7a5b00", icon: "🎓", display_order: 3 },
  { id: 4, name: "choroba", color: "#2f578c", text_color: "#ffffff", icon: "🤒", display_order: 4 },
  { id: 5, name: "wyjazd zagraniczny", color: "#f2a3a3", text_color: "#7d0d1c", icon: "🌍", display_order: 5 },
  { id: 6, name: "stała nieobecność", color: "#ccffcc", text_color: "#2c5c2c", icon: "🚫", display_order: 6 },
  { id: 7, name: "urlop planowany", color: "#99ccff", text_color: "#0b3f6b", icon: "📅", display_order: 7 },
];

const employee = (
  id: string,
  first_name: string,
  last_name: string,
  over: Partial<EmployeeListItem> = {},
): EmployeeListItem => ({
  id,
  role: "employee",
  first_name,
  last_name,
  deleted_at: null,
  created_at: new Date(2020, 0, 1),
  display_order: 0,
  is_system: false,
  ...over,
});

const employees: EmployeeListItem[] = [
  employee("e-self", "Zofia", "Wiśniewska", { role: "moderator" }),
  employee("e-long", "Krzysztof", "Brzęczyszczykiewicz"),
  // Hired in September — must still hold a column on all twelve sheets.
  employee("e-hired", "Łukasz", "Żółkiewski", { created_at: new Date(YEAR, 8, 1) }),
  // Deactivated in May — column kept, header suffixed " (nieakt.)" on its own band.
  employee("e-gone", "Agnieszka", "Ćwiek", { deleted_at: new Date(YEAR, 4, 15) }),
];

let seq = 0;
const absence = (over: Partial<Absence> & Pick<Absence, "employee_id" | "date">): Absence => ({
  id: `abs-${++seq}`,
  absence_type_id: 1,
  is_full_day: true,
  start_time: null,
  end_time: null,
  comment: null,
  is_priority: false,
  substitute_employee_id: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...over,
});

const absences: Absence[] = [
  // A plain full-day absence: empty cell, fill, note reading "cały dzień".
  absence({ employee_id: "e-self", date: `${YEAR}-01-08` }),
  // A run of full days spanning a weekend, so the weekend shading is visible beside a fill.
  absence({ employee_id: "e-long", date: `${YEAR}-01-16` }),
  absence({ employee_id: "e-long", date: `${YEAR}-01-17` }),
  absence({ employee_id: "e-long", date: `${YEAR}-01-19` }),
  // A gated partial day on a whitelisted type: the cell shows 08:00–12:00.
  absence({
    employee_id: "e-self",
    date: `${YEAR}-03-10`,
    absence_type_id: 3,
    is_full_day: false,
    start_time: "08:00:00",
    end_time: "12:00:00",
  }),
  // The other whitelisted type, with a comment carrying diacritics.
  absence({
    employee_id: "e-long",
    date: `${YEAR}-03-11`,
    absence_type_id: 2,
    is_full_day: false,
    start_time: "13:30:00",
    end_time: "16:45:00",
    comment: "Wyjście do klienta — Ćmielów, Żółkiewskiego 12",
  }),
  // A substitute: the note gains a "Zastępstwo:" line.
  absence({
    employee_id: "e-self",
    date: `${YEAR}-04-20`,
    absence_type_id: 4,
    comment: "Zwolnienie lekarskie",
    substitute_employee_id: "e-long",
  }),
  // An out-of-contract legacy row: hours stored on a type that forbids partial days. The cell
  // must stay textless while the note still reports 09:00–11:00.
  absence({
    employee_id: "e-long",
    date: `${YEAR}-04-21`,
    absence_type_id: 1,
    is_full_day: false,
    start_time: "09:00:00",
    end_time: "11:00:00",
  }),
  // Before the deactivation, so the kept column has content to show.
  absence({ employee_id: "e-gone", date: `${YEAR}-05-04`, absence_type_id: 6 }),
  // After the hire date.
  absence({ employee_id: "e-hired", date: `${YEAR}-09-14`, absence_type_id: 5 }),
  // Next-year planning lands in December of this one too, so every colour appears somewhere.
  absence({ employee_id: "e-self", date: `${YEAR}-12-28`, absence_type_id: 7 }),
  absence({ employee_id: "e-long", date: `${YEAR}-12-29`, absence_type_id: 7 }),
];

const outPath = resolve(process.argv[2] ?? DEFAULT_OUT);

const sheets = buildExportWorkbook({
  year: YEAR,
  employees,
  absences,
  absenceTypes,
  currentEmployeeId: "e-self",
});

const bytes = await writeWorkbook(sheets);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, bytes);

/* eslint-disable no-console -- a dev harness's whole output is this line */
console.log(`${outPath} — ${sheets.length} sheets, ${(bytes.byteLength / 1024).toFixed(1)} KiB`);
