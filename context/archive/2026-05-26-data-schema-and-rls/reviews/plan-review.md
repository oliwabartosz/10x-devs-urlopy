<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Database Schema and RLS

- **Plan**: context/changes/data-schema-and-rls/plan.md
- **Mode**: Deep
- **Date**: 2026-05-27
- **Verdict**: REVISE
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓, 3/3 symbols ✓, brief↔plan ✓

Paths checked: `supabase/migrations/20260526000001_schema.sql`, `supabase/migrations/20260526000002_seed_absence_types.sql`, `src/types.ts`, `context/changes/data-schema-and-rls/change.md`, `context/changes/data-schema-and-rls/plan.md`

Symbols checked: `get_user_role()` (migration line 76), `employees_select_authenticated` (migration line 99), `UserRole`/`Employee`/`AbsenceType`/`Absence` (src/types.ts)

## Findings

### F1 — hours CHECK allows full-day rows with non-null hours

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — absences table DDL (migration line 46)
- **Detail**: The constraint `CHECK (is_full_day OR hours IS NOT NULL)` only enforces "partial-day requires hours". It does NOT prevent `is_full_day = TRUE AND hours = 4.5`. Future migrations, admin scripts, or API bugs could write full-day rows with stale hours values. The plan notes this gap and punts to application code: "Application code must set is_full_day = true and hours = NULL together." DB-level enforcement closes the class of issue entirely.
- **Fix**: Replace with biconditional constraint in a follow-up migration: `CHECK ((is_full_day AND hours IS NULL) OR (NOT is_full_day AND hours IS NOT NULL))`. One-line change, no data migration needed.
- **Decision**: FIXED — follow-up migration to tighten the hours CHECK constraint

### F2 — Moderators cannot SELECT soft-deleted employees

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — employees_select_authenticated policy (migration line 99-101)
- **Detail**: The sole SELECT policy on employees uses `USING (auth.uid() IS NOT NULL AND deleted_at IS NULL)`, applying to ALL authenticated roles. Moderators cannot see soft-deleted employees via the Supabase client. S-04 (employee management) likely needs to list and/or restore deleted employees — currently impossible without a schema change.
- **Fix A ⭐ Recommended**: Add a second SELECT policy for moderators covering all rows (active + deleted): `CREATE POLICY "employees_select_moderator_all" ON employees FOR SELECT USING (get_user_role() = 'moderator');` Two policies OR-combine in PostgreSQL. Minimal blast radius.
- **Fix B**: Widen existing policy with OR clause. Calls `get_user_role()` on every employee SELECT for all authenticated users.
- **Decision**: FIXED via Fix A — follow-up migration to add `employees_select_moderator_all` policy
