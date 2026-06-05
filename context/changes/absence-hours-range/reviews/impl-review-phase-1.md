<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Absence Hours → Start/End Time Range

- **Plan**: context/changes/absence-hours-range/plan.md
- **Scope**: Phase 1 of 5 — DB + Schema + Types
- **Date**: 2026-06-05
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — API routes still reference dropped `hours` column

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; this is the known Phase 2 scope, no action needed now
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/absences/index.ts:96, src/pages/api/absences/[id].ts:89
- **Detail**: The `hours` column was dropped in the migration and schema, but both API route files still reference `absences.hours` in SELECT queries, `AbsenceCreateSchema`, and `AbsenceUpdateSchema`. Any attempt to create or update a partial-day absence via the API will produce a Postgres error (`column "hours" does not exist`) until Phase 2 lands. This is the expected phased state — Phase 2 is precisely "API Routes + Validation" — and was acknowledged in the commit message. Full-day absence creation is unaffected.
- **Fix**: No action needed — Phase 2 covers this. Track as a known blocker: no partial-day absence CRUD should be exercised until Phase 2 commits.
- **Decision**: SKIPPED — Phase 2 covers it

### F2 — No in-migration pre-condition guard for partial-day data

- **Severity**: ⚠️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260605000001_absence_start_end_time.sql:6
- **Detail**: The migration drops `hours` without first checking that no partial-day rows exist. The plan's §Migration Notes documents this precaution as a manual step (`SELECT COUNT(*) FROM absences WHERE NOT is_full_day`), but a defensive `DO $$ RAISE EXCEPTION ... END $$` block inside the migration would make the guard automatic and machine-enforceable. If the migration is ever applied to a staging clone with seed data, the hours data disappears silently.
- **Fix**: Add as first statement: `DO $$ BEGIN IF (SELECT COUNT(*) FROM absences WHERE NOT is_full_day) > 0 THEN RAISE EXCEPTION 'Refusing to drop hours: % partial-day rows exist', (SELECT COUNT(*) FROM absences WHERE NOT is_full_day); END IF; END $$;`
- **Decision**: FIXED — pre-condition guard added to migration

### F3 — Migration header comment style diverges from existing pattern

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; purely cosmetic
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260605000001_absence_start_end_time.sql:1-3
- **Detail**: Existing migrations (e.g. `20260527000001`) open with a structured `-- ===...` border block with `-- Intent:`, labelled sections, and `-- Old:` / `-- New:` contrast lines. The new migration uses a plain 3-line comment instead.
- **Fix**: Adopt the `-- ===...` header style matching `20260527000001_fix_hours_check_and_moderator_select.sql`.
- **Decision**: FIXED — adopted -- ===... header style

## Success Criteria

| Check | Result |
|-------|--------|
| 1.1 `npx supabase db reset` — migration applies | ✅ PASS (confirmed by user output) |
| 1.2 `npm run build` — no TS errors | ✅ PASS |
| 1.3 `npm run lint` — clean | ✅ PASS |
| 1.4 `supabase db diff` — no unintended changes | ✅ PASS (confirmed by user output) |
| 1.5 `$inferSelect.start_time` infers `string \| null` | ✅ PASS (confirmed via drizzle-orm/pg-core type check) |

## Plan Adherence Notes

All three Phase 1 contract items match exactly:
- **Migration**: DROP hours (IF EXISTS), ADD start_time/end_time TIME WITHOUT TIME ZONE, ADD absences_time_check CHECK with correct biconditional predicate — MATCH
- **Schema**: `time("start_time")` and `time("end_time")` in correct position, no `.notNull()`, `numeric` import replaced with `time` — MATCH
- **Type**: `typeof absences.$inferSelect` without override; Drizzle `time()` correctly infers `string` not `Date` (verified via node_modules type defs) — MATCH

The Phase 3 (`AbsenceFormDialog.tsx`) and Phase 4 (`AbsenceStats.tsx`) changes included in this commit are **complete implementations**, not lint stubs. They were included early to resolve lint errors caused by the `Absence` type simplification in Phase 1. Both are correct and fully functional.
