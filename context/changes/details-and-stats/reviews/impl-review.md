<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Details Table & Statistics

- **Plan**: context/changes/details-and-stats/plan.md
- **Scope**: All phases (1–4)
- **Date**: 2026-05-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 3 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — GET /api/absences missing employee-record gate

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:14–46
- **Detail**: POST checks that the requesting user has an employee record before proceeding. GET only checks context.locals.user. An authenticated user with no employee record (signed up but not yet onboarded) can call GET /api/absences?year=2026 and receive the full year of all employees' absences. The plan notes "GET endpoint inherits RLS automatically," which is true — but RLS grants SELECT to *all* authenticated users, meaning the DB-level gate lets unonboarded users through too.
- **Fix A ⭐ Recommended**: Add the employee-record gate to GET (match POST pattern)
  - Strength: Consistent with POST; unonboarded users can't read organisation data they haven't been provisioned into.
  - Tradeoff: Adds a DB round-trip per yearly-stats load; minor perf cost.
  - Confidence: MED — the plan didn't specify this, so it's an underdocumented requirement, not a clear bug.
  - Blind spot: Whether unonboarded-user read access was intentionally permitted.
- **Fix B**: Accept and document as intentional
  - Strength: Zero perf cost; keeps the code simple; plan explicitly cited RLS as the access-control layer.
  - Tradeoff: Unonboarded users can read all absence data if they discover the endpoint.
  - Confidence: MED — only justified if there's a deliberate reason to allow this.
  - Blind spot: None.
- **Decision**: FIXED via Fix A (employee-record gate added to GET handler)

### F2 — AbsenceStats useEffect has no AbortController

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceStats.tsx:136
- **Detail**: The fetch in useEffect has no abort controller. If the component unmounts while the request is in flight, the .then() callbacks still call setYearlyAbsences / setLoading on a dead component. In React strict mode's double-invocation this fires two simultaneous requests with no cancellation.
- **Fix**: Add an AbortController tied to the effect cleanup. In the catch, guard with `if (err instanceof Error && err.name === "AbortError") return;` before calling setError.
- **Decision**: FIXED (AbortController added; cleanup returns block-body arrow)

### F3 — AbsenceDetailsTable created_at sort/display lacks null guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceDetailsTable.tsx:48, 170
- **Detail**: Sort comparator calls a.created_at.localeCompare(b.created_at) and display calls absence.created_at.slice(0, 10) with no null guard. Safe with current typed data, but a row without created_at would crash the entire sorted render with no user-visible error.
- **Fix**: Add `?? ""` fallbacks: `(a.created_at ?? "").localeCompare(b.created_at ?? "")` at line 48 and `(absence.created_at ?? "").slice(0, 10)` at line 170.
- **Decision**: SKIPPED — `no-unnecessary-condition` lint rule disallows `?? ""` on a `string` (non-nullable) field; the TypeScript type guarantee is the enforced guard in this codebase

### F4 — POST handler returns 400 on generic DB error

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:110
- **Detail**: The fallback after checking for known Postgres codes (23505, 23514) returns status 400 (client error). A generic DB failure is a server fault.
- **Fix**: Change `json({ error: "Database error" }, 400)` to status 500.
- **Decision**: FIXED (changed to status 500)

### F5 — Date interval style inconsistent between dashboard and GET handler

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/absences/index.ts:37–38
- **Detail**: dashboard.astro uses half-open interval (.gte/.lt with firstDayNextMonth). GET handler uses closed interval (.gte/.lte with "YYYY-12-31"). Both safe on DATE column today; inconsistency is a footgun if column type ever changes.
- **Fix**: Standardise GET handler to half-open: `.gte("date", \`${year}-01-01\`).lt("date", \`${year + 1}-01-01\`)`
- **Decision**: FIXED (switched to half-open interval with `${year + 1}-01-01`)

### F6 — AbsenceStats fetch error body assumes JSON

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceStats.tsx:138
- **Detail**: When response is not ok, code chains r.json() to parse error body. Non-JSON responses (e.g. Cloudflare 524 HTML timeout) cause .json() itself to throw, giving the user a generic message. UX impact is minimal since the fallback error message is shown regardless.
- **Fix**: Use r.text().then(t => { try { throw new Error(JSON.parse(t).error); } catch { throw new Error("Błąd serwera"); } }) or simply throw new Error(String(r.status)).
- **Decision**: FIXED (replaced nested r.json() with throw new Error(String(r.status)))
