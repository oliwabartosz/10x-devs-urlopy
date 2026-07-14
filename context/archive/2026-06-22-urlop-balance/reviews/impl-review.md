<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Urlop Balance Tracker

- **Plan**: context/changes/urlop-balance/plan.md
- **Scope**: Full plan (Phases 1–4 of 4)
- **Date**: 2026-07-14
- **Verdict**: NEEDS ATTENTION → RESOLVED (all 5 findings fixed in triage)
- **Findings**: 0 critical, 2 warnings, 3 observations — all FIXED
- **Post-triage note**: F1's RLS migration (`20260714114608_holiday_balances_rls.sql`) still needs applying to the prod DB.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — holiday_balances table has no RLS enabled

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260713124938_premium_brother_voodoo.sql
- **Detail**: Every pre-existing table (employees, absence_types, absences) enables RLS with granular per-op/per-role policies (20260526000001_schema.sql:90-157); CLAUDE.md requires RLS on every new table. This migration adds the table + FK + CHECKs but never `ENABLE ROW LEVEL SECURITY` nor any policy. No runtime effect (app path uses a service-role pooler that bypasses RLS), but the table is the only one exposed if the anon/authenticated key ever reaches it.
- **Fix**: Add a follow-up migration enabling RLS + policies mirroring the `absences` table (authenticated SELECT; write policies). Restores defense-in-depth without touching app code.
  - Strength: Matches sibling tables and the explicit CLAUDE.md rule; app code unchanged.
  - Tradeoff: New migration to author + apply to prod DB.
  - Confidence: HIGH — direct precedent in 20260526000001_schema.sql.
  - Blind spot: Exact policy set (which roles get write) should mirror the balance "both roles edit any" design.
- **Decision**: FIXED — authored migration 20260714114608_holiday_balances_rls.sql (enables RLS + policies). Needs applying to prod DB.

### F2 — Plan's "What We're NOT Doing" still forbids a DELETE endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/urlop-balance/plan.md (What We're NOT Doing)
- **Detail**: The guardrail list still reads "Not adding a DELETE endpoint for balances in v1", which the newly added Phase 4 directly contradicts. Stale guardrail — future reviews using the plan as ground truth would flag Phase 4 as scope creep.
- **Fix**: Update that bullet to reflect Phase 4 (DELETE now in scope).
- **Decision**: FIXED — updated the 'What We're NOT Doing' bullet to mark DELETE superseded by Phase 4.

### F3 — POST builds the response view inside the write try block

- **Severity**: 📌 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/pages/api/holiday-balances/index.ts:190-198
- **Detail**: buildBalanceView (reads absence_types + absences) sits in the same try as the upsert. If that read throws after the upsert commits, the catch runs extractPgErrorCode and may return 404/400 as if the WRITE failed — the row is actually saved. Client shows an error toast then reloads to correct data; impact low but status misleads.
- **Fix**: Move the post-write view build into its own try (or return the saved row on read failure).
- **Decision**: FIXED — split post-write buildBalanceView into its own try; degraded 200 on read failure.

### F4 — Dashboard fetches the balance sequentially, outside Promise.all

- **Severity**: 📌 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: src/pages/dashboard.astro:136-141
- **Detail**: Three grid queries run in parallel (Promise.all, :98-133), but the balance row + buildBalanceView (2 more queries) run serially afterward — ~3 extra serial round-trips on page render. Functionally fine.
- **Fix**: Fold the balance-row select into the Promise.all batch.
- **Decision**: FIXED — folded the balance-row select into the dashboard Promise.all batch.

### F5 — HolidayBalanceCard takes a full currentEmployee but uses only .id

- **Severity**: 📌 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/holiday/HolidayBalanceCard.tsx:8,64
- **Detail**: Prop type is Pick<Employee,"id"|"first_name"|"last_name"|"role"> but only currentEmployee.id is consumed. The Astro-lookup lesson is respected — this is just an over-broad prop.
- **Fix**: Pass employeeId={currentEmployee.id} (a string) instead of the object.
- **Decision**: FIXED — narrowed the card prop to employeeId: string; updated the dashboard call site.
