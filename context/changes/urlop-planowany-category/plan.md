# Add "urlop planowany" Absence Category (S-13) — Implementation Plan

## Overview

Add a seventh selectable absence type, **"urlop planowany"** (planned vacation), to the
`absence_types` table so it appears in the add/edit dialog, the monthly grid, the details
tables, and the legend — with its own distinct color (`#7c3aed`, violet). This is a
data-only change: a single idempotent seed migration. No application code changes.

## Current State Analysis

The app renders absence types **entirely from data** — nothing in `src/` hardcodes the type
list, colors, or the legend:

- **Seed** (`supabase/migrations/20260526000002_seed_absence_types.sql`): six canonical types
  seeded as `(name, color)`, ids 1–6 by insert order.
- **Schema** (`src/db/schema.ts:31-36`): `absence_types` = `id serial PK`, `name text NOT NULL`,
  `color text NOT NULL`. `name` has **no unique constraint**; `color` has a DB `CHECK`
  (`absence_types_color_check`: `color ~ '^#[0-9a-fA-F]{6}$'`). Verified against the live DB.
- **Load & fan-out** (`src/pages/dashboard.astro:132,155,243,254,265`): `db.select().from(absence_types).orderBy(asc(absence_types.id))` → passed as `absenceTypes` to `AbsenceFormDialog`, `AbsenceGrid`, and `AbsenceDetailsSubcards`.
- **Render** (`src/components/absence/AbsenceGrid.tsx:265,270,293-295`): grid cells use
  `absenceType.color` with `textColorForBg()` for contrast; the legend is
  `absenceTypes.map((type) => …)` reading `type.color`. Dropdown and details are equally dynamic.

The two cross-cutting behaviors that *could* interact with a new type are already handled by
name-based logic:

- **Vacation balance (S-15)** counts only the `urlop` type (`src/lib/services/holiday-balance.ts:31`);
  `urlop planowany` is excluded automatically. Confirmed by the comment at `holiday-balance.ts:16`.
- **Partial-day gating (S-14)** allows time ranges only for the two training types
  (`src/lib/absence-types.ts`); `urlop planowany` is therefore full-day-only with no code change.

## Desired End State

`absence_types` contains a seventh row `('urlop planowany', '#7c3aed')`. In the running app the
type appears (last, by id) in the add/edit dialog dropdown, renders in the grid and details with
its violet color, and shows a violet swatch in the legend. Selecting it offers **no** time
inputs (full-day only), and entries of this type are **not** counted toward the vacation balance.

**Verification:** the migration applies cleanly; `npm run lint`, `npm run build`, and
`npm run test:run` pass (including the S-15 `used-computation` suite, which now finds a real
seeded row instead of self-seeding); manually, the type is selectable and renders correctly.

### Key Discoveries:

- Types are 100% data-driven — one seed row lights up dropdown + grid + details + legend
  (`dashboard.astro:132` → components). No code edits needed.
- `absence_types.name` is **not unique**, so the seed must be idempotent
  (`INSERT … WHERE NOT EXISTS`) — otherwise a re-run, or a test DB where the S-15 test already
  inserted `urlop planowany`, would create a duplicate.
- `#7c3aed` satisfies the `absence_types_color_check` regex and is distinct from all six
  existing colors (fills the empty purple/violet slot).
- New row takes id 7 → appears last in the id-ordered dropdown/legend. Accepted as-is.

## What We're NOT Doing

- No schema change to `absence_types` (no `display_order` column, no unique constraint on `name`).
- No application-code changes — the dropdown, grid, details, and legend are already dynamic.
- No reordering/repositioning of types; `urlop planowany` appears last (id 7), not adjacent to `urlop`.
- No change to the S-14 partial-day rule — `urlop planowany` is full-day-only by the existing default.
- No change to the S-15 balance counter — it already counts only `urlop` by name.
- No dedicated automated test for the seed row (manual + migration-applies verification chosen).
- No edit to the historical seed migration `20260526000002_…` — migrations are append-only.

## Implementation Approach

Append one idempotent SQL seed migration under `supabase/migrations/`, matching the manual
descriptive-name convention used by the existing seed and the S-15 RLS migration
(`20260714114608_holiday_balances_rls.sql`). Apply it via the Supabase CLI (Drizzle-generated
migrations coexist here; a pure data seed is authored by hand, not `db:generate`). Because
every consumer reads types from the DB, no rebuild-time code change is required.

## Critical Implementation Details

**Idempotent insert (name is not unique).** Use
`INSERT INTO absence_types (name, color) SELECT 'urlop planowany', '#7c3aed' WHERE NOT EXISTS (SELECT 1 FROM absence_types WHERE name = 'urlop planowany');`
An unconditional `INSERT` would duplicate the row on any re-apply or against a test DB where the
S-15 suite already seeded the name.

## Phase 1: Seed migration for "urlop planowany"

### Overview

Add the type as a single idempotent seed migration; verify it surfaces through the existing
dynamic rendering path and doesn't perturb the S-14/S-15 name-based logic.

### Changes Required:

#### 1. New seed migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_seed_urlop_planowany_type.sql` (new; timestamp
must sort after the latest existing migration `20260714114608_…`, e.g. `20260722120000`)

**Intent**: Insert the `urlop planowany` type with its violet color so it becomes selectable and
renders everywhere types are shown. Idempotent so re-apply / test-DB overlap can't duplicate it.

**Contract**: Inserts one row `('urlop planowany', '#7c3aed')` into `absence_types` guarded by
`WHERE NOT EXISTS (SELECT 1 FROM absence_types WHERE name = 'urlop planowany')`. Color satisfies
`absence_types_color_check` (`^#[0-9a-fA-F]{6}$`). No schema DDL, no touch to other rows.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a local/test DB (`npx supabase db push`, or `supabase migration up`).
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Test suite passes, including `src/tests/api/holiday-balances/used-computation.test.ts`
  (now finding the real seeded row): `npm run test:run`

#### Manual Verification:

- The add/edit absence dialog lists "urlop planowany" in the type dropdown with a violet swatch.
- Saving a "urlop planowany" entry renders it in the monthly grid with the violet color and a
  legible label, and the legend shows a matching violet swatch.
- Selecting "urlop planowany" shows **no** time-range inputs (full-day only — S-14 default).
- A "urlop planowany" entry is **not** added to "Wykorzystane"/remaining in the vacation balance
  card (S-15 exclusion holds).

**Implementation Note**: After the migration applies and automated verification passes, pause for
manual confirmation that the type is selectable and renders with the correct color before closing.

---

## Testing Strategy

### Automated (regression, already present):

- `src/tests/api/holiday-balances/used-computation.test.ts` asserts `urlop planowany` is excluded
  from the vacation balance — after this seed it exercises the real row rather than a self-seeded stub.

### Manual Testing Steps:

1. Apply the migration to the local/test DB.
2. Open the add-absence dialog → confirm "urlop planowany" appears in the dropdown (violet swatch),
   after the existing six types.
3. Select it → confirm no time inputs appear; save a full-day entry → confirm it renders in the
   grid with `#7c3aed` and shows in the legend.
4. Open the dashboard vacation-balance card → confirm the "urlop planowany" entry is not counted
   as used `urlop`.

## Migration Notes

Idempotent seed; no data backfill. Pre-launch, no existing rows reference the new type. Applying
to production is a `supabase db push` of the new migration (same path used for the S-15 RLS migration).

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-13, `urlop-planowany-category`)
- Existing seed (pattern to mirror): `supabase/migrations/20260526000002_seed_absence_types.sql`
- Dynamic type load & render: `src/pages/dashboard.astro:132`, `src/components/absence/AbsenceGrid.tsx:265,293`
- Balance exclusion (S-15): `src/lib/services/holiday-balance.ts:16,31`
- Partial-day rule (S-14): `src/lib/absence-types.ts`
- Existing reference to the name: `src/tests/api/holiday-balances/used-computation.test.ts:31-37`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Seed migration for "urlop planowany"

#### Automated

- [x] 1.1 Migration applies cleanly against a local/test DB (`supabase db push` / `migration up`)
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Build passes: `npm run build`
- [x] 1.4 Test suite passes incl. `used-computation.test.ts`: `npm run test:run`

#### Manual

- [x] 1.5 "urlop planowany" appears in the type dropdown with a violet swatch
- [x] 1.6 A saved entry renders in the grid with `#7c3aed` and shows in the legend
- [x] 1.7 Selecting the type shows no time-range inputs (full-day only — S-14)
- [x] 1.8 A "urlop planowany" entry is not counted in the vacation balance (S-15)
