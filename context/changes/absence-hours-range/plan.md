# Absence Hours → Start/End Time Range: Implementation Plan

## Overview

Replace the `hours NUMERIC(4,2)` field on the `absences` table with `start_time TIME` and `end_time TIME`. Update every layer that touches `hours`: DB migration, Drizzle schema, TypeScript types, two API routes (POST + PATCH), the form dialog, the monthly grid cell renderer, the details table, and the stats aggregator. Partial-day absences will show "12:00–14:00" in the grid and details view instead of a raw hour count. The roadmap gains a new S-09 slice entry.

## Current State Analysis

- `absences.hours` is `NUMERIC(4,2)`, nullable, guarded by a biconditional CHECK constraint: `(is_full_day AND hours IS NULL) OR (NOT is_full_day AND hours IS NOT NULL)`.
- `hours` is cast to float in three SQL SELECT statements (`api/absences/index.ts:96`, `api/absences/[id].ts:89`, `dashboard.astro:97`) because `postgres-js` returns NUMERIC as a string.
- The form dialog captures partial-day hours via `<input type="number">` (plain HTML, not the shadcn `Input` wrapper).
- The grid renders an identical `h-5` colored block for both full-day and partial-day absences — `hours` is never used in rendering.
- `AbsenceStats` accumulates `absence.hours` directly; full-day absences contribute `0` to the total (a bug the new implementation also fixes by using the 8 h constant).
- There is no production partial-day data: the migration can be a clean column swap with no data conversion.

## Desired End State

- The database stores `start_time TIME` and `end_time TIME` (both null for full-day, both non-null for partial-day, with `end_time > start_time` enforced by CHECK).
- The form dialog shows two `<Input type="time">` fields instead of one number input when the user unchecks "Cały dzień".
- Partial-day absence cells in the monthly grid show the time label (e.g. "12:00–14:00") inside the colored block. Text color adapts based on background luminance.
- The Details table "Godziny" column is renamed "Czas" and shows "12:00–14:00" or "Cały dzień".
- AbsenceStats computes partial-day duration as `(endMin − startMin) / 60` and counts full-day absences as 8 h.
- The API accepts `start_time` and `end_time` as `"HH:MM"` strings; rejects reversed or equal times.
- Existing tests are updated; a new validation test covers the `end_time > start_time` refine.
- The roadmap has a new S-09 slice entry for `absence-hours-range`.

### Key Discoveries

- `src/db/schema.ts:46-47` — NUMERIC hours column to replace; Drizzle `time()` type is the direct equivalent.
- `supabase/migrations/20260527000001_fix_hours_check_and_moderator_select.sql:10-12` — biconditional CHECK pattern to replicate; implementer must read this file to find the exact existing constraint name before writing `DROP CONSTRAINT`.
- `src/types.ts:7` — `Absence` type manually overrides `hours` from `string` (NUMERIC postgres-js behavior) to `number | null`. With `TIME` columns, postgres-js returns strings natively — the manual override can be removed and `Absence` simplified to `typeof absences.$inferSelect`.
- `src/components/ui/input.tsx` — supports any HTML `type` attribute; `type="time"` works as-is; no new shadcn component needed.
- `src/components/absence/AbsenceFormDialog.tsx:153-169` — currently a plain `<input type="number">`, not the shadcn `Input` wrapper; replace with shadcn `Input` for consistency.
- `src/components/absence/AbsenceGrid.tsx:104-126` — block always fills full cell; no time awareness today.
- `src/components/absence/AbsenceStats.tsx:12-74` — internal `StatsMatrix.hours` field name can stay as-is; only the computation changes.
- `src/tests/api/absences/crud.test.ts:31,97` — two fixture objects use `hours: "2.50"` and `hours: "4.00"` — must be replaced with `start_time`/`end_time`.

## What We're NOT Doing

- No data conversion step — no partial-day absence data exists in production.
- No multi-day absence ranges — the UNIQUE `(employee_id, date)` constraint stays; start and end time are on the same date.
- No configurable workday length — 8 h is the full-day constant in AbsenceStats.
- No drag-to-resize time blocks in the grid — the block is fixed height (`h-5`); time is shown as a text label.
- No change to RLS policies, the absence lookup map, or the role-conditional query logic.
- No change to `AbsenceInsert` or `AbsenceUpdate` types — both are `$inferInsert` / `Partial<Omit<$inferInsert, ...>>` and update automatically from the schema.
- No Drizzle relations added.

## Implementation Approach

Layer-by-layer, bottom-up: DB first, then API contracts, then form input, then display UI, then tests and roadmap. Each phase is independently verifiable before the next begins. Phases 3–4 (UI) can only start after Phase 2 (API) because the form and grid consume the updated `Absence` type.

## Critical Implementation Details

- **TIME format round-trip**: Postgres stores `TIME` as `"HH:MM:SS"`; postgres-js returns it as-is. The form uses `<input type="time">` which reads/writes `"HH:MM"`. On initialization, slice the API value to 5 chars (`absence.start_time?.slice(0, 5) ?? ""`). On save, pass the `"HH:MM"` string directly — Postgres accepts `"HH:MM"` and normalizes to `"HH:MM:SS"` internally.
- **Existing CHECK constraint name**: The constraint was added (and renamed) in `supabase/migrations/20260527000001_fix_hours_check_and_moderator_select.sql`. The implementer must read lines 10-12 of that file to confirm the exact constraint name before writing `ALTER TABLE absences DROP CONSTRAINT <name>`. Using `IF EXISTS` is safe.
- **Luminance-based text color in grid**: To prevent unreadable white text on the yellow absence type (#ffcc00), compute perceived brightness from `absenceType.color` using the formula `(R×299 + G×587 + B×114) / 1000`. If brightness > 128, use `text-gray-800`; otherwise `text-white`. The hex-to-RGB parse is a local helper inside `AbsenceGrid.tsx`.

---

## Phase 1: DB + Schema + Types

### Overview

Add a new Supabase migration that replaces `hours` with `start_time` and `end_time`, update the Drizzle schema, and simplify the TypeScript `Absence` type.

### Changes Required

#### 1. New Supabase migration

**File**: `supabase/migrations/20260605000001_absence_start_end_time.sql`

**Intent**: Swap the `hours` column for `start_time` and `end_time` TIME columns and replace the biconditional CHECK constraint. No data conversion is needed.

**Contract**: The migration must (a) drop the existing CHECK constraint by its exact name (read from `20260527000001`), (b) drop the `hours` column, (c) add `start_time TIME WITHOUT TIME ZONE` and `end_time TIME WITHOUT TIME ZONE` (both nullable), (d) add a new named constraint (`absences_time_check`) with the predicate:
```sql
CHECK (
  (is_full_day AND start_time IS NULL AND end_time IS NULL)
  OR
  (NOT is_full_day AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
)
```

#### 2. Drizzle schema

**File**: `src/db/schema.ts:46-47`

**Intent**: Replace the `numeric("hours", { precision: 4, scale: 2 })` column definition with two `time()` columns.

**Contract**: Remove the `hours` column; add `time("start_time").notNull().$type<string | null>()` → actually keep as nullable: `time("start_time")` (no `.notNull()`). Same for `time("end_time")`. Both columns must appear in the same position block where `hours` was, to minimize schema diff noise.

#### 3. TypeScript Absence type

**File**: `src/types.ts:7`

**Intent**: Remove the manual `hours` override — `TIME` columns return `string | null` natively from postgres-js, eliminating the need for the `Omit + &` pattern that existed for NUMERIC.

**Contract**: Replace the current `Omit<typeof absences.$inferSelect, "hours"> & { hours: number | null }` definition with `typeof absences.$inferSelect`. Verify after the schema change that `$inferSelect` correctly infers `start_time: string | null` and `end_time: string | null`. If Drizzle's `time()` infers `Date` instead of `string`, add a targeted override for those two fields only.

### Success Criteria

#### Automated Verification

- `npx supabase db reset` or `npx supabase migration up` applies the migration without errors
- `npm run build` completes without TypeScript errors (Drizzle type changes propagate)
- `npm run lint` passes

#### Manual Verification

- `supabase db diff` shows the column swap and updated CHECK; no unintended changes
- `typeof absences.$inferSelect.start_time` is `string | null` (verify via a quick hover in IDE)

**Implementation Note**: Pause after Phase 1 for manual verification before proceeding to API changes.

---

## Phase 2: API Routes + Validation

### Overview

Update the two mutation routes (POST, PATCH) to accept `start_time`/`end_time` instead of `hours`, remove the `hours::float` casts from all three SELECT queries, and add a `TimeSchema` validator.

### Changes Required

#### 1. TimeSchema validator

**File**: `src/lib/validators.ts`

**Intent**: Add a reusable `TimeSchema` alongside the existing `DateSchema`.

**Contract**: `export const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format HH:MM")` — validates only the format; cross-field range check lives in the route refine.

#### 2. POST route schema and handler

**File**: `src/pages/api/absences/index.ts`

**Intent**: Replace the `hours` field in the create schema with `start_time` and `end_time`, update the refine logic to validate the time range, and remove the `hours::float` cast and the `String(hours)` conversion.

**Contract**:
- In `AbsenceCreateSchema` (line ~121): remove `hours: z.number().positive().nullable()`; add `start_time: TimeSchema.nullable()` and `end_time: TimeSchema.nullable()`.
- Refine (line ~125): replace `is_full_day ? hours === null : hours !== null` with three conditions: `is_full_day ? (start_time === null && end_time === null) : (start_time !== null && end_time !== null && end_time > start_time)`.
- SELECT query (line 96): remove `sql<number | null>\`${absences.hours}::float\`` from the selected columns; replace with the plain `absences.start_time` and `absences.end_time` Drizzle columns.
- Handler body (lines ~162-163): remove the `hours` destructure and `String(hours)` conversion; pass `start_time` and `end_time` directly from the parsed body to the `db.insert()` call.

#### 3. PATCH route schema and handler

**File**: `src/pages/api/absences/[id].ts`

**Intent**: Mirror the POST changes for the update route.

**Contract**: Same schema replacements as POST. In the SELECT after update (line 89): remove `hours::float` cast, add `absences.start_time` and `absences.end_time`. Handler (lines ~73-74): remove `hours` destructure and string conversion; pass start/end time directly to `db.update().set()`.

#### 4. SSR query cast removal

**File**: `src/pages/dashboard.astro:97`

**Intent**: Remove the `hours::float` cast from the server-side absence query.

**Contract**: Replace `sql<number | null>\`${absences.hours}::float\`` with `absences.start_time` and `absences.end_time` in the column selection. The returned `Absence[]` type updates automatically because `Absence` is now `typeof absences.$inferSelect`.

### Success Criteria

#### Automated Verification

- `npm run build` completes without TypeScript errors
- `npm run lint` passes
- Existing CRUD integration tests pass against a test DB (after Phase 5 updates the fixtures)

#### Manual Verification

- `POST /api/absences` with `{ is_full_day: false, start_time: "09:00", end_time: "11:00" }` → 201 with `start_time` and `end_time` in response, no `hours`
- `POST /api/absences` with `{ is_full_day: false, start_time: "14:00", end_time: "09:00" }` → 400 (reversed range rejected)
- `POST /api/absences` with `{ is_full_day: false, start_time: "09:00", end_time: "09:00" }` → 400 (equal times rejected)
- `POST /api/absences` with `{ is_full_day: true, start_time: null, end_time: null }` → 201

**Implementation Note**: Pause after Phase 2 for API manual verification before touching UI.

---

## Phase 3: Form Dialog UI

### Overview

Replace the hours number input with two `<Input type="time">` fields. Update state initialization, the save-button disabled condition, and the save payload.

### Changes Required

#### 1. State and initialization

**File**: `src/components/absence/AbsenceFormDialog.tsx:33`

**Intent**: Replace the single `hours` state variable with `startTime` and `endTime`.

**Contract**: Remove `const [hours, setHours] = useState(...)`. Add:
```
const [startTime, setStartTime] = useState(absence?.start_time?.slice(0, 5) ?? "")
const [endTime,   setEndTime]   = useState(absence?.end_time?.slice(0, 5)   ?? "")
```
When `isFullDay` is toggled ON, clear both values to `""` (time fields become irrelevant).

#### 2. Save-button disabled logic

**File**: `src/components/absence/AbsenceFormDialog.tsx:47`

**Intent**: Update the guard that disables the save button for incomplete partial-day input.

**Contract**: Replace the `!hours || hours <= 0` condition with `(!startTime || !endTime)`. The end-before-start validation is handled by the API — the form does not re-implement it (matching existing form behavior where hours range wasn't validated client-side).

#### 3. Save payload

**File**: `src/components/absence/AbsenceFormDialog.tsx:57`

**Intent**: Send `start_time`/`end_time` instead of `hours` in the POST/PATCH body.

**Contract**: Remove `hours: isFullDay ? null : parseFloat(hours)`. Add `start_time: isFullDay ? null : startTime` and `end_time: isFullDay ? null : endTime`.

#### 4. Input field replacement

**File**: `src/components/absence/AbsenceFormDialog.tsx:153-169`

**Intent**: Replace the plain `<input type="number">` with two shadcn `Input type="time"` fields with a dash separator.

**Contract**: Import `Input` from `@/components/ui/input` at the top of the file (not currently imported). Replace the `{!isFullDay && (<input type="number" ...>)}` block with a `{!isFullDay && (<div className="flex gap-2 items-center">...</div>)}` containing two `<Input type="time">` fields wired to `startTime`/`endTime` state, plus a `<span className="text-muted-foreground">–</span>` separator between them.

### Success Criteria

#### Automated Verification

- `npm run build` completes without TypeScript errors
- `npm run lint` passes

#### Manual Verification

- Open the absence form for a new absence: uncheck "Cały dzień" → two time pickers appear; checking "Cały dzień" again → pickers disappear
- Open the form to edit an existing partial-day absence: start and end time fields are pre-filled (HH:MM)
- Save a partial-day absence (e.g. 10:00–12:00): dialog closes, grid reloads, cell shows the colored block
- Try saving with end time before start time: API returns 400 (form shows error toast if wired to sonner)

**Implementation Note**: Pause after Phase 3 for manual form verification before updating display components.

---

## Phase 4: Display UI (Grid + Details Table + Stats)

### Overview

Update the three display components: add a time label inside partial-day grid cells, rename and reformat the Details table column, and fix the Stats duration computation.

### Changes Required

#### 1. Grid — time label inside partial-day block

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Show the time range as text inside the colored block for partial-day absences; adapt text color to background luminance; leave full-day blocks unchanged.

**Contract**: Add a module-level `function textColorForBg(hexColor: string): string` that parses the hex string, computes `(R×299 + G×587 + B×114) / 1000`, and returns `"text-gray-800"` if > 128 or `"text-white"` otherwise. Add a module-level `function formatTime(t: string | null): string` that returns `t?.slice(0, 5) ?? ""`.

In the absence block render (lines ~115-120), update the `<div>` to add `flex items-center justify-center overflow-hidden` to its `className`. Inside it, conditionally render:
```
{!absence.is_full_day && absence.start_time && (
  <span className={`text-[10px] leading-none font-medium truncate px-0.5 ${textColorForBg(absenceType.color)}`}>
    {formatTime(absence.start_time)}–{formatTime(absence.end_time)}
  </span>
)}
```

#### 2. Details table — column rename and formatter update

**File**: `src/components/absence/AbsenceDetailsTable.tsx:25-27`

**Intent**: Rename the "Godziny" column to "Czas" and show the time range string instead of the hours count.

**Contract**: Rename `formatHours` to `formatAbsenceTime`. Update the implementation:
- If `a.is_full_day` → `"Cały dzień"` (unchanged)
- Else → `` `${a.start_time?.slice(0, 5)}–${a.end_time?.slice(0, 5)}` ``

Find the column header cell that contains the string `"Godziny"` and replace it with `"Czas"`. Update the cell render at line ~177 to call `formatAbsenceTime(absence)`.

#### 3. Stats — replace hours accumulation with duration math

**File**: `src/components/absence/AbsenceStats.tsx`

**Intent**: Replace direct `absence.hours` reads with computed duration. Introduce an 8 h constant for full-day absences.

**Contract**: Add at the module top: `const FULL_DAY_HOURS = 8`. Add a helper:
```
function getAbsenceDuration(a: Absence): number {
  if (a.is_full_day) return FULL_DAY_HOURS;
  const [sh, sm] = (a.start_time ?? "00:00").slice(0, 5).split(":").map(Number);
  const [eh, em] = (a.end_time   ?? "00:00").slice(0, 5).split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}
```

Replace every `absence.hours` reference in the accumulation logic (lines ~22, ~51-58, ~61-68, ~74) with `getAbsenceDuration(absence)`. The `StatsMatrix.hours` field and the display format (`"X godz."`) are unchanged — only the value source changes.

### Success Criteria

#### Automated Verification

- `npm run build` completes without TypeScript errors
- `npm run lint` passes

#### Manual Verification

- Monthly grid: partial-day absence cell shows the time label (e.g. "09:00–11:00") inside the colored block
- Monthly grid: yellow absence type cell shows dark text (gray-800), all other types show white text
- Monthly grid: full-day absence cell shows no text label (identical to current behavior)
- Details table: column header reads "Czas"; partial-day row shows "09:00–11:00"; full-day row shows "Cały dzień"
- Stats tab: partial-day absences contribute their computed duration to the totals; full-day absences contribute 8 h

**Implementation Note**: Pause after Phase 4 for full UI manual verification before touching tests.

---

## Phase 5: Tests + Roadmap

### Overview

Update the integration test fixtures to use `start_time`/`end_time`, add a validation test for the reversed-range rejection, and add the S-09 slice to the roadmap.

### Changes Required

#### 1. Update CRUD integration test fixtures

**File**: `src/tests/api/absences/crud.test.ts`

**Intent**: Replace `hours` with `start_time`/`end_time` in all fixture objects and assertions.

**Contract**: Every object that currently has `is_full_day: false, hours: "2.50"` or `hours: "4.00"` must be replaced with `is_full_day: false, start_time: "09:00", end_time: "11:30"` (or a consistent representative pair). All assertion lines that check `hours` in the response body must be updated to assert `start_time` and `end_time` instead. The test that verifies "hours returned as string" (lines ~44-57) is replaced by a test that verifies `start_time` and `end_time` are returned as `"HH:MM:SS"` strings.

#### 2. Add end_time > start_time validation test

**File**: `src/tests/api/absences/crud.test.ts`

**Intent**: Verify the API rejects absences where end time is before or equal to start time.

**Contract**: Add one `describe` block (or two `it` cases inside the existing POST suite): one POST with `start_time: "14:00", end_time: "09:00"` asserting status 400; one POST with `start_time: "09:00", end_time: "09:00"` asserting status 400.

#### 3. Update roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Register this change as slice S-09 so it appears in the project's canonical slice list.

**Contract**:
- Add a row to the "At a glance" table: `| S-09 | absence-hours-range | (UX) użytkownik widzi zakres godzin (np. "12:00–14:00") dla nieobecności niepełnodniowych w siatce i szczegółach | S-01 | FR-004, US-01 | planned |`
- Add a `### S-09` section in the Slices block (after S-08) documenting outcome, change-id, prerequisites (`S-01`), and status `planned`.
- Add S-09 to Stream A ("Rdzeń siatki i ewidencji") as a parallel item after S-01.

### Success Criteria

#### Automated Verification

- `npx vitest run src/tests/api/absences/crud.test.ts` passes with no failures
- The two new validation tests (`end_time ≤ start_time` → 400) pass

#### Manual Verification

- `context/foundation/roadmap.md` "At a glance" table includes S-09 row
- `context/foundation/roadmap.md` Slices section includes the S-09 block
- `change.md` status updated to `done` after implementation completes

---

## Testing Strategy

### Integration Tests

- `src/tests/api/absences/crud.test.ts` — full CRUD round-trip with `start_time`/`end_time` fixtures
- New: reversed-range (400) and equal-time (400) validation cases

### Manual Testing Steps

1. Run `npx supabase db reset` — confirm migration applies cleanly
2. Create a full-day absence via the dashboard form — confirm it saves and renders as a plain colored block
3. Create a partial-day absence (e.g. 10:00–13:00) — confirm the grid cell shows "10:00–13:00", the Details table shows "10:00–13:00" under "Czas", and Stats shows 3 h for that absence type
4. Edit the partial-day absence to change the time range — confirm updated times display in both grid and details
5. Try saving with end before start — confirm error response (toast or form validation message)
6. Verify yellow absence type ("szkolenie w miejscu pracy") shows dark text in the grid cell

## Migration Notes

Production: no partial-day data exists; the migration is a clean column swap. If run on an environment that does have data (e.g. a staging clone with seed data), the `ALTER TABLE ... DROP COLUMN hours` will permanently drop that data. Run `SELECT COUNT(*) FROM absences WHERE NOT is_full_day` before applying in any environment to confirm it is safe.

## References

- Related research: `context/changes/absence-hours-range/research.md`
- Biconditional CHECK pattern: `supabase/migrations/20260527000001_fix_hours_check_and_moderator_select.sql:10-12`
- Current schema: `src/db/schema.ts:34-55`
- Form dialog (replace): `src/components/absence/AbsenceFormDialog.tsx:33,47,57,153-169`
- Grid cell render (update): `src/components/absence/AbsenceGrid.tsx:104-126`
- Details formatter (update): `src/components/absence/AbsenceDetailsTable.tsx:25-27,177`
- Stats accumulation (update): `src/components/absence/AbsenceStats.tsx:18,22,51-68,74`
- Validators file: `src/lib/validators.ts`
- Input base component: `src/components/ui/input.tsx`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: DB + Schema + Types

#### Automated

- [x] 1.1 Migration applies without errors (`npx supabase migration up` or `db reset`)
- [x] 1.2 `npm run build` passes (Drizzle types propagate)
- [x] 1.3 `npm run lint` passes

#### Manual

- [x] 1.4 `supabase db diff` shows column swap and updated CHECK; no unintended changes
- [ ] 1.5 `$inferSelect.start_time` infers as `string | null` (IDE hover verification)

### Phase 2: API Routes + Validation

#### Automated

- [ ] 2.1 `npm run build` passes
- [ ] 2.2 `npm run lint` passes

#### Manual

- [ ] 2.3 POST with valid time range → 201 with `start_time`/`end_time` in response, no `hours`
- [ ] 2.4 POST with reversed range (`end_time < start_time`) → 400
- [ ] 2.5 POST with equal times → 400
- [ ] 2.6 POST with `is_full_day: true, start_time: null, end_time: null` → 201

### Phase 3: Form Dialog UI

#### Automated

- [ ] 3.1 `npm run build` passes
- [ ] 3.2 `npm run lint` passes

#### Manual

- [ ] 3.3 Uncheck "Cały dzień" → two time pickers appear; recheck → pickers disappear
- [ ] 3.4 Edit existing partial-day absence → start/end fields pre-filled correctly
- [ ] 3.5 Save partial-day absence → dialog closes, grid reloads, cell shows colored block

### Phase 4: Display UI

#### Automated

- [ ] 4.1 `npm run build` passes
- [ ] 4.2 `npm run lint` passes

#### Manual

- [ ] 4.3 Partial-day grid cell shows time label (e.g. "09:00–11:00") inside colored block
- [ ] 4.4 Yellow absence type cell shows dark text (gray-800), others show white
- [ ] 4.5 Full-day grid cell shows no text label
- [ ] 4.6 Details table header reads "Czas"; partial-day shows range; full-day shows "Cały dzień"
- [ ] 4.7 Stats: partial-day contributes computed duration; full-day contributes 8 h

### Phase 5: Tests + Roadmap

#### Automated

- [ ] 5.1 `npx vitest run src/tests/api/absences/crud.test.ts` — all tests pass
- [ ] 5.2 New reversed-range validation tests pass (end_time ≤ start_time → 400)

#### Manual

- [ ] 5.3 Roadmap "At a glance" table has S-09 row with status `planned`
- [ ] 5.4 Roadmap Slices section has S-09 block
