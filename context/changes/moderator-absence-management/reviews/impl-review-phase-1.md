<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Moderator Absence Management

- **Plan**: `context/changes/moderator-absence-management/plan.md`
- **Scope**: Phase 1 of 4
- **Date**: 2026-05-31
- **Verdict**: APPROVED (post-triage)
- **Findings**: 0 critical  2 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — DB error on moderator target-employee query returns 404

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:118–128
- **Detail**: The moderator branch checked only `!targetResult.data` but never `targetResult.error`. A real DB error (network, permission, etc.) fell through to the 404 branch, silently swallowing the error. Every other lookup in this file uses the two-stage check.
- **Fix**: Added two-stage check: `error?.code === "PGRST116" || !data` → 404, then `error` → 503.
- **Decision**: FIXED

### F2 — targetEmployeeId set from caller input, not DB-confirmed value

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:127
- **Detail**: After verifying target employee exists, code assigned `targetEmployeeId = requestedEmployeeId` (caller-supplied) instead of `targetResult.data.id` (DB-confirmed). Values are identical but using caller input is fragile security hygiene.
- **Fix**: Resolved by F1 fix — changed assignment to `targetResult.data.id`.
- **Decision**: FIXED via F1

### F3 — POST missing 42501/Forbidden guard (pattern gap vs. sibling)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/absences/index.ts (insert error block)
- **Detail**: PATCH and DELETE in `[id].ts` both map `42501` to 403. POST had no such guard — an RLS block on insert returned a generic 500.
- **Fix**: Added `if (result.error.code === "42501") return json({ error: "Forbidden" }, 403);` as the first case in the insert error block.
- **Decision**: FIXED

### F4 — GET handler has no app-level scope filter (pre-existing)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:47–52
- **Detail**: GET returns all absences with no `employee_id` filter. Intentional — `absences_select` RLS (migration 20260529) opens reads to all authenticated users for the team grid. Pre-existing.
- **Fix**: Added a two-line comment above the SELECT explaining the open policy is intentional.
- **Decision**: FIXED

### F5 — 23505 error message mixes Polish and English (pre-existing)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:141
- **Detail**: `"Masz już wpis nieobecności na ten dzień."` was Polish while all other error strings are English.
- **Fix**: Changed to `"You already have an absence entry for this day."` — English, consistent with other messages.
- **Decision**: FIXED
