<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Monthly Grid — Own Absence CRUD

- **Plan**: `context/changes/monthly-grid-own-absence/plan.md`
- **Scope**: Phase 2 of 4
- **Date**: 2026-05-29
- **Verdict**: APPROVED (post-triage fixes applied)
- **Findings**: 0 critical · 3 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS (all fixed) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — UNIQUE violation returns raw DB message instead of 409

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:60–62
- **Detail**: UNIQUE (employee_id, date) violation (code 23505) returned raw DB message in Sonner toast. Should return 409 + Polish user-readable message.
- **Fix**: Added `if (result.error.code === "23505") return json({ error: "Masz już wpis nieobecności na ten dzień." }, 409)` before catch-all 400.
- **Decision**: FIXED

### F2 — employeeResult.error unchecked; DB failure returns misleading 403

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:31–40
- **Detail**: Only `!employeeResult.data` checked; DB errors during employee lookup returned 403 instead of 503.
- **Fix**: Added `if (employeeResult.error) return json({ error: "Database error" }, 503)` before data check.
- **Decision**: FIXED

### F3 — DELETE returns 204 when RLS silently blocks the operation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/[id].ts:83–93
- **Detail**: PostgREST DELETE with USING-only RLS silently skips blocked rows; client got misleading 204.
- **Fix**: Added `.select()` to delete call; check `data.length === 0` → return 404.
- **Decision**: FIXED

### F4 — Non-UUID `id` param leaks raw 22P02 DB error

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/[id].ts:28–31
- **Detail**: Non-UUID id param passed to Supabase returns raw PostgreSQL 22P02 error message, revealing UUID PK type.
- **Fix**: Added UUID regex guard on both PATCH and DELETE id params before DB call.
- **Decision**: FIXED

### F5 — AbsenceUpdate type defined but not used by PATCH handler

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/types.ts:42 vs src/pages/api/absences/[id].ts
- **Detail**: AbsenceUpdate type in types.ts not referenced by PATCH handler; two independent definitions could diverge.
- **Fix**: Imported AbsenceUpdate in [id].ts and typed `.update<AbsenceUpdate>()` call.
- **Decision**: FIXED
