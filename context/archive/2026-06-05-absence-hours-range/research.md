---
date: 2026-06-05T00:00:00+02:00
researcher: Claude (claude-sonnet-4-6)
git_commit: 1479fb580ae06ab0a6509c6a11e73342a0c0bafc
branch: main
repository: oliwabartosz/10x-devs-urlopy
topic: "Replace absence hours field with start_time/end_time range and show time block in grid and details"
tags: [research, codebase, absences, grid, database, migration, ui]
status: complete
last_updated: 2026-06-05
last_updated_by: Claude (claude-sonnet-4-6)
---

# Research: Absence Hours → Start/End Time Range

**Date**: 2026-06-05  
**Researcher**: Claude (claude-sonnet-4-6)  
**Git Commit**: 1479fb580ae06ab0a6509c6a11e73342a0c0bafc  
**Branch**: main  
**Repository**: oliwabartosz/10x-devs-urlopy

## Research Question

Replace the absence `hours` duration field (e.g. "4h") with `start_time` and `end_time` fields. In the UI, partial-day absences should show a visual time block (e.g. "12:00–14:00") in the monthly grid and in the Details view.

## Summary

The change touches every layer of the stack: one DB migration, Drizzle schema, TS types, two API routes (POST + PATCH), the form dialog, the grid cell renderer, and the details table. No architectural redesign is needed — the existing patterns (biconditional CHECK constraint, single date per absence, role-conditional queries) are preserved; only the `hours` column is replaced by `start_time` + `end_time`. The grid currently renders a plain colored block with no time-of-day positioning — adding a time label or split block is the main new UI concept. A native `<input type="time">` (already compatible with the existing `Input` base component) replaces the number input, so no new shadcn component install is required.

---

## Detailed Findings

### 1. Database — Current Schema

**File:** `src/db/schema.ts:34-55`  
**Migrations:** `supabase/migrations/20260526000001_schema.sql`, `20260527000001_fix_hours_check_and_moderator_select.sql`

Current `absences` table columns relevant to this change:

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `date` | DATE | NO | One absence per employee per day |
| `is_full_day` | BOOLEAN | NO | Default `true` |
| `hours` | NUMERIC(4,2) | YES | **The field being replaced** |

**Active constraints:**
- `UNIQUE (employee_id, date)` — one row per employee per day; preserved in the new design (same-day time ranges confirmed from UX description "12:00–14:00")
- `CHECK ((is_full_day AND hours IS NULL) OR (NOT is_full_day AND hours IS NOT NULL))` — biconditional; must be replaced by an equivalent for `start_time`/`end_time`

**RLS policies** (`20260529000001_fix_absences_select_rls.sql`):
- SELECT: any authenticated user (for team grid)
- INSERT/UPDATE/DELETE: own row OR moderator — enforced via `get_user_role()` helper

**Existing test data** (`src/tests/api/absences/crud.test.ts:31,97`):
- Partial-day fixture: `is_full_day: false, hours: "2.50"` — test file must be updated

### 2. TypeScript Types

**File:** `src/types.ts:1-11`

```typescript
// Current Absence type
type Absence = Omit<typeof absences.$inferSelect, "hours"> & { hours: number | null }
```

`hours` is patched from `string` (postgres NUMERIC) to `number | null`. The new type will replace `hours` with `start_time: string | null` and `end_time: string | null` (stored as `HH:MM:SS` from Postgres `TIME`, can be sliced to `HH:MM` for display).

`AbsenceInsert` (`src/types.ts:9`) and `AbsenceUpdate` (`src/types.ts:10`) are derived from Drizzle inference — will auto-update once the schema changes.

### 3. API Routes

**POST** — `src/pages/api/absences/index.ts:115-127`  
**PATCH** — `src/pages/api/absences/[id].ts:12-26`

Current `AbsenceCreateSchema` / `AbsenceUpdateSchemaRefined` both validate:
```typescript
hours: z.number().positive().nullable()
// refine: is_full_day ? hours === null : hours !== null
```

After the change, the schema becomes:
```typescript
start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable()
end_time:   z.string().regex(/^\d{2}:\d{2}$/).nullable()
// refine: is_full_day ? both null : both non-null, and end_time > start_time
```

The POST handler converts hours to string before DB insert (`index.ts:162`). The new handler passes time strings directly (Postgres `TIME` accepts `"HH:MM"` strings).

The GET handler casts `hours::float` in the SQL SELECT (`index.ts:96`, `dashboard.astro:97`). That cast must be removed; `start_time` and `end_time` come back as strings naturally.

### 4. Monthly Grid — Absence Rendering

**File:** `src/components/absence/AbsenceGrid.tsx:104-126`

**Current cell render (no time awareness):**
```tsx
{absenceType ? (
  <div
    className="h-5 w-full rounded-sm"
    style={{ backgroundColor: absenceType.color }}
    title={absenceType.name}
  />
) : (
  clickable && <div className="flex h-5 w-full items-center justify-center text-xs text-gray-300">+</div>
)}
```

The `hours` field is currently **not used in rendering at all** — partial and full-day absences look identical. This is the gap to fix.

**New design option (recommended — label inside block):**
```tsx
{absenceType ? (
  <div
    className="h-5 w-full rounded-sm flex items-center justify-center overflow-hidden"
    style={{ backgroundColor: absenceType.color }}
    title={absenceType.name}
  >
    {!absence.is_full_day && absence.start_time && (
      <span className="text-[10px] leading-none text-white font-medium truncate px-0.5">
        {formatTime(absence.start_time)}–{formatTime(absence.end_time)}
      </span>
    )}
  </div>
) : ...}
```

Where `formatTime("12:00:00") → "12:00"`.

The absence lookup map (`AbsenceGrid.tsx:42-50`) is keyed by `"${employee_id}_${date}"` — unchanged, since we keep a single row per employee per day.

### 5. Absence Form Dialog

**File:** `src/components/absence/AbsenceFormDialog.tsx:139-169`

**Current partial-day section:**
```tsx
{/* Lines 139-151 */}
<input type="checkbox" ... /> Cały dzień

{/* Lines 153-169 */}
{!isFullDay && (
  <input type="number" min="0.5" step="0.5" value={hours} ... />
)}
```

**Replacement:** two `<Input type="time">` fields using the existing `src/components/ui/input.tsx` wrapper (confirmed supports any HTML `type` attribute). No new shadcn component needed.

```tsx
{!isFullDay && (
  <div className="flex gap-2 items-center">
    <Input type="time" value={startTime} onChange={...} />
    <span className="text-sm text-muted-foreground">–</span>
    <Input type="time" value={endTime} onChange={...} />
  </div>
)}
```

State changes in the form:
- Remove: `const [hours, setHours] = useState(...)` (line 33)
- Add: `const [startTime, setStartTime] = useState(...)` and `endTime`
- Save button disabled logic (line 47): replace hours check with `!startTime || !endTime || endTime <= startTime`
- Payload (line 57): `{ ..., start_time: isFullDay ? null : startTime, end_time: isFullDay ? null : endTime }`

### 6. Details Table

**File:** `src/components/absence/AbsenceDetailsTable.tsx:25-27`

**Current "Godziny" column:**
```typescript
function formatHours(a: Absence) {
  if (a.is_full_day) return "Cały dzień";
  return `${a.hours} godz.`;  // e.g. "2.5 godz."
}
```

**Replacement:** rename column header to "Godziny" → "Czas" (or keep "Godziny"), update formatter:
```typescript
function formatTime(t: string | null) { return t?.slice(0, 5) ?? ""; }  // "HH:MM:SS" → "HH:MM"

function formatAbsenceTime(a: Absence) {
  if (a.is_full_day) return "Cały dzień";
  return `${formatTime(a.start_time)}–${formatTime(a.end_time)}`;  // "12:00–14:00"
}
```

### 7. AbsenceStats — Impact Assessment

**File:** `src/components/absence/AbsenceStats.tsx:12-74`

Stats currently accumulate `absence.hours` to produce per-type and per-employee totals. With `start_time`/`end_time`, the duration must be computed: `duration = (end_time_minutes - start_time_minutes) / 60`. Full-day absences contribute `8` hours (or a configurable work-day constant) to totals, same as today.

This component must be updated, but the logic is straightforward arithmetic.

### 8. Role-Conditional Query (Deactivated Employees)

**File:** `src/pages/dashboard.astro:77-89`

The `2026-06-03-deactivated-employee-grid` fix introduced role-conditional absence filtering: moderators see all absences (including deactivated employees), employees see only their own. This filtering operates on `employee_id` and is unaffected by the hours→time-range change. The SSR query at `dashboard.astro:97` only needs the `hours::float` cast removed.

---

## Code References

- `src/db/schema.ts:34-55` — absences Drizzle table definition (hours column to replace)
- `supabase/migrations/20260526000001_schema.sql:40-52` — original schema including CHECK constraint
- `supabase/migrations/20260527000001_fix_hours_check_and_moderator_select.sql:10-12` — biconditional CHECK (pattern to replicate)
- `src/types.ts:1-11` — Absence TS type, hours override pattern
- `src/pages/api/absences/index.ts:115-127` — POST zod schema + refine
- `src/pages/api/absences/index.ts:96` — `hours::float` cast in SELECT (remove)
- `src/pages/api/absences/index.ts:162-163` — hours string conversion before DB insert
- `src/pages/api/absences/[id].ts:12-26` — PATCH zod schema + refine
- `src/pages/api/absences/[id].ts:73-74` — PATCH hours string conversion
- `src/pages/api/absences/[id].ts:89` — `hours::float` cast in PATCH SELECT (remove)
- `src/components/absence/AbsenceGrid.tsx:104-126` — absence block render (no time awareness today)
- `src/components/absence/AbsenceGrid.tsx:42-50` — absence lookup map (keyed by date, unchanged)
- `src/components/absence/AbsenceFormDialog.tsx:33` — hours state init
- `src/components/absence/AbsenceFormDialog.tsx:47` — save button disabled condition
- `src/components/absence/AbsenceFormDialog.tsx:57` — hours in save payload
- `src/components/absence/AbsenceFormDialog.tsx:153-169` — hours number input (replace with two time inputs)
- `src/components/absence/AbsenceDetailsTable.tsx:25-27` — formatHours function
- `src/components/absence/AbsenceDetailsTable.tsx:177` — Godziny column cell
- `src/components/absence/AbsenceStats.tsx:12-74` — hours accumulation logic (needs duration computation)
- `src/pages/dashboard.astro:97` — `hours::float` cast in SSR query
- `src/lib/validators.ts:1-9` — DateSchema pattern (reference for TimeSchema)
- `src/components/ui/input.tsx:1-21` — base Input (supports `type="time"` natively)
- `src/tests/api/absences/crud.test.ts:31,97` — test fixtures with `hours` field

---

## Architecture Insights

**Pattern to replicate — biconditional CHECK:**  
Migration `20260527000001` established the lesson: check BOTH directions. The new constraint must be:
```sql
CHECK (
  (is_full_day AND start_time IS NULL AND end_time IS NULL)
  OR
  (NOT is_full_day AND start_time IS NOT NULL AND end_time IS NOT NULL)
)
```
Add a second CHECK for logical validity: `CHECK (is_full_day OR end_time > start_time)`.

**Native `<input type="time">` over a custom picker:**  
No time-picker component exists in `src/components/ui/`. Native `type="time"` renders a browser-native picker, is accessible, and works with the existing `Input` wrapper. No new install required.

**Postgres TIME type:**  
Store as `TIME WITHOUT TIME ZONE`. Postgres returns it as `"HH:MM:SS"` strings. Slice to 5 chars for `"HH:MM"` display. Drizzle type: `time("start_time")` / `time("end_time")`.

**No lookup map changes:**  
The grid's `Map<string, Absence>` keyed by `"${employee_id}_${YYYY-MM-DD}"` is valid as long as the UNIQUE constraint on `(employee_id, date)` is preserved — which it is (same-day ranges only, per the UX description).

**Hours accumulation in stats → duration math:**  
`duration_hours = (endMinutes - startMinutes) / 60` where `endMinutes = HH*60+MM`. Full-day absence = 8h (or business constant). This is local computation, no DB change needed.

---

## Historical Context (from prior changes)

- `context/changes/monthly-grid-own-absence/` — established the grid architecture: table-based, one cell per employee per day, `Map<string, Absence>` lookup, page reload on save, `is_full_day` + `hours` biconditional pattern. The biconditional CHECK was tightened in migration `20260527000001` after the first attempt only checked one direction — the new migration must get both directions right from the start.
- `context/changes/details-subcards/` — built `AbsenceDetailsSubcards.tsx` + `AbsenceDetailsTable.tsx`; the `formatHours()` function at `AbsenceDetailsTable.tsx:25-27` is the target display to update.
- `context/changes/moderator-absence-management/` — wired moderator role into the grid and API. The `targetEmployee` prop thread and the substitute-excludes-target fix must be preserved unchanged.
- `context/archive/2026-06-03-deactivated-employee-grid/` — added role-conditional absence filtering; the SSR query structure in `dashboard.astro:77-89` must be preserved when removing the `hours::float` cast.

---

## Open Questions

1. **AbsenceStats total hours** — should a full-day absence still count as 8h in the stats totals, or become "1 day" with separate day/hour breakdowns? Currently everything is in hours.
2. **Existing data migration** — are there any absences in the production DB with `is_full_day=false` and `hours` set? If so, the migration needs a `UPDATE absences SET start_time='09:00', end_time=(calculated from hours) WHERE NOT is_full_day` before the column drop. Otherwise the migration can be a clean replace.
3. **Column name in details table header** — keep "Godziny" or rename to "Czas" / "Przedział"?
4. **Grid time label contrast** — the time label text will be on top of the colored absence block; white text (`text-white`) may not be readable on light colors (e.g. yellow `#ffcc00`). Consider a dark fallback or omit the label and use only the `title` tooltip for now.
