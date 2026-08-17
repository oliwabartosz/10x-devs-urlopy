<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Details Subcards — Phase 2

- **Plan**: context/changes/details-subcards/plan.md
- **Scope**: Phase 2 of 3
- **Date**: 2026-06-01
- **Verdict**: APPROVED
- **Findings**: 0 critical · 0 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING (unplanned index.ts extras, user-approved) |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Note: False Positive Dismissed

Agent 2 raised a CRITICAL about the 90-day span check using the bumped `to` value. Verified by hand: a 90-day inclusive range produces `spanMs = 90 days`; `90 > 90` is false → passes. Effective limit is exactly 90 inclusive days as stated. Finding dismissed.

## Findings

### F1 — year= silently wins when both year= and from=/to= are present

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:36-37
- **Detail**: When both `?year=` and `?from=&to=` are supplied, year-mode wins silently. Ambiguous API contract.
- **Fix**: Return 400 if both year and from/to are present.
- **Decision**: FIXED — added guard returning 400 "Provide year=YYYY or from=YYYY-MM-DD&to=YYYY-MM-DD, not both"

### F2 — Year+1 arithmetic uses unpadded string

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:67
- **Detail**: `String(Number(year) + 1)` produces a 3-digit year for years < 1000, silently mis-querying Supabase. Theoretical for an HR app.
- **Fix**: `(parseInt(year, 10) + 1).toString().padStart(4, "0")`
- **Decision**: FIXED

### F3 — initialSubcard silently dropped in stub

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/absence/AbsenceDetailsSubcards.tsx:14
- **Detail**: `initialSubcard` is excluded from destructuring in the stub. Expected Phase 2 behavior — Phase 3 replaces the entire function body.
- **Fix**: No action — resolved by Phase 3.
- **Decision**: SKIPPED
