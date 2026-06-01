<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Details Subcards — Phase 3

- **Plan**: context/changes/details-subcards/plan.md
- **Scope**: Phase 3 of 3
- **Date**: 2026-06-01
- **Verdict**: APPROVED
- **Findings**: 0 critical · 0 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING (3 unplanned extras: isoDate helper, table-fixed, month heading — all benign/user-approved) |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — from > to guard inconsistently omits T00:00:00Z suffix

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:70
- **Detail**: `new Date(from)` and `new Date(toParsed.data)` lack the UTC suffix used everywhere else in the handler. Safe on V8/Cloudflare Workers, but inconsistent.
- **Fix**: `new Date(from + "T00:00:00Z") > new Date(toParsed.data + "T00:00:00Z")`
- **Decision**: FIXED

### F2 — weekRange freezes at module load; silently stale after midnight

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceDetailsSubcards.tsx:43
- **Detail**: `const weekRange = getWeekRange()` runs once at page load. A user who leaves the tab open past midnight sees stale today/this-week data without a refresh. Same trade-off as AbsenceStats with year. Known, acceptable limitation.
- **Fix**: Move into `useMemo(() => getWeekRange(), [])` if reactivity is ever needed.
- **Decision**: SKIPPED

### F3 — AbsenceDetailsTable empty-state says "w tym miesiącu" for Today/Yearly

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/absence/AbsenceDetailsTable.tsx:147
- **Detail**: Empty-state "Brak nieobecności w tym miesiącu" misleading when used for Today/Yearly subcards.
- **Fix**: Added optional `emptyLabel` prop (default "Brak nieobecności"); Monthly subcard passes "Brak nieobecności w tym miesiącu".
- **Decision**: FIXED
