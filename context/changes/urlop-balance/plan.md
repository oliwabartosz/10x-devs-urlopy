# Urlop Balance Tracker Implementation Plan

## Overview

Employees have a statutory annual vacation ("urlop") entitlement they read from an external HR system, but the app does nothing with it — so an employee can't see how many vacation days they have left. This change lets a user enter their entitlement (Bieżące + Zaległe) and the app computes the remaining balance by counting the `urlop` absences it already tracks:

> **Left = (Bieżące + Zaległe + used_adjustment_days) − Used**, where **Used** is counted by the app from tracked `urlop` absences for that employee/year (HR's "Wykorzystane" is intentionally not stored).

Shown as a per-year card on the dashboard above the tabs; both employees and moderators can edit any balance; the HR provenance hint ("Do dnia: <date>") is stored as an informational date.

## Current State Analysis

- **No per-employee config/settings table exists.** All data hangs off `employees` (`src/db/schema.ts:17-26`) and `absences` (`src/db/schema.ts:35-57`). Adding entitlement requires a new table.
- **Day-counting precedent** lives in `src/components/absence/AbsenceStats.tsx:12-19`: `FULL_DAY_HOURS = 8`; a full-day absence counts as 1 day, a partial-day as computed `hours` from `start_time`/`end_time`. Any "used days" math must reuse this convention (`/8`).
- **`urlop` is identified by name**, not a stable id — seed `supabase/migrations/20260526000002_seed_absence_types.sql` inserts it (~id 4, but order-dependent). Matching by `absence_types.name = 'urlop'` is the robust approach and naturally excludes the separate `urlop planowany` category (in-flight change S-13).
- **RLS is bypassed** — `DATABASE_URL` is the service-role pooler; all authorization is enforced in handler code (`AGENTS.md:60`). Standard route pattern (`src/pages/api/absences/index.ts`, `src/pages/api/employees/index.ts`): auth check → caller lookup (`employees` by `user_id`, `isNull(deleted_at)`) → role check → zod `safeParse` → logic → error mapping via `extractPgErrorCode` (`src/lib/db-errors.ts`). `const db = createDb(DATABASE_URL)` inside the handler (`src/db/index.ts`).
- **Year filtering** pattern: `?year=2026` → `date >= '2026-01-01' AND date < '2027-01-01'` (gte/lt on `absences.date`), per `src/pages/api/absences/index.ts` and `dashboard.astro:64-66`.
- **Dashboard** (`src/pages/dashboard.astro`) fetches `currentEmployee` (id, first_name, last_name, role) server-side and passes it to React islands; `year`/`month` derived from `?month=YYYY-MM` (`:64`); tab `<nav>` at `:183`, tab panels `:204-237`.
- **UI primitives**: shadcn `Dialog`/`Input`/`Label`/`Button`/`Select` in `src/components/ui/`; no Card component — cards are `div` + Tailwind (`rounded border bg-white px-4 py-3`). Form/fetch pattern in `src/components/absence/AbsenceFormDialog.tsx` (fetch POST/PATCH → `sonner` toast on error → `window.location.reload()`).
- **Migration discipline** (`AGENTS.md:54-58`): `npm run db:generate` → review diff → re-add CHECK constraints manually (Drizzle omits them) → `npm run db:migrate`. **Drizzle can't run in `wrangler dev`** — DB-backed verification is manual against the deployment.
- **Types** (`src/types.ts`) are `$inferSelect`/`$inferInsert` off the schema tables.

## Desired End State

A logged-in user sees a holiday-balance card on the dashboard showing days left for the current year, with the `Bieżące + Zaległe − Wykorzystane = Left` breakdown and the "Do dnia" hint. They can edit the entitlement values via a dialog; saving persists and the card updates. Used is computed live from tracked `urlop` absences (excluding `urlop planowany`). Negative balances are shown with a warning, not hidden. Records are per (employee, year).

**Verify:** seed an employee with mixed full/partial `urlop` absences + one `urlop planowany`; POST a balance (Bieżące 26, Zaległe 4); GET returns `used_days` counting only `urlop` (full + partial/8 + adjustment) and `left_days = 30 − used`. The card on the deployed dashboard reflects this and edits persist.

### Key Discoveries:

- Counting divisor `/8` must match `AbsenceStats.tsx:12` (`FULL_DAY_HOURS = 8`).
- `urlop` resolved by `name` excludes S-13's `urlop planowany` for free — but warrants an explicit regression test.
- CHECK constraints must be hand-added to the generated migration (`AGENTS.md:54-58`; precedent `20260527000001_*`).
- "Both can edit any" → no role gate on writes, but auth / valid-caller / target-exists / zod guards still apply.

## What We're NOT Doing

- **Not** storing HR's "Wykorzystane" — Used is computed; reconciliation for pre-app usage is the `used_adjustment_days` baseline only.
- **Not** auto-rolling carryover between years — `Zaległe` is entered manually each year.
- **Not** counting `urlop planowany` (S-13) or any non-`urlop` type toward Used.
- **Not** adding a DELETE endpoint for balances in v1.
- **Not** clamping negative Left — it's surfaced as a warning.
- **Not** relying on RLS — all authz in handler code.
- **Not** building automated UI/E2E tests — that's a later lesson; UI is manually verified.

## Implementation Approach

Three phases, bottom-up: the table + migration, then the API that owns the urlop-by-name aggregation and upsert, then the dashboard card + edit dialog. Used is computed **server-side** so the card shows it even when the Stats tab is closed and the `urlop` lookup / `urlop planowany` exclusion live in one place. The card is server-fed from `dashboard.astro` (no loading flash) and refreshes via full reload after an edit, matching the existing absence-form pattern.

## Critical Implementation Details

- **Counting divisor** — partial-day urlop contributes `hours / 8` days; the `8` must equal `FULL_DAY_HOURS` in `AbsenceStats.tsx:12`. If that constant ever changes, both must move together (consider extracting a shared constant).
- **CHECK constraints** — after `npm run db:generate`, manually add to the migration: `year` sane range, and `current_entitlement_days`/`carryover_days`/`used_adjustment_days >= 0`. Drizzle will not emit these.
- **Missing `urlop` type row** — if `absence_types` has no `urlop`, degrade to `used_days = used_adjustment_days`, log to Sentry, do not 500.

## Phase 1: Schema + Migration

### Overview

Add the `holiday_balances` table and its types. No behavior change yet.

### Changes Required:

#### 1. Schema table

**File**: `src/db/schema.ts`

**Intent**: Store per-employee, per-year entitlement and the optional reconciliation baseline + HR provenance date. Used is not stored (computed at read time).

**Contract**: New `holiday_balances` table following existing conventions — `id uuid PK default random`; `employee_id uuid NOT NULL references employees.id`; `year integer NOT NULL`; `current_entitlement_days integer NOT NULL default 0` (Bieżące); `carryover_days integer NOT NULL default 0` (Zaległe); `used_adjustment_days integer NOT NULL default 0`; `valid_until date` (nullable, the "Do dnia" hint); `created_at`/`updated_at timestamptz NOT NULL default now()`; `unique().on(employee_id, year)`. Integers throughout (entitlement/carryover are whole days; Used is the only fractional quantity and is computed).

#### 2. Generated migration + manual constraints

**File**: `supabase/migrations/<timestamp>_holiday_balances.sql` (generated)

**Intent**: Apply the table with DB-level CHECK constraints Drizzle can't express.

**Contract**: Run `npm run db:generate`, then hand-add CHECK constraints (`year` range; the three day-columns `>= 0`) to the generated file before `npm run db:migrate`.

#### 3. Types

**File**: `src/types.ts`

**Intent**: Expose the table type and the API response shape.

**Contract**: `HolidayBalance = typeof holiday_balances.$inferSelect`; a `HolidayBalanceView` shape = stored fields + computed `used_days: number` + derived `left_days: number` + `balance_id: string | null`.

### Success Criteria:

#### Automated Verification:

- Migration diff is the new table only and generates cleanly: `npm run db:generate`
- Linting passes: `npm run lint`

#### Manual Verification:

- Generated migration reviewed; CHECK constraints hand-added; `npm run db:migrate` applies cleanly.
- Table + constraints + unique index present in `npm run db:studio`.

**Implementation Note**: After automated verification passes, pause for manual confirmation the migration applied cleanly before proceeding.

---

## Phase 2: API + Used Computation

### Overview

Add the endpoint that returns a balance with live-computed Used, and upserts entitlement values.

### Changes Required:

#### 1. Used-aggregation helper

**File**: `src/lib/services/holiday-balance.ts` (new) — or inline in the route if small

**Intent**: Compute Used for an employee/year by counting `urlop` absences, reusing the full-day + partial-hours/8 convention.

**Contract**: Given `db`, `employeeId`, `year`: resolve the urlop type id by `absence_types.name = 'urlop'`; aggregate that employee's `urlop` absences in the year window — `count(*) filter (where is_full_day)` + `sum(extract(epoch from (end_time - start_time))/3600) filter (where not is_full_day)`; return `full_days + partial_hours/8 + used_adjustment_days`. Missing urlop type → return `used_adjustment_days`, Sentry-log.

#### 2. Balance route — GET + POST

**File**: `src/pages/api/holiday-balances/index.ts` (new)

**Intent**: Read a balance (with computed Used + derived Left) and upsert entitlement values.

**Contract**:
- `GET ?year=&employee_id=` → `HolidayBalanceView`; when no stored row exists, synthesize one with `balance_id: null` and zeroed entitlement so the card always renders.
- `POST` body `{ employee_id, year, current_entitlement_days, carryover_days, used_adjustment_days?, valid_until? }` validated by a zod schema (non-negative ints; `valid_until` optional date) → upsert via `onConflictDoUpdate` on the `(employee_id, year)` target (last-write-wins).
- Authz (both roles can edit any): auth present → else 401; caller resolves to a non-deleted `employees` row → else 403; target `employee_id` exists (soft-deleted allowed only for moderators) → else 404; zod fail → 400. Error mapping via `extractPgErrorCode`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Gated integration tests pass: `npm run test:run` — using `DATABASE_URL_DIRECT`, reusing `createTestEmployee`/`teardownTestEmployee` from `src/tests/helpers/fixtures.ts`.

#### Manual Verification:

- Against the deployment: `GET` returns correct `used_days`/`left_days`; `POST` upserts and re-GET reflects new values.

**Implementation Note**: After automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: UI — Dashboard Card + Edit Dialog

### Overview

Surface the balance as a card above the dashboard tabs with an edit dialog.

### Changes Required:

#### 1. Balance card

**File**: `src/components/holiday/HolidayBalanceCard.tsx` (new)

**Intent**: Show days left for the current year with the breakdown and an edit affordance.

**Contract**: React island; props `initialBalance: HolidayBalanceView`, `currentEmployee`, `year`. Renders `rounded border bg-white px-4 py-3`; prominent Left, the `Bieżące + Zaległe − Wykorzystane = Left` breakdown, the "Do dnia" hint, an empty state when `balance_id === null`, and a red warning when `left_days < 0` (surfaced, never clamped). An "Edytuj" button opens the dialog.

#### 2. Edit dialog

**File**: `src/components/holiday/HolidayBalanceDialog.tsx` (new)

**Intent**: Edit entitlement values, mirroring the absence form pattern.

**Contract**: shadcn `Dialog`/`Input`/`Label`/`Button`; integer inputs for entitlement/carryover (+ optional adjustment, + optional `valid_until` date); POST to `/api/holiday-balances`; `sonner` toast on error; `window.location.reload()` on success.

#### 3. Dashboard wiring

**File**: `src/pages/dashboard.astro`

**Intent**: Server-fetch the balance and render the card above the tabs.

**Contract**: In the `currentEmployee` block, fetch the balance for `currentEmployee.id` + `year` (reuse the Phase-2 aggregation) and render `<HolidayBalanceCard client:load initialBalance={…} currentEmployee={currentEmployee} year={year} />` immediately above the tab `<nav>` (`:183`), so it shows on every tab.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification (deployment):

- Card shows correct Left + breakdown + "Do dnia"; empty state when no record.
- Editing via dialog persists and the card updates after reload.
- Negative Left shows the warning.
- Switching `?month` across a year boundary shows the new year's balance.
- Both an employee and a moderator can edit a balance.

**Implementation Note**: After automated verification passes, pause for manual confirmation of the UI checks.

---

## Testing Strategy

### Unit / Integration Tests:

- Used aggregation: full-day count + partial-hours/8 + `used_adjustment_days`.
- **`urlop` vs `urlop planowany`**: explicit regression test that planned leave is excluded.
- Upsert semantics on `(employee_id, year)`; `left_days` math including negative.
- Authz guards (401/403/404/400).

### Manual Testing Steps:

1. Apply migration; confirm table + constraints in `db:studio`.
2. Seed an employee with mixed full/partial `urlop` + one `urlop planowany`; POST a balance; GET and assert Used counts only `urlop` and `left_days` is correct.
3. On the deployed dashboard: card renders above tabs; edit persists; empty state; negative-Left warning; year-boundary switch; both roles edit.

## Performance Considerations

Negligible — one indexed-by-FK aggregate per card render and a single-row upsert. The card is server-fed so it adds one query to the dashboard load.

## Migration Notes

- New additive table; no backfill. Existing data untouched.
- Per-year records are created on first POST; no rows exist until a user enters values.

## References

- Change identity: `context/changes/urlop-balance/change.md`
- Counting precedent: `src/components/absence/AbsenceStats.tsx:12-19`
- Route pattern: `src/pages/api/absences/index.ts`, `src/pages/api/employees/index.ts`
- Year filter / dashboard year: `src/pages/dashboard.astro:64-66`, tab nav `:183`
- Schema + driver: `src/db/schema.ts`, `src/db/index.ts`; error mapping `src/lib/db-errors.ts`
- Migration discipline + RLS-bypass: `AGENTS.md:54-58`, `AGENTS.md:60`
- Test fixtures: `src/tests/helpers/fixtures.ts`
- Related in-flight: S-13 `urlop-planowany-category` (must be excluded from Used)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema + Migration

#### Automated

- [x] 1.1 Migration diff is the new table only and generates cleanly (`npm run db:generate`) — af4903e
- [x] 1.2 Linting passes (`npm run lint`) — af4903e

#### Manual

- [x] 1.3 Migration reviewed, CHECK constraints hand-added, `npm run db:migrate` applies cleanly — af4903e
- [x] 1.4 Table + constraints + unique index present in `db:studio` — af4903e

### Phase 2: API + Used Computation

#### Automated

- [x] 2.1 Linting passes (`npm run lint`) — 19d3f0d
- [x] 2.2 Gated integration tests pass (`npm run test:run`) — 19d3f0d

#### Manual

- [ ] 2.3 Deployment: GET returns correct used_days/left_days; POST upserts and re-GET reflects it

### Phase 3: UI — Dashboard Card + Edit Dialog

#### Automated

- [x] 3.1 Linting passes (`npm run lint`)
- [x] 3.2 Build passes (`npm run build`)

#### Manual

- [ ] 3.3 Card shows correct Left + breakdown + "Do dnia"; empty state when no record
- [ ] 3.4 Editing via dialog persists and card updates after reload
- [ ] 3.5 Negative Left shows the warning
- [ ] 3.6 Year-boundary switch shows the new year's balance
- [ ] 3.7 Both an employee and a moderator can edit a balance
