<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Drizzle Migration

- **Plan**: context/changes/drizzle-migration/plan.md
- **Scope**: Phase 2 of 5
- **Date**: 2026-06-02
- **Verdict**: REJECTED → fixed to APPROVED after triage
- **Findings**: 2 critical  3 warnings  1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL (2 critical) |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — PATCH has no ownership check

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality / Plan Adherence
- **Location**: src/pages/api/absences/[id].ts:54–58
- **Detail**: The old handler relied on absences_update RLS policy for ownership enforcement. Service role bypasses all RLS. No app-level check was added. Any authenticated user could PATCH any absence by UUID. The plan stated "existing handler checks enforce ownership" — this was incorrect; the old handlers had no app-level ownership logic.
- **Fix**: Added employee lookup (same pattern as POST) before db.update(). Moderators bypass the employee_id filter; regular employees get `and(eq(absences.id, id), eq(absences.employee_id, employeeRow.id))`.
- **Decision**: FIXED

### F2 — DELETE has no ownership check

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/[id].ts:92–97
- **Detail**: Same root cause as F1. absences_delete RLS policy enforced ownership; service role bypasses it. Any authenticated user could delete any absence by UUID.
- **Fix**: Same employee lookup + role branch applied to DELETE.
- **Decision**: FIXED

### F3 — PATCH missing 23505 handler

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/[id].ts (PATCH catch block)
- **Detail**: PATCH allows changing the date field. Unique constraint on (employee_id, date) raises 23505 on conflict. Catch block fell through to generic 400 instead of 409. POST handled this correctly.
- **Fix**: Added `if (code === "23505") return json({ error: "You already have an absence entry for this day." }, 409);` to PATCH catch block.
- **Decision**: FIXED

### F4 — DELETE error extraction missing .cause.code

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/absences/[id].ts (DELETE catch block)
- **Detail**: DELETE used `const pgError = err as { code?: string }` reading only `pgError.code` directly. With postgres-js driver, PG error codes land on `err.cause.code`. The 42501 guard never fired.
- **Fix**: Replaced with the established two-line `e.code ?? e.cause?.code` pattern matching PATCH and POST.
- **Decision**: FIXED

### F5 — PATCH and DELETE fallthrough return 400 instead of 500

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/absences/[id].ts:78 and :101
- **Detail**: Both PATCH and DELETE catch fallthrough returned HTTP 400 (Bad Request) for unexpected DB errors. A database error is never the client's fault.
- **Fix**: Resolved as part of F3 and F4 triage — both fallthrough lines changed to 500.
- **Decision**: FIXED

### F6 — Missing export const prerender = false (pre-existing)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/absences/[id].ts:1
- **Detail**: Pre-existing gap not introduced by Phase 2. CLAUDE.md convention requires this export on all API routes.
- **Fix**: Added `export const prerender = false;` as first line.
- **Decision**: FIXED
