---
date: 2026-08-07T10:21:21+02:00
researcher: Bartosz Oliwa
git_commit: da6172d80c29f7580157bb4c8f38b5027909080c
branch: main
repository: 10xDevs
topic: "Adopt the new-design HTML/JS prototype as the app's UI/UX"
tags: [research, codebase, ui, ux, absence-grid, statistics, holiday-balance, absence-types, design-system]
status: complete
last_updated: 2026-08-07
last_updated_by: Bartosz Oliwa
---

# Research: Adopt the new-design HTML/JS prototype as the app's UI/UX

**Date**: 2026-08-07T10:21:21+02:00
**Researcher**: Bartosz Oliwa
**Git Commit**: `da6172d80c29f7580157bb4c8f38b5027909080c`
**Branch**: `main`
**Repository**: 10xDevs

## Research Question

Take `new-design/` (a `claude.ai/design` HTML+JS prototype of the whole app) and work out what it takes to implement it: the UI, the UX, and the functional improvements it implies — including everything it implies for the data model and API.

## Summary

The prototype is **not a reskin**. Roughly 60% of it is visual (palette, chrome, spacing, card system) and maps onto components that already exist and already have the right shape. The other 40% is new product surface, and three items in it are net-new scope that touch the database:

1. **Priority flag on an absence** (🅿️, "urlop nadrzędny przy kolizji terminów") — no column exists. This is a de-parking of **FR-008**, which the PRD lists as the *only* nice-to-have and an explicit non-goal (`context/foundation/prd.md:89-90`, `:120`, `:124`).
2. **Drag-to-select a day range in the grid** → one modal writes N days. The `UNIQUE (employee_id, date)` constraint (`src/db/schema.ts:59`) means this is N rows, not a range row, and S-09 explicitly ruled multi-day ranges out (`context/changes/absence-hours-range/plan.md:41`).
3. **A new visual language for absence types** — every one of the 7 colours changes, and each type gains an **icon** and a **foreground colour**. Types live in the DB with only `name` + `color` (`src/db/schema.ts:31-36`), and the current palette is pinned in the PRD (`prd.md:107`).

The good news is structural: **the current grid is already transposed the way the prototype draws it** (rows = days, columns = employees — `src/components/absence/AbsenceGrid.tsx:231,243`), the tab IA already matches (Siatka/Szczegóły/Statystyki via `?tab=`), the Details sub-tabs already match (Dzisiaj/Miesięcznie/Rocznie via `?subcard=`), and `comment` + `substitute_employee_id` + partial-day `start_time`/`end_time` **already exist** in the schema. The prototype's information architecture is the one we shipped; what it changes is the skin, the density, and the interaction affordances.

The single biggest non-obvious cost is **statistics**: the prototype adds KPI tiles, a per-employee holiday-utilisation bar list, a per-type breakdown, and stacked mini-bars + 🥇🥈🥉 medals on the yearly matrix. There is **no server-side aggregation anywhere in the codebase** (`src/lib/services/holiday-balance.ts:44-56` is the only `GROUP BY`-shaped query, and it covers one employee × one type), and the utilisation list needs **every employee's holiday balance**, for which no endpoint exists.

Six prototype behaviours contradict decisions that were deliberately locked in earlier changes. Those need a call before planning — they are listed in §5.

---

## Detailed Findings

### 1. What the prototype specifies

Source: `new-design/10xUrlopy.dc.html` (1490 lines: a `<x-dc>` template + a `DCLogic` component class) and `new-design/support.js` (the generated `claude.ai/design` React runtime — **not** application code; it is the harness that renders the template). `new-design/README.md:1` says the folder should be deleted after implementation.

#### 1.1 Chrome

| Element | Prototype | Ref |
|---|---|---|
| Top bar | Full-bleed navy `#072143`, 56px, email + gold `#c5ac75` role pill on the left, `Dashboard` / `Sign out` on the right in white | `10xUrlopy.dc.html:20-29` |
| Action bar | Second white bar, 60px, holding the navy `Pracownicy` button with an inline SVG people icon; gold on hover | `:31-36` |
| Page | `#f4f4f4`, content `max-width:1480px`, padding `28px 32px 56px` | `:18`, `:38` |
| Month nav | 36px rounded-square `‹`/`›` buttons flanking a 24px navy month heading, `min-width:220px` centred | `:42-45` |
| Tabs | Right-aligned segmented control (single bordered pill group, navy active segment) — Siatka / Szczegóły / Statystyki | `:46-50`, styles at `:635-637` |

#### 1.2 Balance card (`Urlop 2026 – pozostało`)

A 14px-radius white card holding: a 40px balance number (red when negative) + `Do dnia:` line, a **three-cell tile group** (Bieżące / Zaległe / Wykorzystane), an outline `Edytuj` button, and a red over-quota chip (`:53-86`). The inline formula string moves **out** of the card and into the modal (`qFormula`, `:1431`).

The quota modal (`:484-526`) has **+/− steppers** on Bieżące and Zaległe, and a live `Pozostanie` preview (`:494`). It has **no Korekta field and no Do dnia field** — those move to the employee modal (`:466-474`).

#### 1.3 Grid tab

- Card header: `Typy nieobecności` + legend chips (colour dot + icon + label) and the hint *"Kliknij komórkę, aby dodać. Przeciągnij, aby zaznaczyć zakres dni."* (`:90-102`).
- Table: horizontally scrollable, `min-width:900px`; first column `Dzień` at 132px showing day number + Polish short weekday; employee columns `flex:1 1 0; min-width:120px` (`:104-111`).
- Weekend rows shaded and non-interactive; the handlers are omitted entirely for weekends (`:791-792`, `:839-841`).
- Cell chip carries **four** signals: type colour + type-specific foreground, the icon, the time range (when `showTimeRanges`), and up to three badges — 🅿️ priority and 💬 comment top-right, 🔁 + substitute initials top-left (`:118-138`, built at `:801-842`).
- Rich multi-line native tooltip: employee, date, type, hours, comment, substitute, and priority for vacation types (`:804-813`).
- **Drag-to-select**: `onMouseDown` opens `drag:{person,from,to}`, `onMouseEnter` extends within the same column, a window-level `mouseup` normalises and opens the modal with a day range (`:700-710`, `:723-738`). Saving loops the range and **skips weekends** (`:1364-1375`).
- Three configurable props: `showTimeRanges`, `weekendShading`, `rowHeight` (26–48px) (`:598`).

#### 1.4 Details tab

- Filter card: range segmented control (Dzisiaj / Miesięcznie / Rocznie) + **icon-only type-filter toggle chips** + `✕ Wyczyść filtry` (`:305-325`).
- Grouped result cards with a Polish-pluralised count (`6 wpisów`) and a `Brak nieobecności` empty state (`:327-345`, `:1009-1013`).
- Sortable header over **5 columns**: Data, Typ, Pracownik, Zastępstwo, Czas — with `↑`/`↓`/`↕` glyphs (`:1210-1216`).
- **Rows are clickable and open the absence modal for editing** (`:347`, `:991`). Each row shows a coloured type pill, the comment inline in quotes beneath it, and a coloured initials avatar for the person (`:348-367`).

#### 1.5 Statistics tab

| Block | What it shows | Ref |
|---|---|---|
| KPI tiles (2) | `Dni nieobecności` (grand total), `Pracownicy z nieobecnością` (n / total) | `:149-157`, `:1190-1193` |
| `Podgląd wykorzystania urlopów` | Per-employee progress bar of **used vs entitlement**, ratio, remaining/over, % — navy, gold at ≥80%, red when over | `:159-185`, `:1144-1168` |
| `Podział wg typu nieobecności` | Per-type bar + day count + share % | `:187-206`, `:1194-1199` |
| Monthly matrix | Employees × 7 types + Łącznie, **plus a per-row stacked mini-bar** scaled to the busiest person, totals footer | `:208-252`, `:1055-1080` |
| Yearly matrix | Same, cumulative from January, with 🥇🥈🥉 per column **and** per total | `:254-299`, `:1099-1143` |

#### 1.6 Employee panel and modals

- Right drawer, `max-width:560px`, `Aktywni (n)` / `Nieaktywni (n)` sections; each row: coloured initials avatar, name, role pill, `Wymiar: X dni · korekta Y`, and Edytuj / Dezaktywuj (or Przywróć) (`:375-425`, `:867-916`).
- Employee modal merges identity and entitlement: Imię, Nazwisko, Rola, then a `Wymiar urlopu` section with Bieżące, Zaległe, **Korekta** (with an `i` tooltip) and **Do dnia** (`:427-482`). It has **no email and no password field**.
- Absence modal: type picker as a **2-column grid of swatch+icon buttons** (`:536-544`, `:1267-1297`), a priority checkbox shown only for `urlop`/`urlop planowany` (`:546-552`), the existing Cały dzień / hours gating (`:554-573`), comment, and a **row of circular initials avatars** for choosing the substitute (`:578-584`, `:1238-1265`).

#### 1.7 The type catalogue in the prototype

`10xUrlopy.dc.html:599-607` redefines all seven types with a **pastel palette, an explicit foreground colour, and an emoji icon**:

| Type | Prototype colour / fg / icon | Current DB colour | Source |
|---|---|---|---|
| urlop | `#cceeff` / `#0b5a72` / 🌴 | `#58873e` | `supabase/migrations/20260526000002_seed_absence_types.sql:9` |
| szkolenie/wyjście poza miejsce pracy | `#ffcc99` / `#8a4a00` / 🏃🏼‍♂️‍➡️ | `#10bbef` | `…:7` |
| szkolenie w miejscu pracy | `#ffe8a8` / `#7a5b00` / 🎓 | `#ffcc00` | `…:8` |
| choroba | `#2f578c` / `#ffffff` / 🤒 | `#e50040` | `…:10` |
| wyjazd zagraniczny | `#f2a3a3` / `#7d0d1c` / 🌍 | `#2f578c` | `…:6` |
| stała nieobecność | `#ccffcc` / `#2c5c2c` / 🚫 | `#6f6f6f` | `…:11` |
| urlop planowany | `#99ccff` / `#0b3f6b` / 📅 | `#7c3aed` | `20260722120000_seed_urlop_planowany_type.sql:10` |

The prototype also **reorders** them (urlop first; wyjazd fifth). `absence_types` has no `display_order` column, so today the order is id/seed order (`context/archive/2026-06-22-urlop-planowany-category/plan-brief.md:29`).

---

### 2. Current state — where the prototype lands

#### 2.1 Already matches (no structural work)

- **Grid orientation**: rows = days, columns = employees — `src/components/absence/AbsenceGrid.tsx:231,243`. Employee names are currently rendered *vertically* (`writingMode: vertical-rl`, `:74`, `:212`); the prototype draws them horizontally.
- **Tab IA**: `?tab=grid|details|stats` parsed at `src/pages/dashboard.astro:32-33`, rendered as links at `:216-235`. URL-as-state is a locked convention (`context/archive/2026-05-30-details-and-stats/plan-brief.md:21`).
- **Details sub-tabs**: `?subcard=today|monthly|yearly` at `dashboard.astro:35-37`, three stacked tables for "Dzisiaj" at `src/components/absence/AbsenceDetailsSubcards.tsx:180-206`.
- **Balance card above the tabs**: `dashboard.astro:207-214` — the prototype keeps exactly this placement, which was a deliberate S-15 decision (`context/archive/2026-06-22-urlop-balance/plan-brief.md:25`).
- **Partial-day gating**: only `szkolenie w miejscu pracy` and `szkolenie/wyjście poza miejsce pracy` may carry hours — `src/lib/absence-types.ts:7-16`, enforced server-side at `src/lib/services/absence-partial-day.ts:20-30`. The prototype's `showAllDay`/`showHours` gating (`:1476`, `:1482`) reproduces this rule exactly.
- **Weekend non-interactivity**: `clickable = (isOwn || isModerator) && !isWeekend && !isInactive` — `AbsenceGrid.tsx:248`.
- **Fields that already exist**: `comment TEXT` (`src/db/schema.ts:53`), `substitute_employee_id UUID` (`:54`), `start_time`/`end_time` (`:51-52`).

#### 2.2 Where the current UI is

- Chrome: white rounded-card topbar with **purple** accents and English link labels (`src/components/Topbar.astro:16-29`); active tabs are `blue-600` underlines (`dashboard.astro:219`); page background `gray-50` (`:186`).
- **No brand token exists.** `#072143`/`#c5ac75`/`#b4dceb` appear exactly 6 times in `src/`, all on the login screen (`src/pages/index.astro:20`; `src/components/auth/LoginCardForm.tsx:20,82,100,126,144`). `src/styles/global.css:7-74` is the stock shadcn **neutral achromatic** OKLCH palette. The dashboard uses **zero** brand colour.
- shadcn primitives installed: `button`, `dialog`, `input`, `label`, `select`, `sheet`, `sonner` — and nothing else. Every card, table, tab bar, badge, checkbox and tooltip in the app is hand-rolled Tailwind (e.g. the raw checkbox at `src/components/absence/AbsenceFormDialog.tsx:167-179`).
- Absence-type colours are consumed as inline `style={{backgroundColor: type.color}}` in four places (`AbsenceGrid.tsx:265,295`, `AbsenceDetailsTable.tsx:167`, `AbsenceStats.tsx:97`).
- Details table has **7** columns (Data, Typ, Pracownik, Zastępca, Czas, Komentarz, **Dodano**), only 4 sortable, and **rows are not clickable** (`AbsenceDetailsTable.tsx:97-143`).
- Stats are the two matrices only — no KPIs, no bars, no medals (`AbsenceStats.tsx:52-137`).
- Every mutation ends in `window.location.reload()` (`AbsenceFormDialog.tsx:90,108`; `AddEmployeeDialog.tsx:35`; `EditEmployeeDialog.tsx:35`; `DeleteConfirmDialog.tsx:25`; `EmployeeManagementSheet.tsx:31`; `HolidayBalanceDialog.tsx:46,74`). Only the grid's column reorder is optimistic.

---

### 3. The delta, surface by surface

`R` = restyle only · `U` = new UI/interaction on existing data · `D` = needs schema/API work.

| # | Prototype feature | Current | Kind | Notes |
|---|---|---|---|---|
| 1 | Navy full-bleed topbar, gold role pill, Polish labels | White card, purple, English | R | `Topbar.astro:9-29` |
| 2 | Dedicated white action bar for `Pracownicy` | Button floats above content | R | `dashboard.astro:189-195` |
| 3 | Segmented tab control | Underlined links | R | Keep `?tab=` links; restyle only |
| 4 | Balance tile group (Bieżące/Zaległe/Wykorzystane) | Inline formula sentence | R | `HolidayBalanceCard.tsx:35-38` |
| 5 | Quota modal: steppers + live preview | Plain number inputs | U | `HolidayBalanceDialog.tsx:94-152` |
| 6 | Quota modal drops Korekta + Do dnia; they move to the employee modal | Both in the self-edit dialog | **D** | Permissions shift — see §5.4 |
| 7 | Horizontal employee names in grid header | Vertical (`vertical-rl`) | R | `AbsenceGrid.tsx:74,212`; check 10-column fit at `min-width:120px` |
| 8 | Per-type **icon** in cells, legend, pickers, stats | No icons at all | **D** | New `absence_types.icon`, or a name-keyed code map |
| 9 | Per-type **foreground colour** | Luminance heuristic `textColorForBg()` | **D** | New `absence_types.text_color` — or keep the heuristic |
| 10 | New pastel palette for all 7 types | Current palette, pinned in the PRD | **D** | Migration + PRD amendment — see §5.1 |
| 11 | Stable type ordering | id/seed order | **D** | New `absence_types.display_order` |
| 12 | 💬 comment badge in cell | Comment invisible in grid | U | Data already there |
| 13 | 🔁 + substitute initials badge in cell | Invisible in grid | U | Data already there |
| 14 | 🅿️ priority badge + modal checkbox | **Does not exist** | **D** | New `absences.priority` — see §5.2 |
| 15 | Rich multi-line cell tooltip | `title={absenceType.name}` only | U | `AbsenceGrid.tsx:266` |
| 16 | Drag-to-select day range → one modal → N days | Single click only | **D** | See §5.3 — API + conflict semantics |
| 17 | Legend chips with dot + icon + label | Flat swatch + name row | R | `AbsenceGrid.tsx:291-300` |
| 18 | Type **filter** toggles + Wyczyść filtry (Details) | No filtering anywhere | U | Explicitly out of scope in S-02 |
| 19 | Details rows clickable → edit modal | Read-only table | U | Edit currently only via grid |
| 20 | Person avatars (initials, colour by index) | None | U | Colour palette is prototype-local (`:871`) |
| 21 | Comment shown inline under the type pill | Its own column | R | |
| 22 | 5 sortable columns; `Dodano` column dropped | 7 columns, 4 sortable | U | **Conflicts with FR-006** — §5.5 |
| 23 | KPI tiles | None | U | Client-computable from the month list |
| 24 | Holiday-utilisation bar per employee | None | **D** | Needs **all** employees' balances — §4.3 |
| 25 | Per-type breakdown bars + share % | None | U | Client-computable |
| 26 | Stacked mini-bar per employee row | None | U | Client-computable |
| 27 | 🥇🥈🥉 medals on the yearly matrix | None | U | Client-computable; ranking ties handled at `:1107-1111` |
| 28 | Matrices show days only | Days **and** hours separately | R/U | **Conflicts with an S-02 decision** — §5.6 |
| 29 | Employee rows show `Wymiar: X dni · korekta Y` | Name + role only | **D** | Same batch-balance need as #24 |
| 30 | Employee modal merges identity + entitlement | Two separate dialogs | **D** | Two writes behind one Zapisz |
| 31 | Type picker as a swatch grid | shadcn `Select` | U | `AbsenceFormDialog.tsx:135-161` |
| 32 | Substitute picker as avatar circles | shadcn `Select` | U | `AbsenceFormDialog.tsx:228-250` |
| 33 | `showTimeRanges` / `weekendShading` / `rowHeight` settings | None | U | Prototype-harness props; treat as optional |

---

### 4. Data-model and API gaps

#### 4.1 `absences.priority` (feature #14)

No such column; grep for `priorit|pilne|urgent` across `src/` returns nothing. Needs: a migration (`BOOLEAN NOT NULL DEFAULT false`), the field in `AbsenceCreateSchema` (`src/pages/api/absences/index.ts:122-142`) and the PATCH partial schema (`src/pages/api/absences/[id].ts:15-25`), plus the UI gate (only `urlop` / `urlop planowany`, per `10xUrlopy.dc.html:1470`) — which is a **third** name-keyed type rule alongside S-14's partial-day gate and S-15's balance exclusion.

The prototype's copy says *"urlop nadrzędny przy kolizji terminów"* — but nothing in the prototype actually resolves a collision. `UNIQUE (employee_id, date)` already makes per-person collisions impossible, so the flag is currently **decorative**. What "kolizja terminów" means across employees is undefined and is the first thing to nail down.

#### 4.2 Multi-day writes (feature #16)

`UNIQUE (employee_id, date)` (`src/db/schema.ts:59`) forces N rows. The prototype's save loop overwrites blindly (`:1364-1375`); the real API returns **409** on `23505` (`src/pages/api/absences/index.ts` error map). So a range spanning existing entries needs a defined policy — skip, overwrite (PATCH), or fail the whole range — and either a bulk endpoint or a client loop with partial-failure reporting. `POST /api/absences` is single-row today.

#### 4.3 Batch holiday balances (features #24, #29)

`GET /api/holiday-balances` serves **one** employee-year (`src/pages/api/holiday-balances/index.ts:35-104`) and `computeUsedDays` runs one aggregate per employee (`src/lib/services/holiday-balance.ts:44-56`). The utilisation list and the employee-sheet quota line both need every employee's balance → either a new `?all=true` mode or an N-query loop in `dashboard.astro`. Note the prototype fakes this: it hardcodes an allowance of 26 for everyone but person 0 (`10xUrlopy.dc.html:1144`).

#### 4.4 Statistics have no server support

There is **no per-person/per-type/per-month aggregation** anywhere. Yearly stats ship the raw list to the browser — `fetch('/api/absences?year=…')` at `AbsenceStats.tsx:146`, capped at **5000 rows** with no pagination (`src/pages/api/absences/index.ts:114`), then counted client-side (`:23-36`, `:60-86`, recomputed every render, unmemoised). At ~10 employees this is fine; every new stats block that the prototype adds inherits the same approach unless an aggregate endpoint is built. There are also **no indexes beyond PK/UNIQUE** in the whole schema, so date-first scans lean on the `(employee_id, date)` composite's trailing column.

#### 4.5 Type metadata (features #8–#11)

`absence_types` is `id` / `name` / `color` (`src/db/schema.ts:31-36`). Icons, foreground colour and display order each need either a column or a code-side map keyed on `name`. S-13 established that "no type list, colour map, or legend is hardcoded anywhere in `src/`" (`context/archive/2026-06-22-urlop-planowany-category/plan-brief.md:11-13`) — a code-side map would break that principle, and `name` is already an overloaded business key.

#### 4.6 Things the prototype's forms would break if copied literally

- The employee modal has **no email and no password field** (`:433-448`), but `POST /api/employees` requires both and creates the Supabase auth user (`src/pages/api/employees/index.ts:71-77`, `:125-129`). The Add path must keep them.
- The prototype's quota modal has no `Korekta`/`Do dnia`, yet `POST /api/holiday-balances` is a **full replace** — omitting them would zero `used_adjustment_days` and null `valid_until` (`src/pages/api/holiday-balances/index.ts:180-189`, deliberate per `HolidayBalanceDialog.tsx:18-19`).

---

### 5. Conflicts with decisions that were deliberately locked in

These need a call before planning. Each one is a place where the prototype contradicts something a previous change chose on purpose.

**5.1 — Absence-type palette.** The PRD pins the canonical colour map (`context/foundation/prd.md:107`) and it matches the seeded rows. The prototype replaces all seven with pastels. Changing them means a migration **and** a PRD amendment. Worth noting the semantic drift: `choroba` goes from red `#e50040` to navy `#2f578c`, which is also the current colour of `wyjazd zagraniczny` — anyone reading the old grid from memory will misread the new one.

**5.2 — Priority flag = de-parking FR-008.** The PRD lists it as the only nice-to-have and a non-goal (`prd.md:89-90,120,124`); the roadmap parks it with "poza głównym MVP flow" (`context/foundation/roadmap.md:333`). Adopting it is a scope decision, not a UI decision — and its collision semantics are undefined (§4.1).

**5.3 — Drag-to-select vs. column drag-and-drop.** The grid already has a drag gesture: moderator column reordering via `@dnd-kit` (`AbsenceGrid.tsx:193-199,218-227`), delivered by S-07. The prototype's grid header has **no drag handles at all** — it doesn't show that feature. Two gestures on one table is workable (handles live on `<th>`, range-select on `<td>`), but S-07 learned that CSS `transform` must never touch a `<th>` in a table layout and that listeners must sit on the handle, not the header (`context/changes/employee-grid-order/plan.md:16,51,259`). Decide explicitly whether column reordering survives.

**5.4 — Who edits Korekta and Do dnia.** Today both live in the self-service balance dialog and **anyone can edit anyone's balance** — `POST /api/holiday-balances` has no role gate (`src/pages/api/holiday-balances/index.ts:147`) and neither does `DELETE …/[id]` (`[id].ts:30-31`). The prototype moves those two fields into the moderator-only employee modal, which implies adding the role gate that was never there. That's a genuine improvement, but it is a behaviour change, not a restyle.

**5.5 — Dropping the `Dodano` column.** FR-006 requires the details table to carry type, person, substitute, hours, comment **and creation date** (`prd.md:82`). The prototype's 5-column layout drops it.

**5.6 — Stats showing days only.** S-02 deliberately reports days and hours **separately**, with no assumed hours-per-day (`context/archive/2026-05-30-details-and-stats/plan-brief.md:24`). The prototype's matrix cells render days only (`10xUrlopy.dc.html:1068`) even though it computes hours. Collapsing hours into days needs the `/8` divisor, which is already duplicated between `src/lib/services/holiday-balance.ts:10` and `AbsenceStats.tsx:12` and must stay in sync.

---

### 6. Prototype bugs — do not port these

- **`clearFilters` is inverted**: it sets `hidden` to *every* type id (`:1321`), hiding everything instead of clearing. `hasFilters` is `hidden.length < TYPES.length` (`:1446`) and `clearStyle` is hardcoded to `CLEAR_ACTIVE` (`:1447`), so the control is always styled active.
- **"Dzisiaj" is stubbed**: `const today = 1` (`:998`) — the groups are days 1, 1–7, 8–14 regardless of the real date.
- **Yearly stats are fabricated**: a hardcoded `HIST` array is added to the current month's counts (`:1082-1091`).
- **Utilisation allowances are fake**: 26 days for everyone except person 0 (`:1144`).
- The **type picker's `SELECT_*` styles are dead code** (`:621-627`, `:1464`) — the template renders the grid at `:536-544`, not a select.
- `initialsOf` (`:925-927`) will throw on a name whose token has no letters after the `\p{L}` strip.

### 7. Housekeeping surfaced along the way

- **`npm run lint` is currently red**: `new-design/support.js` (a generated bundle) contributes ~1490 of the 1492 errors. `src/` and `packages/` lint clean (0 errors, 10 warnings). `new-design/` is untracked and the flat config has no ignore entry for it — the lint gate needs one until the folder is deleted.
- The **dark/light auth fork** is unresolved: `src/components/auth/*` are hard-coded dark while `/` is light. The S-16 reviewer named theme-parametrising the shared components as the right move *if the light theme becomes standard* (`context/archive/2026-08-06-main-page-redesign/reviews/impl-review.md:47`) — this redesign is exactly that trigger.
- `/auth/signin` is still the **dark starter page** and is still where a failed sign-in lands (`src/pages/api/auth/signin.ts:13,18`), while `index.astro:12` reads an `?error` param nothing routes to.
- The inert `useFormStatus` spinner (F1 from S-16) was fixed only in `LoginCardForm`; the same dead pattern remains in the shared `SubmitButton.tsx` / `SignInForm.tsx`.
- `src/middleware.ts:19-33` computes `locals.userRole` on every request and **nothing reads it** — `dashboard.astro:50-60` re-queries the same row, costing two employee lookups per render.
- `GET /api/employees` sorts alphabetically and ignores `display_order` (`src/pages/api/employees/index.ts:52,57`), while the dashboard sorts by `display_order` (`dashboard.astro:104-114`) — the API list and the grid can disagree.
- `Welcome.astro` and `ui/LibBadge.astro` are dead code with no importers.

---

## Code References

- `src/pages/dashboard.astro:32-37` — `?tab=` / `?subcard=` parsing; `:98-141` four parallel Drizzle queries; `:185-279` composition order
- `src/components/absence/AbsenceGrid.tsx:231,243` — transposed grid; `:248` clickability rule; `:193-227` column DnD; `:291-300` passive legend
- `src/components/absence/AbsenceFormDialog.tsx:135-250` — the five form fields; `:60,141-148` partial-day gating
- `src/components/absence/AbsenceDetailsTable.tsx:97-143` — 7 columns, 4 sortable
- `src/components/absence/AbsenceStats.tsx:23-36,52-137` — client-side matrix; `:146` yearly raw fetch
- `src/components/holiday/HolidayBalanceCard.tsx:27-57` / `HolidayBalanceDialog.tsx:94-152` — balance card and dialog
- `src/db/schema.ts:38-60` — all 11 `absences` columns; `:59` `UNIQUE(employee_id, date)`; `:31-36` `absence_types`
- `src/lib/absence-types.ts:7-16` — the name-keyed partial-day whitelist
- `src/lib/services/holiday-balance.ts:19-63` — the only aggregate query in the codebase
- `src/pages/api/absences/index.ts:122-142` — create schema; `:114` the 5000-row cap
- `src/styles/global.css:7-112` — stock shadcn neutral tokens, no brand colour
- `new-design/10xUrlopy.dc.html:599-607` — the prototype's type catalogue

## Architecture Insights

- **The IA survives; the skin doesn't.** Tabs, sub-tabs, grid orientation, balance-card placement and the partial-day rule all already match the prototype. This is a re-skin plus additive interaction, not a re-architecture — which is why the risky parts are the three items that touch the database, not the layout.
- **URL-as-state is a locked convention** (`?month=`, `?tab=`, `?subcard=`, `?error=`). The prototype models everything as client state because it's a single-file mock; the implementation must keep server-rendered URL state and not regress to client-only tabs.
- **Types are data, not code** — and the prototype wants three more attributes per type. Honouring S-13's principle means extending the table, not hardcoding a map.
- **`name` is dangerously overloaded.** It already drives the partial-day gate and the balance exclusion; priority would make three. A `code`/`slug` column would retire the whole class of "a rename silently breaks a rule" bugs, and this redesign is the natural moment for it.
- **The reload-everything mutation pattern** will get worse under the new design: a drag-selected 5-day range writing 5 rows and then reloading is a visibly poor interaction. Optimistic updates or a router refresh are close to mandatory for feature #16.
- **No visual regression net exists and none is planned** (`context/foundation/test-plan.md:98,119,223` — snapshot tests were explicitly ruled out as high-churn), and Drizzle can't run under `wrangler dev` (`CLAUDE.md`), so verification of a large visual change is manual against production.

## Historical Context (from prior changes)

- `context/archive/2026-08-06-main-page-redesign/` — despite the name, this touched **only** the login page. It locked in the wordmark **"Nieobecności"**, the NBP navy/gold palette, Polish copy, and a light theme scoped to `/`. Its review (`reviews/impl-review.md:40-48`) flagged the duplicated auth primitives and named theme-parametrisation as the follow-up if light becomes standard.
- `context/archive/2026-05-30-details-and-stats/plan-brief.md:21-24,32` — established URL-param tabs, lazy yearly fetch, days-and-hours-separately, and explicitly excluded filtering.
- `context/archive/2026-06-03-deactivated-employee-grid/` — deactivated employees must stay visible-but-distinct (grey header, `(nakt.)` suffix, non-clickable). Known open bug: in the yearly view, deactivated employees outside the viewed month render `—` because `gridEmployees` is month-scoped.
- `context/archive/2026-06-22-hours-onsite-training-only/` — the two-type partial-day whitelist and "hide the controls, no dead controls" UX.
- `context/archive/2026-06-22-urlop-balance/` — balance formula, card above the tabs, negative balances surfaced not clamped, `urlop planowany` excluded from Used, `/8` divisor duplicated in two files.
- `context/archive/2026-06-22-urlop-planowany-category/plan-brief.md:11-13` — the "types and colours are data, never hardcoded" principle.
- `context/changes/employee-grid-order/plan.md:16,51,259` — column-DnD constraints that any new grid gesture must respect.
- `context/changes/moderator-absence-management/plan.md:32,183-187` — the substitute dropdown must exclude the **target** employee, not the editor.
- `context/changes/admin-bootstrap/plan.md:22,37,180` — the `is_system` admin must stay invisible in every list, including the substitute picker. Any new data path (avatars, batch balances) must re-apply `visibleEmployeesFilter()`.
- **All 17 roadmap slices are marked done** (`context/foundation/roadmap.md:42-58`); there is no S-17 for this redesign yet. Note that 15 change folders sit at `implemented`/`impl_reviewed` but were never archived — the collision risk is not concurrent edits but silently undoing decisions recorded there.

## Related Research

None — this is the first research artifact for this change. The nearest prior art is `context/archive/2026-08-06-main-page-redesign/` (login page only) and `context/archive/2026-05-30-details-and-stats/`.

## Open Questions

1. **Palette**: adopt the prototype's pastel type colours (migration + PRD amendment), or keep the current PRD-pinned map and take only the layout? (§5.1)
2. **Priority flag**: in or out? If in, what does "kolizja terminów" mean when `UNIQUE(employee_id, date)` already prevents per-person collisions — is it a cross-employee planning signal? (§4.1, §5.2)
3. **Drag-to-select**: does moderator column reordering survive alongside it, and what happens when a selected range overlaps existing entries — skip, overwrite, or reject the range? (§4.2, §5.3)
4. **Type metadata**: new columns (`icon`, `text_color`, `display_order`, and possibly `code`) or a name-keyed code map that breaks S-13's data-driven principle? (§4.5)
5. **Korekta / Do dnia relocation**: accept the implied moderator-only gate on balance edits? That means adding a role check the API has never had. (§5.4)
6. **`Dodano` column and hours-in-stats**: drop them per the prototype, or keep them and diverge from it? Both are PRD/decision-backed. (§5.5, §5.6)
7. **Scope shape**: one big change, or slice it (chrome+tokens → grid → details → stats → employee/balance)? The prototype is a single artifact, but items #14/#16/#24 are independently plannable and independently riskier than the rest.
8. **Mutation model**: keep `window.location.reload()` everywhere, or introduce optimistic updates at least for the multi-day write path?
