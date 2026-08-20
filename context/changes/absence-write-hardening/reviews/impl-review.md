<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Absence write hardening

- **Plan**: `context/changes/absence-write-hardening/plan.md`
- **Scope**: Phases 1–3 of 3 (all complete)
- **Date**: 2026-08-20
- **Verdict**: NEEDS ATTENTION (all findings triaged and fixed the same day)
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated verification (re-run at review time)

| Check | Result |
|---|---|
| `npm run lint` | 0 errors (10 pre-existing `no-console` warnings in `packages/code-reviewer`) |
| `npx astro check` | 0 errors across 134 files |
| `npm run build` | Complete |
| `npm run test:run` | 23 files / 258 tests passed, **0 skipped** (266 after this review's fixes) |

Manual Progress rows carry specific evidence (row counts, fixture UUIDs, the exact
`expected 201 to be 400` at `bulk.test.ts:134`) rather than rubber stamps.

## Scope

Nine files changed, every one named by the plan; no unplanned source files. All eight
"What We're NOT Doing" guardrails verified intact — read side untouched, no migration,
soft-deleted substitutes still allowed, `employee-target-guard.ts` and the five pre-existing
routes absent from the diff, no E2E specs added, non-moderator contract unchanged.

## Findings

### F1 — PATCH can still name the admin as a substitute

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/absences/[id].ts:24`, `:187`
- **Detail**: `plan-brief.md`'s Desired End State says the admin is refused "whether a moderator
  targets it via `employee_id`, or the admin writes its own column, or anyone names it as a
  substitute." The third clause was not met. `AbsenceUpdateSchema:24` accepts
  `substitute_employee_id: z.uuid().nullable()`, the file contained zero `is_system` references,
  and `db.update(absences).set(parsed.data)` wrote the field straight through. POST an ordinary
  absence, then PATCH its substitute to the admin's UUID, and you land exactly the row
  `is-system-guard.test.ts:155-166` refuses on POST — with the same "Brak zastępstwa"
  misrendering. `plan.md:95-97` scopes PATCH out on the grounds that it "cannot retarget an
  absence to another employee, so [it] cannot *create* an admin row" — true for the target vector,
  silent on the substitute vector.
- **Fix A ⭐ Recommended**: Extract gate 4 into `assertSubstituteAllowed(db, substituteId, route)`
  and call it from PATCH when the field is a supplied non-null value.
  - Strength: One lookup, only when the field is patched; reuses the existing guard rather than
    adding a fourth copy of the decision — the exact failure mode this change exists to stop.
  - Tradeoff: Widens the change past its stated scope; PATCH has no route-level suite.
  - Confidence: HIGH — the gate-4 body had no POST-specific coupling.
  - Blind spot: The 2026-08-18 production probe predates this vector being understood.
- **Fix B**: Leave PATCH open, correct the scope-out bullet, open a follow-up.
  - Strength: Keeps the change at its planned size; the vector needs the admin's UUID, which no
    filtered read surface emits.
  - Tradeoff: Ships with a stated end state it does not meet.
  - Confidence: MEDIUM.
  - Blind spot: A regular employee can also PATCH their own row's substitute — not moderator-only.
- **Decision**: FIXED via Fix A. `assertSubstituteAllowed` exported from
  `src/lib/absence-write-target.ts`; called from `src/pages/api/absences/[id].ts` after the
  existing 404 so the 404-before-403 order holds.

### F2 — The plan's #1 "Critical Implementation Detail" has no test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/tests/api/absences/is-system-guard.test.ts` (whole suite)
- **Detail**: `plan.md:134-136` opens Critical Implementation Details with "the `is_system`
  rejection must come after the not-found check, not before… Reversing it would answer 403 for a
  nonexistent id." Nothing tested it — `grep -n "404\|422" src/tests/api/absences/*.test.ts`
  returned zero hits across every absence suite. Three contract boundaries the guard's own doc
  comment asserts as deliberate were unproven: the 404-before-403 ordering, the soft-deleted-target
  404, and the "a nonexistent substitute is deliberately NOT checked — the FK maps it to 422"
  carve-out that separates gate 4 from over-reach. A future edit reordering the gates, or adding a
  `deleted_at` filter to the substitute lookup, would have passed all 258 tests. This matters more
  than its size: the change's own thesis is that "nothing tested either route's rejection paths, so
  nothing objected" (`plan.md:14-15`).
- **Fix**: Add boundary cases under the existing `describe.each(ROUTES)`.
- **Decision**: FIXED. Four cases added per route (8 total, suite 8 → 16 tests): nonexistent
  `employee_id` → 404; soft-deleted `employee_id` → 404; nonexistent `substitute_employee_id` →
  422 `"Nie znaleziono pracownika na zastępstwo."`; soft-deleted substitute → 201 and stored. New
  `deletedEmployeeId` fixture, torn down in `afterAll`. Dates spill into early June 2026 (verified
  unclaimed by any suite) because May's weekdays were exhausted.

### F3 — A third live copy of the false claim the new lesson is about

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/pages/api/holiday-balances/index.ts:173`
- **Detail**: Phase 3 added a `lessons.md` entry citing two instances of an unverified repo-wide
  claim. There was a third, in shipped source: `// This route was the last mutation path missing
  the guard.` Same claim, same falsity — and *not* in `plan.md:105-106`'s deferred list, which
  names `test-plan.md:97`, its Phase 2 status, its `TBD` §6.3, and `is-system-guard.test.ts:10`,
  but not this line. Unlisted rather than knowingly left. It was false twice over: this change
  added the guard those routes were claimed to be last for.
- **Fix**: Replace with a statement of the invariant carrying no repo-wide quantifier.
- **Decision**: FIXED. Rewritten to assert the invariant locally and to name the earlier false
  claim as an explicit warning, pointing at `lessons.md`. `is-system-guard.test.ts:10` deliberately
  left as-is — the lesson quotes it verbatim, so changing it would break the citation.

### F4 — Over-cap dates escape afterEach cleanup

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/tests/api/absences/bulk.test.ts:42-51`, `:56-59`
- **Detail**: `OVER_CAP_RUN` (Jul/Aug 2026) was excluded from `SUITE_DATES`, so the `afterEach`
  delete could not reach those dates. Harmless today — the test asserts 400 and nothing is written,
  and `teardownTestEmployee` still sweeps them — but if `MAX_BULK_DATES` ever rises, that test
  writes 32 rows the per-test cleanup misses, creating a mid-run cross-test collision.
- **Fix**: Fold `...OVER_CAP_RUN` into `SUITE_DATES`.
- **Decision**: FIXED. Declaration order swapped so `OVER_CAP_RUN` precedes `SUITE_DATES`, with a
  comment stating why a write-nothing run is still folded in.

### F5 — The guard does not validate its own id inputs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/absence-write-target.ts:63`, `:76`, `:100`
- **Detail**: Took `employeeId?: string` / `substituteEmployeeId: string | null` as bare strings and
  fed them to `eq(employees.id, …)`. Its named precedent `employee-target-guard.ts:70-73` runs
  `UUIDSchema.safeParse` → 400 first. Both current callers validate via `z.uuid().nullable()`
  (`index.ts:150`, `bulk.ts:62` — required, so never `undefined`), so there was no live bug and no
  injection risk. But a third caller passing an unvalidated string yields PG 22P02 → the catch
  blocks → 503 `"Błąd bazy danych."`, a caller error reported as a server outage — in a module
  whose whole purpose is that the next absence write path cannot inherit a mistake.
- **Fix**: Parse both ids with `z.uuid()` inside the guard, 400 on failure.
- **Decision**: FIXED. `UUIDSchema` added; 400 `"Nieprawidłowy identyfikator pracownika."` and 400
  `"Nieprawidłowy identyfikator zastępstwa."` respectively. Unreachable from both current callers,
  so no behaviour change.

### F6 — change.md still reads `status: implementing`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/absence-write-hardening/change.md:4`
- **Detail**: Every Progress box (`plan.md:444-480`) is checked and SHA-stamped.
- **Fix**: Stamp the status.
- **Decision**: FIXED — set to `impl_reviewed` when this report was saved.

### F7 — One rejection case skips the no-write assertion

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/tests/api/absences/bulk.test.ts:184-190`
- **Detail**: `plan.md:288` says "Every rejection case asserts nothing was written." The
  invalid-calendar-date case (`2026-02-31` → 400) was the only one without it.
- **Fix**: Add the `storedFor`/`toHaveLength(0)` pair its siblings use.
- **Decision**: FIXED as a comment, not an assertion — and the attempt is what established why.
  Adding the assertion made the test fail: `storedFor` binds the date as a Postgres `date`
  parameter, and Postgres rejects `2026-02-31` outright (22008, "date/time field value out of
  range"), so the *query* errors before it can answer. The omission was therefore forced, not an
  oversight. The case now carries a comment recording that, with the 22008 refusal cited as the
  proof no such row can exist.

## Verified clean

Checked directly and found nothing wrong with:

- **Union discrimination** — `instanceof Response` narrows correctly at both call sites, both
  `return` rather than fall through, and every guard early-return is a `return json(...)`.
  `AbsenceWriteTarget` is a plain object literal, never a `Response`. Same realm in workerd and
  vitest, so no cross-realm hazard.
- **Guard bypass** — the only non-test writers of `absences` are `index.ts:243`, `bulk.ts:214`,
  and `[id].ts:187` (the last being F1, now closed). `is_system` is `notNull().default(false)`, so
  `isProtectedAdmin` has no null-truthiness trap.
- **Production-data safety in the new suites** — every delete is doubly scoped by fixture UUID
  **and** `SUITE_DATES`; fixture ids are minted in `beforeAll`, so a live account can never match.
  The 13 real May-2026 UI rows are unreachable. Suite date runs are disjoint.
- **Fixture discipline** — `is_system` unflipped at `is-system-guard.test.ts:121` before all
  teardowns, matching `holiday-balances/delete.test.ts:63-64`.
- **Query counts** — bulk stays at a fixed round-trip count regardless of date count; the two
  `is_system` checks ride on selects that already ran; the substitute lookup is issued only when a
  substitute is supplied.
- **Dead code** — none; `tsc` and `eslint` clean, every remaining import still used.

## Post-triage verification

| Check | Result |
|---|---|
| `npm run lint` | 0 errors |
| `npx astro check` | 0 errors |
| `npm run test:run` | 23 files / **266 tests passed**, 0 skipped |
| `npm run build` | Complete |
