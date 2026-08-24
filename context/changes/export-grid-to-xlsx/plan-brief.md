# Moderator XLSX Export of the Yearly Absence Grid — Plan Brief

> Full plan: `context/changes/export-grid-to-xlsx/plan.md`
> Research: `context/changes/export-grid-to-xlsx/research.md`

## What & Why

A moderator can currently only view the absence grid one month at a time, in the browser. This gives them a single `.xlsx` for a whole calendar year — twelve sheets, one per month, with the grid's colours preserved — so the year's record can be read, filed or shared outside the app. The PRD names the reporting gap as half the original pain (`prd.md:24`) and frames the moderator's job as verifying data *"bez ręcznego uzgadniania danych w Excelu"* (`:46`); this closes that loop from the other direction.

## Starting Point

The grid is a React island rendering days as rows and employees as columns, one month at a time, with all colours, icons and ordering read from the `absence_types` catalogue rather than hardcoded. A whole-year, role-scoped query already exists and is already exposed as `GET /api/absences?year=YYYY`. What does not exist: any year selector, any non-JSON response anywhere in the repo, any dynamic `import()`, and any XLSX dependency.

## Desired End State

A moderator sees an **"Eksport XLSX"** button in the dashboard's moderator bar. It opens a dialog with a year dropdown; confirming downloads `nieobecnosci-<rok>.xlsx`. Each of the twelve tabs opens with a legend row of seven colour-filled cells naming every absence type, and below it the month's grid. An absence is a coloured cell — partial-day absences also show `08:00–12:00` — and hovering one pops an Excel note with the type, hours, comment and substitute. Weekend rows are shaded; legend, header and date column stay frozen while scrolling.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where the file is generated | In the browser | The project is on Workers Free (10 ms CPU/request) and a single *monthly* workbook already measures 10–16 ms, so server-side generation is not viable — and the client path is the only one testable locally. | Plan |
| What a cell carries | Fill colour + hours only | Type identity comes from colour, decoded via the per-sheet legend; keeps cells compact as on screen. | Plan |
| Comment and substitute | Excel hover note | Mirrors the in-app tooltip and keeps the cell visually clean. | Plan |
| Legend placement | One row atop **every** month sheet | The colour key is in view on whichever tab you land on — essential when cells carry no type text. | Plan |
| Employee column order | On-screen order (`selfFirst`) | The file should match what the exporting moderator sees; drag-reorder persists server-side, so it is stable across loads. | Plan |
| Columns per sheet | One stable set across all twelve | Sheets line up so months can be compared or consolidated, and it sidesteps the known deactivated-employee yearly-view bug. | Plan |
| Sheet set | All twelve months, always | Sheet count and tab positions stay identical every year, so the file is predictable. | Plan |
| Year selection | Button + dialog in the moderator bar | That bar is already server-side moderator-gated, and year selection stays scoped to export instead of introducing a dashboard-wide year concept. | Plan |
| Writer library | `hucre` | Fills, comments, freeze panes and widths all verified working by execution; 39 KiB gzip tree-shaken with zero dependencies, vs 250 KiB for `exceljs`. | Plan |
| Type filter | Ignored — always all seven types | The filter is Details-tab-scoped; a "download the whole grid" action that silently omitted types would be a data-integrity trap. | Plan |

## Scope

**In scope:**
- Pure workbook-model builder in `src/lib/`, fully unit-tested
- `hucre` writer adapter, dynamically imported on click, plus the download trigger
- Moderator-only export dialog with a year dropdown, wired into the dashboard
- Corrections to `infrastructure.md` and `roadmap.md` that the research falsified

**Out of scope:**
- Server-side generation and any new API route
- Emoji or type names inside cells
- Public-holiday marking (no such concept exists anywhere in the codebase)
- A yearly summary or statistics sheet
- CSV / ODS / PDF export, and export for regular employees
- A global `?year=` dashboard parameter

## Architecture / Approach

Three layers, deliberately separated so the untestable surface stays thin:

```
AbsenceExportDialog (island, moderator-only)
   ├─ fetch GET /api/absences?year=YYYY   ← already exists, role-scoped, no new endpoint
   ├─ buildExportWorkbook()               ← pure, dependency-free, in src/lib/ — all correctness lives here
   └─ writeWorkbook()                     ← thin hucre adapter, dynamic import(), the only module that knows hucre exists
```

Because the export reuses an endpoint the caller could already reach, it introduces **no new access boundary** — the moderator-only-ness is UI gating, so this does not land on the uncovered authorization risk (`test-plan.md:49`) the research anticipated. Confining hucre to one adapter is the mitigation for its bus-factor-1 risk: swapping writers means rewriting one file.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Workbook model (pure) | `selfFirst` extracted to `src/lib/`; `buildExportWorkbook()` + unit tests | Getting the year-window column rule wrong — a mid-year hire silently dropping out |
| 2. Writer adapter + download | `hucre` added, model→XLSX mapping, sample-generation script | Excel rejecting the file; `freezePane` misnamed as `freeze` fails silently |
| 3. Moderator export dialog | The button, year dropdown, fetch, error and progress states | Ignoring `X-Result-Truncated` and shipping a year quietly missing December |
| 4. Foundation doc corrections | `infrastructure.md` size limits, roadmap S-24, palette caveat | None |

**Prerequisites:** none — no schema change, no migration, no new secret. The in-flight rename of `src/lib/services/absence-list.ts` → `src/lib/absence-list.ts` should be committed first, since Phase 3 reads that module's contract.
**Estimated effort:** ~3 sessions across 4 phases; Phase 1 is the largest.

## Open Risks & Assumptions

- **Workers Free was stated, not verified** — `wrangler whoami` is not logged in. If the project is actually on Paid, the client-side choice is still correct, just no longer forced.
- **hucre is v1.1.0, under six months old, single-vendor.** Every feature this export needs was verified by executing the library and unzipping the output, but it has no long production track record. Mitigated by the adapter boundary.
- **Excel's own rendering is only verifiable by hand.** `context/foundation/test-plan.md:222-223` deliberately excludes colour snapshot tests, so an export whose value proposition is "colours preserved" has no automated colour-fidelity layer — Phases 2 and 3 carry manual Excel + LibreOffice checks instead.
- **A freshly provisioned environment has the wrong palette.** The two palette migrations are hand-authored and deliberately absent from `_journal.json`, so an export there would faithfully reproduce the superseded 2026-05 colours.
- Cell notes do not print and are invisible in some mobile and web Excel viewers — accepted, since the cell's colour and hours remain fully visible.

## Success Criteria (Summary)

- A moderator downloads a full year as one `.xlsx` in two clicks, for any year from the team's first hire through next year.
- The file opens without a repair prompt in both Excel and LibreOffice, with colours matching the on-screen grid and hover notes carrying the comment and substitute.
- Nothing is ever silently missing: a truncated year refuses to download rather than producing a short workbook, and every employee relevant to the year has a column on all twelve sheets.
