---
date: 2026-08-24T10:57:44+02:00
researcher: Bartosz Oliwa
git_commit: d000a885e7b7670190ec77e99ab4d83d18deefed
branch: main
repository: 10x-devs-urlopy
topic: "Moderator XLSX export of the yearly absence grid, one sheet per month, with colors and text"
tags: [research, codebase, absence-grid, export, xlsx, cloudflare-workers, moderator-scope]
status: complete
last_updated: 2026-08-24
last_updated_by: Bartosz Oliwa
---

# Research: Moderator XLSX export of the yearly absence grid

**Date**: 2026-08-24T10:57:44+02:00
**Researcher**: Bartosz Oliwa
**Git Commit**: `d000a885e7b7670190ec77e99ab4d83d18deefed` (not yet pushed — `origin/main` is at `68d8ea7`)
**Branch**: main
**Repository**: 10x-devs-urlopy

## Research Question

A moderator should be able to download the whole grid for a selected year as `.xlsx`, preserving colors and text, with each month on its own sheet (plus a legend sheet).

## Summary

The feature is **feasible and mostly unblocked**, but four things in the request do not map onto the codebase as stated, and one platform fact must be checked before the architecture can be chosen.

**What already exists and can be reused as-is:**

- A **whole-year absence query** is already implemented and role-scoped — `yearWindow()` + `absenceEmployeeJoin()` in `src/lib/absence-list.ts:61-83`, used by `GET /api/absences?year=` and `GET /api/absences/stats?year=`. A year of grid data is one query, not twelve.
- A **canonical moderator gate** is copy-pasted across five routes and is the pattern to compose from (`src/pages/api/employees/order.ts:29-52`).
- **All colors, icons, foreground colors and ordering live in the database** (`absence_types`), not in code — so a faithful export reads the catalogue rather than hardcoding a palette.
- The **in-app legend already exists** (`AbsenceGrid.tsx:301-325`) and defines exactly what a legend sheet should contain.
- `AbsenceStats.tsx:279` already does a lazy client-side `fetch('/api/absences/stats?year=…')` — a working precedent for a client-triggered, year-scoped operation.

**What does not exist and must be built or decided:**

1. **The grid is transposed from a normal spreadsheet.** Days are rows, employees are columns (`AbsenceGrid.tsx:369` maps days to `<tr>`, `:390` maps employees to `<td>`; confirmed as canonical in `context/foundation/prd.md:72` FR-001). "One sheet per month" therefore means one sheet of ~30 day-rows × N employee-columns.
2. **A grid cell contains no text naming the absence type** — only an emoji icon and, for the two partial-day types, an `HH:MM–HH:MM` range (`AbsenceGrid.tsx:496-524`). "With colors and text" cannot be satisfied by porting the cell verbatim; the export has to decide what text a cell carries. This is the single biggest product decision in the change.
3. **There is no year selector anywhere in the UI.** `year` is derived from the `?month=YYYY-MM` URL param (`dashboard.astro:29`); navigation is month-at-a-time arrows (`MonthNav.astro:22-24`). Letting the moderator "select just the year" is net-new UI.
4. **No route in this repo has ever returned a non-JSON body.** Verified repo-wide: zero occurrences of `Content-Disposition`, `Blob`, `Uint8Array`, `arrayBuffer`, `CompressionStream`, or any binary content type in `src/`, `scripts/`, or `packages/`. A file download is unprecedented on both the server and client sides.

**The decisive open question:** the Worker's **CPU-time budget**. On Workers Free the limit is 10 ms CPU per request, and a measured 30-employee monthly workbook already costs 10–16 ms of pure CPU in every library tested. Whether this project is on Free or Paid could not be established (`wrangler whoami` is not logged in). If Free, server-side generation is not viable and the work belongs in the browser; if Paid, either path works. **Check this before planning.**

Given the uncertainty, the evidence currently favours **generating the workbook in the browser** with `write-excel-file` (~20 KiB gzip, dynamically imported on click): it sidesteps the CPU limit entirely, avoids a latent `fflate`/Web-Worker crash that only appears above ~200 rows on the server path, and is the only option testable locally — Drizzle cannot reach Supabase under `wrangler dev` (`CLAUDE.md`), so a server-side export route could only ever be verified against production.

## Detailed Findings

### 1. The visual + semantic contract of the grid

**Orientation.** Days are rows, employees are columns (`AbsenceGrid.tsx:369`, `:390`). Days come from `getDaysInMonth(year, month)` (`:39-47`), 1-indexed month, no padding days, no week grouping. `dateStr` is built from **local** getters (`:371`) — never `toISOString()`, because Warsaw is UTC+1/+2 and ISO reports the previous day (`src/lib/absence-range.ts:14-27`).

**Absence types are data, not code.** No enum, no slug column — only `absence_types.name`, which doubles as the Polish display label (`src/db/schema.ts:31-43`; the comment at `:35-37` states the intent: *"Types stay data, never a name-keyed code map: adding an eighth type is a seed row, not a code change"*). `id` is a `serial`, so ids differ per environment and every catalogue migration keys on `name`.

The palette an export must reproduce (`supabase/migrations/20260807122840_faulty_hobgoblin.sql:23-64`, icon patched by `20260812153000_offsite_training_single_codepoint_icon.sql:33-35`; mirrored in `context/foundation/prd.md:107-119`):

| display_order | `name` | bg (`color`) | fg (`text_color`) | icon |
|---|---|---|---|---|
| 1 | urlop | `#cceeff` | `#0b5a72` | 🌴 |
| 2 | szkolenie/wyjście poza miejsce pracy | `#ffcc99` | `#8a4a00` | 🏃 (U+1F3C3) |
| 3 | szkolenie w miejscu pracy | `#ffe8a8` | `#7a5b00` | 🎓 |
| 4 | choroba | `#2f578c` | `#ffffff` | 🤒 |
| 5 | wyjazd zagraniczny | `#f2a3a3` | `#7d0d1c` | 🌍 |
| 6 | stała nieobecność | `#ccffcc` | `#2c5c2c` | 🚫 |
| 7 | urlop planowany | `#99ccff` | `#0b3f6b` | 📅 |

Three caveats. `context/foundation/prd.md:112` still lists the offsite-training icon as the ZWJ sequence 🏃🏼‍♂️‍➡️, which the DB no longer carries — migration `20260812153000` replaced it with the single codepoint 🏃 precisely because the ZWJ sequence decomposed visibly in the browser. The doc is stale; the DB is authoritative, and an exporter reading the catalogue gets the right one. `text_color` is a deliberate catalogue decision, **not** a computed luminance guess — `textColorForBg()` was deleted in S-17 (`context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:513`); read the stored value. And both migrations above are hand-authored data migrations **deliberately absent from `_journal.json`** (per AGENTS.md "Migration discipline"), so a freshly provisioned environment carries the superseded 2026-05 palette instead.

**Cell content rules** (`AbsenceGrid.tsx:496-530`, gated by `src/lib/absence-grid-cell.ts`):

| Cell state | Visible text | Fill |
|---|---|---|
| Absence, full-day type | icon only | `type.color`, text `type.text_color` |
| Absence, partial-day on a whitelisted type | icon + `HH:MM–HH:MM` | same |
| Absence, partial-day on a non-whitelisted (legacy) type | icon only — `cellTimeRange()` returns `""` (`absence-grid-cell.ts:48-54`) | same |
| With substitute | overlay `🔁` + initials | same |
| With comment | `💬` at right edge | same |
| Empty, clickable | `+` in `#dcdcdc` | row background |
| Empty, not clickable (weekend / others' column) | nothing | row background |

Row backgrounds: weekday rows `#ffffff`, **weekend rows `#f4f4f4`** (`AbsenceGrid.tsx:374`, weekend = `getDay() === 0 || === 6` at `:370`). Header band `#e8e8e8` with black text; a **deactivated** employee's header is `#dcdcdc` with `#6f6f6f` text and a literal `" (nieakt.)"` name suffix (`:58`, `:67`). Grid lines `#c8c8c8` / `#e8e8e8`.

**There is no dark theme.** `src/styles/global.css:48-58` states it explicitly — the `dark:` utilities compile but never activate. One palette to reproduce.

**The `–` in hour ranges is U+2013 EN DASH with no surrounding spaces**, pinned by codepoint in `src/tests/lib/absence-grid-cell.test.ts:91-99`.

**Overlap is structurally impossible**: `UNIQUE (employee_id, date)` (`src/db/schema.ts:65`). One employee-day holds at most one absence, so there is no split-cell, gradient, or priority rule to port. Partial days differ only in the text inside the chip, never geometrically.

**The tooltip is the richest per-cell payload and has no XLSX equivalent** (`buildTooltip`, `AbsenceGrid.tsx:204-223`): employee, `pl-PL` long date + short weekday, type name, `Godziny:` or `cały dzień`, plus `Komentarz:` and `Zastępstwo:` when present. On a spreadsheet this must go into a cell comment, an extra column, or be dropped deliberately.

**The legend already exists** (`AbsenceGrid.tsx:301-325`): a pill per type in `display_order`, each with a `type.color` swatch, the icon, and the full name. Note it renders `color` only — `text_color` is not represented. A legend sheet is a direct port of this.

### 2. Data layer and authorization

**A year of data is already one query.** `yearWindow()` (`src/lib/absence-list.ts:61-66`) returns a half-open `[YYYY-01-01, YYYY+1-01-01)` window — no leap-year or month-length reasoning needed. `absenceEmployeeJoin(role)` (`:79-83`) applies the role-conditional join, and `absenceListColumns` (`:24-36`) is the exact column set the dashboard's monthly query selects. Splitting into 12 sheets is in-memory bucketing on `date.slice(5,7)`.

**Row cap.** `LIST_LIMIT = 5000` (`src/lib/absence-list.ts:21`), applied as `.limit(LIST_LIMIT + 1)` with the extra row used as a truncation probe and surfaced as the `X-Result-Truncated: 0|1` header (`src/pages/api/absences/index.ts:93-101`). Target scale is ~10 people (`context/foundation/prd.md:28`), theoretical annual max 10 × 366 = 3,660 rows — under the cap, but **an XLSX silently missing December is worse than a truncated JSON list**, so the probe must be honoured.

**The moderator gate is app-level only; RLS is not a safety net.** `DATABASE_URL` is a service-role connection that bypasses RLS entirely (AGENTS.md "Authorization"; re-stated at `src/lib/employees.ts:4-12`, `src/pages/api/absences/bulk.ts:29-31`). The existing `absences_select` policy was in any case widened to *any authenticated user, all rows* (`supabase/migrations/20260529000001_fix_absences_select_rls.sql:7-9`). And `src/pages/api/absences/stats.ts:21-26` warns in-file that current role-scoping is *"scope, not secrecy"* — the same non-moderator can still call `GET /api/absences?year=` and receive the whole team.

**A moderator-only export is therefore a genuinely new access boundary in this codebase** and must be enforced entirely in the handler.

**No API route reads `context.locals.userRole`** — verified: `grep "locals.userRole"` matches only `src/middleware.ts` and `src/env.d.ts`. Every route re-queries the caller's employee row. Copy the re-query, not the locals field. The canonical block is `src/pages/api/employees/order.ts:29-52`, ordering `401 → 503 (DB) → 403 (no employee row) → 403 (not moderator)`. Note the two dialects: `employees/*` uses English error strings, `absences/*` uses Polish — an export under `/api/absences/` should use Polish.

`visibleEmployeesFilter()` (= `eq(employees.is_system, false)`, `src/lib/employees.ts:19-21`) is mandatory on **both** role arms of any read; without it an `is_system`-owned absence surfaces as an unnamed row carrying date, type, hours and comment.

**Employee ordering has three layers, and the third is viewer-relative.**

1. Server, moderator (`dashboard.astro:126-132`): active-first `CASE`, then `display_order`, `last_name`, `first_name`.
2. Server, non-moderator (`:133-137`): same minus the active-first bucket; deleted rows excluded in SQL.
3. **Client**: `selfFirst()` hoists the viewer's own column to index 0, for every user and both roles (`AbsenceGrid.tsx:49-53`, applied `:97-99`; contract in `context/archive/2026-06-08-employee-grid-order/plan.md:241-243`).

A server-generated export will not match what the moderator sees on screen unless layer 3 is re-applied. "Faithful to the grid" is ambiguous here and must be decided explicitly.

Separately, `GET /api/employees` orders by `last_name, first_name` only and ignores `display_order` (`src/pages/api/employees/index.ts:52`). **The dashboard is authoritative for grid order; the API is not.**

**Column membership legitimately differs per month.** `dashboard.astro:175-182`:

```ts
gridEmployees = currentEmployee.role === "moderator"
  ? employeesResult.filter((e) =>
      e.created_at <= new Date(firstDayNextMonth) &&
      (e.deleted_at === null || e.deleted_at >= new Date(firstDay)))
  : allEmployees;
```

So a moderator sees an employee in month M iff they existed before M ended and were not deactivated before M started — a now-deactivated employee still appears in past months where they had absences, and a mid-year hire does not appear before their start date. **A 12-sheet export must apply this window per sheet, from the unwindowed list, not once.** The uncommitted `statsYearlyEmployees` change (`dashboard.astro:79`, `:197`) exists for exactly this failure mode; its comment is the warning to heed — *"a colleague hired mid-year would silently drop out of the yearly totals whenever an earlier month is browsed."*

**Public holidays do not exist at any layer.** No table, no column, no migration, no library — verified repo-wide, and independently recorded in `context/archive/2026-08-12-grid-multicheck/research.md:271-272` and `frame.md:120` ("Public holidays (#8) remain out of scope"). "Holiday" in this codebase means `holiday_balances` = vacation entitlement. The only non-working-day concept is **weekend**. Marking Polish public holidays in the export would be new semantics requiring a new data source — not a port.

**Work in flight (uncommitted).** `src/lib/services/absence-list.ts` has been **moved to `src/lib/absence-list.ts`** (staged rename) and now owns the shared `json()` helper (`:49-53`) and `YearSchema` (`:59`, deliberately `/^[12]\d{3}$/` rather than `\d{4}`, because year `0000` raises PG 22008 at the driver). `absences/{index,stats,bulk}.ts` import both from there. Anything written against the old path or a looser year regex will conflict.

### 3. Runtime and library viability

**Platform config, verified directly** (`wrangler.jsonc`): `compatibility_date: "2026-05-08"`, `compatibility_flags: ["nodejs_compat"]`. That date inherits the ≥2025-09-15 defaults for `enable_nodejs_fs_module` and `enable_nodejs_process_v2` — the two gaps that historically broke `exceljs` on Workers are closed here.

**Bundle size is a non-issue.** The CI step (`.github/workflows/ci.yml:45-50`) is `wrangler deploy --dry-run` with no threshold of its own; it relies on the platform limit. Current build measures **3303 KiB raw / 681 KiB gzip**. Against the Worker script limit (3 MB gzip Free, 10 MB Paid) there is ~2.3 MB of headroom — even `exceljs` at ~300 KiB gzip would land near 32% of the Free ceiling.

> **Correction to foundation docs:** `context/foundation/infrastructure.md:69`, `:93` and `:116` all cite a *"25 MB compressed bundle size limit."* That is a Cloudflare **Pages** figure, but this project deploys a standalone Worker (`ci.yml:85`, `wrangler deploy --config dist/server/wrangler.json`). The applicable limits are 3 MB gzip (Free) / 10 MB gzip (Paid). Worth fixing in the same change, per the S-23 precedent of amending foundation docs alongside the work.

**CPU time is the real gate.** Measured warm, in-handler, 32 columns × 2 sheets, in local workerd at this repo's exact compat config:

| Rows | write-excel-file | exceljs | hucre |
|---|---|---|---|
| 30 | 10–11 ms | 12–16 ms | 5–8 ms |
| 500 | ~150 ms | — | 51 ms |
| 5000 | 1476 ms | — | 444 ms |

Workers Free allows **10 ms CPU per request**; Paid allows 30 s by default. A realistic 30-employee monthly export is already at or over the Free limit in every library tested, and a full year is 12× that. **Which plan this project is on could not be established** — `wrangler whoami` reports not logged in. `infrastructure.md:26` sells the platform on its free tier and `:114` describes Workers Paid as a future upgrade, which points to Free, but that is inference, not fact.

**Library comparison** (all rows below were verified by executing the library inside workerd and unzipping the resulting OOXML, except where noted):

| Library | Per-cell fill | Bold | Col width | Frozen panes | Workers | gzip | Maintenance |
|---|---|---|---|---|---|---|---|
| **write-excel-file** | ✅ | ✅ | ✅ | ✅ | ✅ (with caveat below) | **19.7 KiB** | 4.1.1, 2026-06-08, active; 1 dep (fflate); bus factor 1 |
| **exceljs** | ✅ | ✅ | ✅ | ✅ | ✅ | ~263–298 KiB | frozen since 2023-10; 799 open issues |
| **hucre/xlsx** | ✅ | ✅ | ✅ | ✅ | ✅ | 39.1 KiB | v1.1.0, <6 months old, single-vendor |
| **SheetJS CE (`xlsx`)** | ❌ **Pro-only** | ❌ Pro-only | ✅ | ❌ **absent from the API** | ✅ | 84–150 KiB | npm frozen at 0.18.5 (2022) |
| **xlsx-js-style** | ✅ | ✅ | ✅ | ❌ | ✅ | ~142 KiB | 2022-04, SheetJS 0.18.5 base |

Two findings that close off the obvious choice:

- **SheetJS Community cannot style cells.** Not a flag — the writer hardcodes `<fills count="2">` and `get_cell_style()` emits `fillId:0` unconditionally, never reading `cell.s`. Setting `.s` produced output with no `s=` attribute at all. Styling is a documented SheetJS Pro feature.
- **Frozen panes eliminate the whole SheetJS family, forks included.** `!freeze` appears nowhere in `xlsx.mjs` or its typings; the sheet-view writer only ever emits `<sheetView workbookViewId="0"/>`. `xlsx-js-style` inherits the same function, so even the styled fork cannot freeze a header row.

Also worth noting independently of this feature: `npm i xlsx` resolves to 0.18.5 (2022-03-24), carrying GHSA-4r6h-8v6p-xvw6 (fixed in 0.19.3).

> ⚠️ **A silent size cliff on the server path.** `write-excel-file/universal`'s `.toBlob()` routes through fflate's *async* `zip()`, which does `new Worker(URL.createObjectURL(...))`. Workers has no `Worker` constructor, and fflate only falls back to synchronous compression for small entries. Measured: 30×31 rows → OK; 100×31 → OK; **500×31 → `ReferenceError: Worker is not defined`**. This passes every small-scale smoke test and then fails in production — exactly the failure class AGENTS.md warns about. A four-line Vite alias routing async `zip()` to `zipSync` fixes it at every size tested (5000×31 → 1.0 MB in 1476 ms). In a real browser the async path is a *feature*, so this cliff exists only on the server path.

**The hand-rolled fallback is real and modest.** An `.xlsx` is a ZIP of XML parts; the minimum set is `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheetN.xml`, `xl/styles.xml`, with `sharedStrings.xml` skippable via `t="inlineStr"`. Estimate ~400 lines, of which ~150 is a ZIP writer. Excel accepts fully **STORED** (uncompressed) entries — in fact SheetJS's own default — so only CRC-32 (~20 lines) is strictly required; `CompressionStream('deflate-raw')` is available on Workers with no flag if compression is wanted. Known traps: a missing `<Override>` per sheet in `[Content_Types].xml`, rId mismatches, **fill indices 0 and 1 are reserved so custom fills must start at 2**, unescaped XML control characters from DB text, and ZIP offset errors. This matters because the repo's default posture is "dependency-free module in `src/lib/`" and two of the three most recent dependency decisions went that way.

### 4. Client-side vs server-side

Verified: **every island in this repo uses `client:load`** — no `client:visible`, no `client:idle`, and **zero dynamic `import()` / `React.lazy` anywhere in `src/`**. But Astro already code-splits per island, and `dashboard.astro:286-311` renders them conditionally server-side, so the stats island's JS ships only on `?tab=stats`. Measured client chunks total 655 KiB raw / **209 KiB gzip**, of which `AbsenceStats` is only 3.2 KiB gzip.

| | Server route | Browser island |
|---|---|---|
| CPU limit | **blocking on Free, fine on Paid** | irrelevant (user's CPU) |
| Worker size | +20 KiB gzip vs 2.3 MB headroom — irrelevant | irrelevant |
| Client weight | zero | +20 KiB gzip on the stats chunk, deferrable to click via `import()` |
| fflate cliff | **must alias, mandatory** | non-issue (async path is correct in a browser) |
| Local testing | ⚠️ impossible — Drizzle can't reach Supabase under `wrangler dev` (`CLAUDE.md`) | testable in Playwright + vitest |
| Data path | already server-side | needs a JSON fetch; `/api/absences?year=` already exists |
| Auditability | server controls exactly what leaves | client assembles it |

No CSP is set anywhere in the repo (no `_headers`, no meta CSP), so the browser path's blob-URL Web Worker will work.

## Code References

- `src/components/absence/AbsenceGrid.tsx:369,390` — days-as-rows / employees-as-columns loop
- `src/components/absence/AbsenceGrid.tsx:301-325` — the existing legend, the model for a legend sheet
- `src/components/absence/AbsenceGrid.tsx:496-530` — cell content decision (chip vs `+` vs blank)
- `src/components/absence/AbsenceGrid.tsx:204-223` — `buildTooltip`, the per-cell payload with no XLSX equivalent
- `src/components/absence/AbsenceGrid.tsx:49-53,97-99` — `selfFirst`, the viewer-relative column reorder
- `src/lib/absence-grid-cell.ts:22-54` — `cellTimeRange` (gated) vs `rawTimeRange` (ungated); U+2013 dash
- `src/lib/absence-types.ts:7-16` — `PARTIAL_DAY_TYPE_NAMES`, `typeAllowsPartialDay()`
- `src/lib/absence-list.ts:21,24-36,49-53,59,61-66,79-83` — `LIST_LIMIT`, `absenceListColumns`, `json()`, `YearSchema`, `yearWindow()`, `absenceEmployeeJoin()`
- `src/lib/employees.ts:19-25` — `visibleEmployeesFilter()`, `isProtectedAdmin()`
- `src/lib/hours.ts:8,17-29` — `FULL_DAY_HOURS`, `hoursToDays`, `formatDayCount` (the single home for day rounding)
- `src/pages/api/employees/order.ts:29-52` — canonical moderator gate to compose from
- `src/pages/api/absences/stats.ts:21-26` — the "scope, not secrecy" caveat
- `src/pages/api/absences/index.ts:93-101` — `X-Result-Truncated` precedent
- `src/pages/dashboard.astro:29` — `year` derived from `?month=YYYY-MM`; no year selector exists
- `src/pages/dashboard.astro:126-137` — authoritative grid ordering
- `src/pages/dashboard.astro:175-182` — per-month employee windowing
- `src/pages/dashboard.astro:79,197` — in-flight `statsYearlyEmployees` (unwindowed list for yearly aggregation)
- `src/components/absence/AbsenceStats.tsx:279-298` — lazy year-scoped client fetch precedent
- `src/db/schema.ts:31-43,44-66` — `absence_types` catalogue, `absences` + `UNIQUE(employee_id, date)`
- `src/styles/global.css:48-58` — no dark palette, by design
- `supabase/migrations/20260807122840_faulty_hobgoblin.sql:23-64` — the current palette (unjournaled)
- `wrangler.jsonc:5-6` — compat date 2026-05-08, `nodejs_compat`
- `.github/workflows/ci.yml:45-50` — bundle-size dry-run (no threshold of its own)
- `src/tests/api/absences/stats-scope.test.ts:52-64` — the API-route test harness to copy

## Architecture Insights

- **Presentation is data.** Colors, icons, foreground colors and ordering all live in `absence_types`; S-17 deleted the computed-contrast helper on purpose. Hardcoding a palette in an exporter would re-introduce exactly the coupling that change removed.
- **Compose, don't copy.** The most-cited security lesson in the archive: `bulk.ts` was created by copying `index.ts` and inherited a missing guard for months (`context/archive/2026-08-21-statistics-for-moderators/plan-brief.md:24`). A second reader over the same table must compose from `src/lib/absence-list.ts`.
- **Pure logic goes in `src/lib/`, and that is also the test seam.** `vitest.config.ts` runs `environment: "node"` with no jsdom — React islands are untestable by design, which is why `absence-stats.ts`, `absence-range.ts` and `absence-grid-cell.ts` exist. A workbook-**model** builder belongs there; the binary writer probably does not.
- **Skipped tests read as passing.** Every DB-backed suite is wrapped in `describe.skipIf(!process.env.DATABASE_URL_DIRECT)`; the archive's standing rule is to assert "0 skipped" in the criteria.
- **Everything user-facing is Polish**, including error strings and `Intl` formatting with `pl-PL`.
- **Dates are constructed as `new Date(y, m-1, d)`, never parsed from ISO strings** — a repo-wide rule to avoid the Warsaw UTC shift.

## Historical Context (from prior changes)

- `context/archive/2026-05-30-details-and-stats/plan-brief.md:32` — *"Out of scope: … export/print …"*, restated at `plan.md:41`. This is the **only** prior mention of the feature. Note the sibling item on that same list, "moderator-only stats views", was later un-parked and shipped as S-23 — so it is a deferral list, not a rejection list.
- `context/foundation/roadmap.md:38-62` — slices run F-01 … S-23, all done; **no export row, next free ID is S-24**. The backlog (`:417-425`) is empty and "Open Roadmap Questions" (`:428`) is *"Brak."* Export is not in the Parked list (`:432-439`) either — it simply does not exist in the roadmap.
- `context/foundation/prd.md:24` names the **reporting gap** as half the original pain, and `:46` frames the moderator's job as verifying data *"bez ręcznego uzgadniania danych w Excelu"*. There is no FR covering export (FR-001..FR-008, `:68-90`), and no Non-Goal blocking it. This is the closest PRD anchor available.
- `context/archive/2026-08-11-grid-adjustment-offsite-training/plan-brief.md:28-30` — *"A grid cell is colour + icon + optional time range, never a type name. … Type names stay discoverable in the legend and the tooltip."* This is the decision that makes "with colors and text" ambiguous.
- `context/archive/2026-06-08-employee-grid-order/plan-brief.md:63` — dependency **accepted** with a measured figure: *"`@dnd-kit` adds ~30 KB gzipped … the grid is already a React island so this is additive but constrained to users who load the dashboard."*
- `context/archive/2026-08-11-radial-timepicker-ux/plan.md:52-55` — dependency **refused** on bundle-size grounds, with "No new dependency added: `git diff package.json` is empty" locked as a success criterion. Both precedents are recent; expect a plan to have to justify an XLSX library against a hand-rolled writer.
- `context/archive/2026-06-03-deactivated-employee-grid/plan-brief.md:25` — a **known open bug directly in this feature's path**: *"in the yearly view, deactivated employees outside the viewed month render `—` because `gridEmployees` is month-scoped."*
- `context/foundation/test-plan.md:222-223` — UI snapshot tests for grid colour rendering are **deliberately excluded** (*"snapshot tests would break on every style tweak"*). An export whose value proposition is "colors preserved" has no sanctioned colour-fidelity test layer today.
- `context/foundation/test-plan.md:49,75` — Risk #4 (*"Regular employee reaches moderator-only endpoints — role check absent from handler"*, Impact High) and its Phase 2 "Authorization coverage" is still **not started**. A new moderator-only endpoint lands squarely on an uncovered risk.

## Related Research

- `context/archive/2026-08-21-statistics-for-moderators/` — the closest structural analogue: a year-scoped, role-scoped read over the same table. Its `plan.md` Phase 1 is the template for the endpoint and its test suite.
- `context/archive/2026-08-07-huge-ui-ux-improvement/` — where the current palette, icons and `text_color` came from.
- `context/archive/2026-08-12-grid-multicheck/research.md:271-272` — prior confirmation that public holidays exist nowhere.

## Open Questions

1. **Workers Free or Paid?** Decisive for server-vs-client. `wrangler whoami` is not logged in; `infrastructure.md:26,114` implies Free but does not establish it. **Resolve first.**
2. **What text does a cell carry?** The on-screen cell has no type name — only an icon. Options: emoji only (maximum fidelity, undecodable without the legend), a short code, or the full type name (most useful in a spreadsheet, least faithful to the screen). Emoji rendering in Excel is also font-dependent, and `20260812153000_…sql:3-11` records that multi-codepoint sequences already caused visible decomposition problems in the browser.
3. **Whose column order?** Server order, or the on-screen `selfFirst` order that differs per viewer?
4. **Where does the tooltip payload go** — comments, extra columns, a detail sheet, or dropped?
5. **Does the export honour the active type filter** (`src/lib/type-filter.ts`), or always export all types? No precedent.
6. **Where does year selection live?** No year picker exists; `year` comes from `?month=YYYY-MM`. New control needed, and its placement (Siatka toolbar vs Statystyki tab) is open.
7. **Do the unjournaled palette migrations need addressing?** A freshly provisioned environment has the superseded 2026-05 colors, so an export there would be "faithful" to the wrong palette.
8. Unverified: whether Astro/Vite honours the same module-resolution conditions wrangler's esbuild does for these libraries (matters only on the server path — run `npm run build` and inspect `dist/server/chunks/`).
