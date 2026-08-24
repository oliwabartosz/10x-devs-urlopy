# Moderator XLSX Export of the Yearly Absence Grid — Implementation Plan

## Overview

Give a moderator a one-click download of a full calendar year of the absence grid as a single `.xlsx`: twelve sheets (Styczeń … Grudzień), each carrying a colour legend strip above a days-as-rows / employees-as-columns grid. A cell conveys its absence type by **fill colour only** (plus an `HH:MM–HH:MM` string for partial days) and carries the type name, comment and substitute in an **Excel hover note**. The workbook is assembled **in the browser** from data the moderator's dashboard can already fetch.

## Current State Analysis

**What already exists and is reused unchanged:**

- `GET /api/absences?year=YYYY` (`src/pages/api/absences/index.ts:18-104`) already serves a whole calendar year, role-scoped via `absenceEmployeeJoin()`, capped at `LIST_LIMIT` with a truncation probe surfaced as `X-Result-Truncated`. **No new endpoint is needed.**
- For a moderator, `allEmployees` on the dashboard (`src/pages/dashboard.astro:122-133`, assigned `:181`) is the full visible-employee list — including deactivated rows — carrying `created_at`, `deleted_at`, `display_order`, already ordered active-first → `display_order` → `last_name` → `first_name`. That is enough to derive the column set for **any** year with no extra query.
- `absenceTypes` (`dashboard.astro:167`) is the styling catalogue: `color`, `text_color`, `icon`, `display_order`. Colours are data, never code.
- `rawTimeRange()` / `cellTimeRange()` (`src/lib/absence-grid-cell.ts:36-54`) already encode the gated-vs-ungated hours rule and the U+2013 dash.
- `buildTooltip()` (`AbsenceGrid.tsx:204-223`) defines the exact Polish label set the hover note reproduces.

**What does not exist and is built here:**

- Any non-JSON response or file download. Verified repo-wide: zero occurrences of `Content-Disposition`, `Blob`, `Uint8Array`, or a binary content type in `src/`.
- Any year selector. `year` is derived from `?month=YYYY-MM` (`dashboard.astro:29`); navigation is month-at-a-time arrows.
- Any dynamic `import()` or `React.lazy` — every island is `client:load`.
- Any XLSX dependency.

**Key constraint discovered:** the project is on **Workers Free** (10 ms CPU per request). A measured 30-employee *monthly* workbook already costs 10–16 ms of pure CPU, and a year is 12× that. Server-side generation is therefore not viable, which also removes the only path that could not be tested locally (Drizzle cannot reach Supabase under `wrangler dev`).

## Desired End State

A moderator on the dashboard sees an **"Eksport XLSX"** button in the moderator bar. Clicking it opens a dialog with a year dropdown. Choosing a year and confirming downloads `nieobecnosci-<rok>.xlsx`.

Opening that file in Excel or LibreOffice shows twelve tabs. Each tab opens with a legend row of seven colour-filled cells naming every absence type, and below it a grid whose rows are the days of that month and whose columns are the employees. An absence is a coloured cell; a partial-day absence also shows `08:00–12:00`; hovering any absence cell pops a note reading `Typ:` / `Godziny:` / optionally `Komentarz:` and `Zastępstwo:`. Weekend rows are shaded. The legend and header rows and the date column stay frozen while scrolling.

**Verification:** generate a year containing at least one full-day absence, one partial-day absence, one absence with a comment, one with a substitute, one belonging to a deactivated employee, and one in a month where a colleague was not yet hired — then open the file in both Excel and LibreOffice and confirm every one of those renders as described.

### Key Discoveries:

- `GET /api/absences?year=` already exists and is role-scoped — the export adds **no new access boundary**, so it does not land on `context/foundation/test-plan.md:49` Risk #4 as feared. The moderator-only-ness is UI gating over data the caller could already request.
- **hucre supports everything needed, verified by execution** (not by documentation): solid fills with indices correctly starting at 2, cell comments emitting `xl/comments1.xml` **plus** the legacy `xl/drawings/vmlDrawing1.vml` and per-sheet rels that Excel requires, freeze panes, column widths, and Polish diacritics intact. Its `writeXlsx` path bundles to **39 KiB gzip** tree-shaken (vs 250 KiB for `exceljs`'s prebuilt browser bundle), with **zero dependencies**.
- **`write-excel-file` is disqualified**: it has no cell-note property at all. Its cell object is `value`/`format`/`backgroundColor`/`textColor`/font/align/wrap/borders/spans only.
- The grid's on-screen employee order is `selfFirst(server order)` (`AbsenceGrid.tsx:49-53`, `:97-99`). Drag-reordering persists to `display_order` server-side, so `selfFirst(allEmployees)` reproduces what the moderator sees on any subsequent load.
- Absence types have **no stable slug** — `absence_types.name` is both key and Polish display label (`src/db/schema.ts:31-43`). Read the catalogue; never hardcode.
- `UNIQUE (employee_id, date)` (`src/db/schema.ts:65`) makes overlap structurally impossible: one cell, at most one absence. No split-cell or priority rule to port.
- Dates are built as `new Date(y, m-1, d)`, never parsed from ISO — Warsaw is UTC+1/+2 and `toISOString()` reports the previous day (`src/lib/absence-range.ts:14-27`).

## What We're NOT Doing

- **No server-side generation and no new API route.** Ruled out by the 10 ms Free-tier CPU budget.
- **No emoji or type name in the cell.** Type identity is carried by fill colour, decoded via the legend. (Icons remain available to a later revision; the catalogue already supplies them.)
- **The export ignores the Details-tab type filter** (`src/lib/type-filter.ts`) and always includes all seven types. That filter is scoped to the Details tab, the export control does not live there, and a "download the whole grid" action that silently omitted types would be a data-integrity trap.
- **No public-holiday marking.** No table, column, migration or library for it exists anywhere; the only non-working-day concept in this codebase is *weekend*. Adding it is new semantics, not a port.
- **No yearly summary or statistics sheet.** Twelve month sheets plus the per-sheet legend, nothing more.
- **No CSV, ODS or PDF export.**
- **No export for regular employees.** Moderator-only.
- **No global `?year=` dashboard param.** Year selection lives inside the export dialog only.
- **No change to `AbsenceGrid`'s rendering.** Phase 1 extracts `selfFirst` to a shared module; behaviour is identical.

## Implementation Approach

Correctness is concentrated in a **pure, dependency-free model builder** in `src/lib/`, which is the repo's established test seam (vitest runs `environment: "node"` with no jsdom, so React islands are untestable by design — this is why `absence-stats.ts`, `absence-range.ts` and `absence-grid-cell.ts` exist). `buildExportWorkbook()` takes plain data and returns a plain sheet-description model: no hucre types, no binary, no DOM. Every rule that can be wrong — which employees are columns, which rows are weekends, which cell gets which fill, what the note says — is unit-tested there.

hucre is then confined to a **thin adapter** that maps that model onto `writeXlsx`. This is the mitigation for hucre's single-vendor / bus-factor-1 risk: swapping writers means rewriting one adapter, not the feature.

The writer is loaded with a **dynamic `import()` on click** — the first in this repo — so the 39 KiB reaches only moderators who actually export.

## Critical Implementation Details

**hucre's freeze-pane property is `freezePane`, not `freeze`.** Passing the wrong key is a *silent no-op*: the file still generates, and `<sheetView>` is simply emitted without a `<pane>` element. Verified both ways during research. Assert on the generated XML, not on the absence of an error.

**Freezing rows is top-anchored only**, so pinning the grid's header row necessarily pins everything above it. This is why the legend is specified as **one row of seven colour-filled cells with wrapped text** rather than seven stacked rows — it keeps the frozen band at 4 rows instead of 10, so a 31-day month still scrolls usefully.

**hucre's `fgColor` takes `{ rgb: "RRGGBB" }` without the leading `#`**, and emits it as `FFRRGGBB`. The catalogue stores `#rrggbb`, so the adapter strips the `#`.

**A cell may be empty and still carry both a fill and a note.** Full-day absences produce exactly that — verified working: a cell with `value: ""` plus a `comment` emitted a correct `commentList` entry.

## Phase 1: Workbook Model (pure)

### Overview

Everything that can be wrong about the exported content, expressed as pure functions in `src/lib/` and covered by unit tests. No dependency, no binary, no UI.

### Changes Required:

#### 1. Shared employee ordering

**File**: `src/lib/employee-order.ts` (new)

**Intent**: Move `selfFirst` out of `AbsenceGrid.tsx` so the export and the grid provably apply the same viewer-relative column order, and so it becomes testable.

**Contract**: `selfFirst(emps: EmployeeListItem[], currentId: string): EmployeeListItem[]` — identical semantics to `AbsenceGrid.tsx:49-53` (hoist the viewer's row to index 0; return the others unchanged if absent). Dependency-free, importable from islands and routes alike.

#### 2. Grid consumes the shared helper

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Delete the local `selfFirst` and import the shared one. Pure refactor — no behaviour change.

**Contract**: The `useState` initialiser at `:97-99` keeps calling `selfFirst(employees, currentEmployee.id)`.

#### 3. Year column set

**File**: `src/lib/export-workbook.ts` (new)

**Intent**: Derive the stable employee column set for a year: everyone who existed at any point during it, used identically on all twelve sheets so months line up.

**Contract**: `employeesForYear(employees: EmployeeListItem[], year: number): EmployeeListItem[]` — keeps an employee when `created_at < (year+1)-01-01` **and** (`deleted_at === null` **or** `deleted_at >= year-01-01`). Mirrors the per-month rule at `dashboard.astro:175-182` widened to a year window. Input order is preserved; `selfFirst` is applied by the caller, not here.

Note that `created_at` / `deleted_at` arrive as **strings** in island props (Astro serialises the `Date` objects), so the comparison must construct dates explicitly rather than relying on `Date` operands.

#### 4. Column labels

**File**: `src/lib/export-workbook.ts`

**Intent**: Produce the header label for an employee column, matching the grid's own convention so a deactivated colleague is recognisable in the file.

**Contract**: `employeeColumnLabel(emp: EmployeeListItem): string` → `"<first> <last>"`, with the literal suffix `" (nieakt.)"` when `deleted_at` is set. Same string `SortableEmployeeHeader` builds at `AbsenceGrid.tsx:58,67`.

#### 5. Hover-note text

**File**: `src/lib/export-workbook.ts`

**Intent**: Build the Excel note for an absence cell, reproducing the in-app tooltip minus the two lines the spreadsheet already shows positionally (employee is the column, date is the row).

**Contract**: `absenceNote({ absence, typeName, substituteName }): string` — newline-joined: `Typ: <name>`, `Godziny: <range || "cały dzień">`, then `Komentarz: <text>` and `Zastępstwo: <name>` only when present. Uses **`rawTimeRange`, not `cellTimeRange`** — deliberately ungated, exactly as `buildTooltip` does, so a legacy out-of-contract row stays visible to a moderator rather than being silently hidden (see the comment at `AbsenceGrid.tsx:207-211` and `absence-grid-cell.ts:12-16`).

#### 6. The sheet model

**File**: `src/lib/export-workbook.ts`

**Intent**: The single function that turns a year of data into a writer-agnostic description of twelve sheets. This is the contract the Phase 2 adapter consumes and the whole of what Phase 1 tests.

**Contract**:

```ts
export interface ExportCell {
  text: string;                 // "" for a full-day absence; HH:MM–HH:MM for a gated partial day
  fill?: string;                // "#rrggbb" — type colour, weekend shade, or header band
  textColor?: string;           // "#rrggbb" — from absence_types.text_color; never computed
  bold?: boolean;
  wrap?: boolean;
  note?: string;                // absenceNote() output
}

export interface ExportSheet {
  name: string;                 // "Styczeń" … "Grudzień", pl-PL
  columnWidths: number[];
  freezeRows: number;           // 4 — title, legend, spacer, header
  freezeColumns: number;        // 1 — the date column
  rows: ExportCell[][];
}

export function buildExportWorkbook(input: {
  year: number;
  employees: EmployeeListItem[];   // allEmployees, server order
  absences: Absence[];             // the whole year, from GET /api/absences?year=
  absenceTypes: AbsenceType[];
  currentEmployeeId: string;
}): ExportSheet[];                 // always exactly 12
```

Row layout per sheet, fixed:

| Row | Content |
| --- | --- |
| 1 | Title `Nieobecności — <Miesiąc> <rok>`, bold |
| 2 | Legend: seven cells in `display_order`, each filled with `type.color`, text `type.text_color`, value = `type.name`, wrapped |
| 3 | Spacer |
| 4 | Header: `Dzień` + one cell per employee column, on the `#e8e8e8` band (`#dcdcdc` with `#6f6f6f` text for a deactivated employee), bold |
| 5+ | One row per day of the month |

Day-row rules, each a test case:

- Date cell reads `<d> <ddd>` in `pl-PL` (e.g. `1 pon`), built with `new Date(year, month-1, d)` — **never** parsed from an ISO string.
- Weekend rows (`getDay() === 0 || === 6`) take fill `#f4f4f4`; weekdays `#ffffff`.
- A cell with an absence takes `fill = type.color`, `textColor = type.text_color`, `text = cellTimeRange(absence, type.name)` (gated — matching what the screen shows), and `note = absenceNote(...)`.
- A cell without an absence keeps its row background and carries no note.
- Columns are `selfFirst(employeesForYear(employees, year), currentEmployeeId)`.
- Sheets are produced for all twelve months regardless of content; bucketing is on `date.slice(5, 7)`.

#### 7. Unit tests

**File**: `src/tests/lib/export-workbook.test.ts` (new), `src/tests/lib/employee-order.test.ts` (new)

**Intent**: Cover every rule above. No database, no `describe.skipIf` — these are pure functions and must run in every CI invocation.

**Contract**: at minimum — always twelve sheets; a mid-year hire is present as a column in *every* month including those before their start; a mid-year deactivation keeps the column and the `" (nieakt.)"` suffix; `selfFirst` puts the viewer at column index 1 (index 0 is the date column); weekend shading on a known date; a full-day absence yields `text === ""` with a fill and a note; a partial-day absence on a whitelisted type yields the `HH:MM–HH:MM` string with the **U+2013** dash pinned by codepoint (as `src/tests/lib/absence-grid-cell.test.ts:91-99` does); a partial-day absence on a **non**-whitelisted type yields `text === ""` while its note still reports the stored hours; notes omit `Komentarz:` / `Zastępstwo:` when absent; a leap-year February yields 29 day rows.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Unit tests pass with **zero skipped**: `npx vitest run src/tests/lib/export-workbook.test.ts src/tests/lib/employee-order.test.ts`
- Full suite still green: `npx vitest run`
- No new dependency yet: `git diff package.json` is empty

#### Manual Verification:

- The grid renders and drag-reorders exactly as before the `selfFirst` extraction

---

## Phase 2: Writer Adapter and Download

### Overview

Add hucre, map the Phase 1 model onto it, and produce a downloadable file. The gate for this phase is a real workbook opening cleanly in real spreadsheet software.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Add `hucre` as the XLSX writer.

**Contract**: `hucre@^1.1.0`, imported only via its `hucre/xlsx` subpath so tree-shaking keeps the reader, XLS/XLSB parsers, CSV, ODS and chart code out of the bundle. Measured tree-shaken cost of the `writeXlsx` path: 131 KB raw / **39 KiB gzip**, zero transitive dependencies.

#### 2. Writer adapter

**File**: `src/lib/export-xlsx.ts` (new)

**Intent**: The only module in the codebase that knows hucre exists. Maps `ExportSheet[]` to hucre's write model and returns bytes.

**Contract**: `writeWorkbook(sheets: ExportSheet[]): Promise<Uint8Array>`, `import("hucre/xlsx")` dynamically inside the function.

Mapping, all four halves verified working during research:

- fill → `style.fill = { type: "pattern", pattern: "solid", fgColor: { rgb: <hex without "#"> } }`
- `textColor` → `style.font.color.rgb`; `bold` → `style.font.bold`; `wrap` → `style.alignment.wrapText`
- `note` → `cell.comment = { author: "Nieobecności", text }`
- `freezeRows` / `freezeColumns` → the sheet's **`freezePane: { rows, columns }`** — note the property name; `freeze` is silently ignored
- `columnWidths` → `columns: [{ width }, …]`

#### 3. Download trigger

**File**: `src/lib/export-xlsx.ts`

**Intent**: Hand the bytes to the browser as a file.

**Contract**: `downloadWorkbook(bytes: Uint8Array, filename: string): void` — object URL over a `Blob` typed `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, a synthetic anchor click, then `URL.revokeObjectURL` (revoking in a `setTimeout` so Safari does not cancel the download). Filename `nieobecnosci-<rok>.xlsx` — ASCII-only, since non-ASCII in `download` is inconsistently honoured.

#### 4. Generation harness

**File**: `scripts/export-sample.mjs` (new, dev-only)

**Intent**: Produce a sample workbook from fixture data without running the app, so the format is verifiable before any UI exists — and re-verifiable later without clicking through the dashboard.

**Contract**: Builds a fixture year exercising every case from the Phase 1 test list, calls `buildExportWorkbook` then `writeWorkbook`, and writes `nieobecnosci-sample.xlsx` to the repo-ignored scratch path. Not wired into CI.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Full suite green, zero skipped: `npx vitest run`
- Sample generates: `node scripts/export-sample.mjs`
- Generated file contains the required parts — `xl/comments1.xml`, `xl/drawings/vmlDrawing1.vml`, twelve `xl/worksheets/sheetN.xml`, and a `<pane … state="frozen"/>` in sheet 1's `<sheetViews>`
- Production build succeeds and stays within budget: `npm run build`

#### Manual Verification:

- The sample opens in **Microsoft Excel** with no repair prompt; all twelve tabs present and named in Polish
- The sample opens in **LibreOffice Calc** with no warning
- Fill colours match the on-screen palette; Polish diacritics in names, type names and comments are intact
- Hovering an absence cell pops the note with the expected `Typ:` / `Godziny:` / `Komentarz:` / `Zastępstwo:` lines
- Legend, header rows and the date column stay put when scrolling down and right
- Weekend rows are visibly shaded

---

## Phase 3: Moderator Export Dialog

### Overview

The user-facing half: a moderator-only control that picks a year, fetches it, and downloads the file.

### Changes Required:

#### 1. Export island

**File**: `src/components/absence/AbsenceExportDialog.tsx` (new)

**Intent**: The button, the year dropdown and the whole export interaction.

**Contract**: Props `{ employees: EmployeeListItem[]; absenceTypes: AbsenceType[]; currentEmployeeId: string }`. Renders a shadcn `Dialog` triggered by an "Eksport XLSX" button styled to match the existing moderator-bar control.

- Year options run from the earliest `created_at` year across `employees` to **the current year + 1** (planned vacation — `urlop planowany` — is a real type, so next year must be exportable). Default: current year.
- On confirm: `fetch('/api/absences?year=<rok>')`, then `buildExportWorkbook`, `writeWorkbook`, `downloadWorkbook`.
- **Honours `X-Result-Truncated`**: when the header is `"1"`, abort without downloading and show a Polish error stating the year exceeds the row cap. A silently short workbook — a year quietly missing December — is the failure mode `LIST_LIMIT`'s probe exists to prevent (`absence-list.ts:18-21`), and is materially worse in a file than in a JSON list.
- Disabled button plus a progress label while fetching and generating; Polish error text on a non-OK response or a thrown generation error; the dialog stays open on error so the user can retry.
- Follows the lazy-fetch-on-demand precedent at `AbsenceStats.tsx:279-298`, including `AbortController` cleanup on unmount.

#### 2. Dashboard wiring

**File**: `src/pages/dashboard.astro`

**Intent**: Render the island for moderators only, in the existing moderator bar.

**Contract**: Inside the `currentEmployee?.role === "moderator"` block at `:242-249`, beside `EmployeeManagementSheet`, with `client:load`. Passes `allEmployees`, `absenceTypes` and `currentEmployee.id`. Gating stays **server-side**, matching the note at `:191-193` — a non-moderator's browser is never handed the props at all.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Full suite green, zero skipped: `npx vitest run`
- Production build succeeds: `npm run build`
- The writer is genuinely split out — `hucre` appears in its own chunk under `dist/`, not in the dashboard's entry chunk

#### Manual Verification:

- A **moderator** sees the "Eksport XLSX" button; a **regular employee** does not, and the island's props are absent from that user's page source
- Selecting a year and confirming downloads `nieobecnosci-<rok>.xlsx`
- The downloaded file matches the Phase 2 manual checks against **real** data
- Exporting a year with no absences at all yields twelve legend-only sheets rather than an error
- Exporting next year works and contains any `urlop planowany` entries
- Column order matches what the moderator sees on the Siatka tab, including their own column first
- A network failure mid-export shows a Polish error and leaves the dialog open

---

## Phase 4: Foundation Doc Corrections

### Overview

Amend the foundation docs the research falsified, following the S-23 precedent of correcting them alongside the work rather than leaving known-wrong figures in place.

### Changes Required:

#### 1. Worker size limits

**File**: `context/foundation/infrastructure.md`

**Intent**: The document cites a 25 MB compressed bundle limit in three places. That is a Cloudflare **Pages** figure; this project deploys a standalone Worker (`.github/workflows/ci.yml:85`).

**Contract**: Replace the figure at `:69`, `:93` and `:116` with the applicable Worker limits — **3 MB gzip on Free, 10 MB gzip on Paid** — and record the measured current bundle (3303 KiB raw / 681 KiB gzip before this change).

#### 2. Roadmap entry

**File**: `context/foundation/roadmap.md`

**Intent**: The roadmap runs F-01 … S-23 with no export row; the next free ID is S-24.

**Contract**: Add **S-24 — moderator XLSX export of the yearly grid**, noting that `context/archive/2026-05-30-details-and-stats/plan-brief.md:32` deferred export rather than rejecting it.

#### 3. Palette provenance caveat

**File**: `context/changes/export-grid-to-xlsx/change.md`

**Intent**: Record a live trap for anyone verifying the export in a fresh environment.

**Contract**: Note that `20260807122840_faulty_hobgoblin.sql` and `20260812153000_offsite_training_single_codepoint_icon.sql` are hand-authored data migrations deliberately absent from `_journal.json`, so a freshly provisioned environment carries the superseded 2026-05 palette — an export there is faithful to the *wrong* colours. Also note that `context/foundation/prd.md:112` still lists the stale ZWJ offsite-training icon; the database is authoritative.

### Success Criteria:

#### Automated Verification:

- Formatting passes: `npm run format`
- No stale figure remains: `grep -rn "25 MB" context/foundation/infrastructure.md` returns nothing

#### Manual Verification:

- The roadmap reads coherently with S-24 appended

---

## Testing Strategy

### Unit Tests:

- `src/tests/lib/employee-order.test.ts` — `selfFirst` hoisting, and the pass-through when the viewer is absent from the list
- `src/tests/lib/export-workbook.test.ts` — the full rule list under Phase 1 §7: twelve sheets always; year-window column membership; deactivated suffix; weekend shading; full-day vs gated partial-day vs non-whitelisted partial-day cell text; the U+2013 dash pinned by codepoint; note composition and its optional lines; leap-year February

These are pure and must run unskipped. The archive's standing rule — assert "0 skipped", because a `describe.skipIf(!process.env.DATABASE_URL_DIRECT)` suite reads as passing when it never ran — applies to the whole suite after this change.

### Integration Tests:

Deliberately none. The export adds no route, so there is no new request/response surface to cover, and `vitest` runs in a node environment with no jsdom, so the island itself is not reachable from a test. The equivalent coverage is `scripts/export-sample.mjs` plus the OOXML part assertions in Phase 2's automated criteria.

### Manual Testing Steps:

1. Seed a year containing: a full-day absence; a partial-day absence on `szkolenie w miejscu pracy`; an absence with a comment; an absence with a substitute; an absence for an employee deactivated mid-year; and an employee hired mid-year.
2. As a moderator, open the dashboard, click **Eksport XLSX**, pick that year, confirm.
3. Open the file in Excel: check twelve Polish tab names, the legend strip, fill colours against the on-screen grid, weekend shading, frozen legend/header/date column.
4. Hover the commented and the substituted cell; confirm the note lines.
5. Confirm the mid-year hire has a column on **every** sheet and the deactivated employee keeps `" (nieakt.)"`.
6. Repeat step 3 in LibreOffice Calc.
7. Log in as a regular employee; confirm the button is absent and `AbsenceExportDialog` props appear nowhere in the page source.
8. Export next year; confirm planned-vacation entries appear.

## Performance Considerations

Generation runs on the user's CPU, so the Workers 10 ms budget is irrelevant — that is the reason for the client-side architecture. At the target scale (~10 employees, `context/foundation/prd.md:28`) a year is at most ~3,660 absence rows and 12 × 31 × 11 ≈ 4,000 cells; measured comparable workloads complete in well under a second. The 5,000-row `LIST_LIMIT` sits above the theoretical annual maximum, so truncation should never trigger in practice — but it is honoured rather than assumed, because the failure is invisible in the output.

The 39 KiB gzip writer is dynamically imported on click, so it never touches the initial dashboard payload (currently 209 KiB gzip of client JS) and is fetched only by moderators who actually export.

## Migration Notes

No schema change, no migration, no data backfill. Nothing to roll back beyond reverting the commits; the feature is additive and read-only.

## References

- Research: `context/changes/export-grid-to-xlsx/research.md`
- Closest structural analogue (year-scoped, role-scoped read over the same table): `context/archive/2026-08-21-statistics-for-moderators/`
- Where the current palette, icons and `text_color` came from: `context/archive/2026-08-07-huge-ui-ux-improvement/`
- The decision that a cell is colour + icon, never a type name: `context/archive/2026-08-11-grid-adjustment-offsite-training/plan-brief.md:28-30`
- Dependency precedents, both recent and opposite: `context/archive/2026-06-08-employee-grid-order/plan-brief.md:63` (accepted, measured) and `context/archive/2026-08-11-radial-timepicker-ux/plan.md:52-55` (refused on size)
- Lazy client fetch precedent: `src/components/absence/AbsenceStats.tsx:279-298`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Workbook Model (pure)

#### Automated

- [x] 1.1 Type checking passes: `npx tsc --noEmit` — c6e32b6
- [x] 1.2 Linting passes: `npm run lint` — c6e32b6
- [x] 1.3 Unit tests pass with zero skipped: `npx vitest run src/tests/lib/export-workbook.test.ts src/tests/lib/employee-order.test.ts` — c6e32b6
- [x] 1.4 Full suite still green: `npx vitest run` — c6e32b6
- [x] 1.5 No new dependency yet: `git diff package.json` is empty — c6e32b6

#### Manual

- [x] 1.6 The grid renders and drag-reorders exactly as before the `selfFirst` extraction — c6e32b6

### Phase 2: Writer Adapter and Download

#### Automated

- [x] 2.1 Type checking passes: `npx tsc --noEmit` — b74a23b
- [x] 2.2 Linting passes: `npm run lint` — b74a23b
- [x] 2.3 Full suite green, zero skipped: `npx vitest run` — b74a23b
- [x] 2.4 Sample generates: `npm run sample:xlsx` — b74a23b
- [x] 2.5 Generated file contains `xl/comments1.xml`, `xl/drawings/vmlDrawing1.vml`, twelve worksheets, and a frozen `<pane>` in sheet 1 — b74a23b
- [x] 2.6 Production build succeeds: `npm run build` — b74a23b

#### Manual

- [x] 2.7 Sample opens in Microsoft Excel with no repair prompt; twelve Polish tab names — b74a23b
- [x] 2.8 Sample opens in LibreOffice Calc with no warning — b74a23b
- [x] 2.9 Fill colours match the on-screen palette; Polish diacritics intact — b74a23b
- [x] 2.10 Hover note shows the expected `Typ:` / `Godziny:` / `Komentarz:` / `Zastępstwo:` lines — b74a23b
- [x] 2.11 Legend, header and date column stay frozen when scrolling — b74a23b
- [x] 2.12 Weekend rows are visibly shaded — b74a23b

### Phase 3: Moderator Export Dialog

#### Automated

- [x] 3.1 Type checking passes: `npx tsc --noEmit`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Full suite green, zero skipped: `npx vitest run`
- [x] 3.4 Production build succeeds: `npm run build`
- [x] 3.5 `hucre` lands in its own chunk, not the dashboard entry chunk

#### Manual

- [x] 3.6 Moderator sees the button; regular employee does not, and the props are absent from their page source
- [x] 3.7 Selecting a year downloads `nieobecnosci-<rok>.xlsx`
- [x] 3.8 Downloaded file passes the Phase 2 manual checks against real data
- [x] 3.9 A year with no absences yields twelve legend-only sheets, not an error
- [x] 3.10 Next year exports and contains `urlop planowany` entries
- [x] 3.11 Column order matches the Siatka tab, viewer's own column first
- [x] 3.12 A network failure shows a Polish error and leaves the dialog open

### Phase 4: Foundation Doc Corrections

#### Automated

- [ ] 4.1 Formatting passes: `npm run format`
- [ ] 4.2 No stale figure remains: `grep -rn "25 MB" context/foundation/infrastructure.md` returns nothing

#### Manual

- [ ] 4.3 The roadmap reads coherently with S-24 appended
