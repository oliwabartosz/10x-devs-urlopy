<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Bound partial-day absence ranges (max 8h, start from 06:00)

- **Plan**: `context/changes/absence-hours-window/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-17
- **Verdict**: NEEDS ATTENTION (all findings triaged and fixed)
- **Findings**: 0 critical, 3 warnings, 1 observation
- **Commits reviewed**: ee5678f, 23ebe24, 70ff594, 5246e09

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Verification re-run at review time

| Check | Result |
|---|---|
| `npm run test:run` | 238 passed (21 files) — **241 after fixes** |
| `src/tests/api/absences/hours-clamp.test.ts` | 9 passed against the real DB, not skipped — **11 after fixes** |
| `npx playwright test tests/e2e/absence-form-dialog.spec.ts` | 6 passed, incl. both new clamp tests |
| `npm run build` | Completed |
| `npm run lint` | 0 errors (10 warnings, all in `packages/code-reviewer`) |

Note on criterion 4.1: it reads "Migration applies cleanly: `npm run db:migrate`", but the purge
migration is deliberately absent from `meta/_journal.json`, so `db:migrate` can never run it. It
was applied via `psql` and recorded in `schema_migrations` — the correct handling per
`AGENTS.md:60-63`, which was updated to list this exact file. The criterion's wording was wrong
in the plan; the implementation did the right thing and documented it.

## What the review did not find

- **Zero plan drift** across all 11 artifacts. The three items the plan singled out as
  failure-prone all landed correctly: the floor→reject→cap ordering (`absence-hours.ts`, locked
  by the negative assertion in `absence-hours.test.ts`), the `isNull()` CAS branch (`[id].ts`),
  and the `"HH:MM"` / `"HH:MM:SS"` format mix — CAS pins compare in the DB's format, never the
  clamped form, so they cannot spuriously miss.
- **All eight "What We're NOT Doing" guardrails held**, including `src/db/schema.ts` untouched
  and no second DB CHECK.
- **No security, performance, or React-correctness defects.** The auth/ownership boundary is
  unchanged and sits before the clamp; the on-blur handler has no stale closure, no loop, no
  focus stealing, and does not interfere with the type-clearing path.
- The one unplanned file (`tests/e2e/e2e-rules.md`, 4 doc lines) removes the same stale comment
  the plan directed removing from the spec — in-scope in spirit.

## Findings

### F1 — PATCH names 06:00 for a range that has nothing to do with 06:00

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/absences/[id].ts:151-158`
- **Detail**: `AbsenceUpdateSchemaRefined` short-circuits on its first clause,
  `d.is_full_day === undefined || …`. So `PATCH {start_time: "20:00"}` against a stored
  `09:00:00–11:00:00` row passed zod with no `end > start` check at all. The clamp then saw
  `start=20:00, end=11:00:00`, hit `end <= flooredStart` and returned 400 naming the 06:00
  boundary — which the range never went near. This contradicted the module's own documented
  invariant (`absence-hours.ts:35-37`, `:67-68`), true for POST and bulk whose refines are
  unconditional, but not for PATCH. Before the change the same request produced the DB's 23514
  → the generic combination message, which was actually correct for it. No bad write occurred;
  the message regressed. Crafted-request path only — the dialog always sends the full field set.
- **Fix A ⭐ Recommended**: Split the reject reason — add `end-before-start` to
  `ClampAbsenceHoursResult`, returned when `end <= start` was already true pre-floor, and map it
  in all three routes to a message naming the ordering rule.
  - Strength: Fixes it at the source, so `bulk.ts` and any future caller inherit the correct
    message; keeps the module's invariant comment honest instead of narrowing it.
  - Tradeoff: Touches four files; each route grows a third branch in its rejection mapping.
  - Confidence: HIGH — the discriminated union already exists for exactly this (`invalid-time`).
  - Blind spot: Hadn't checked whether `bulk.ts` can reach the same short-circuit.
- **Fix B**: An explicit effective-range ordering check in the PATCH handler just before the clamp.
  - Strength: One file, one guard, reuses the existing message constant.
  - Tradeoff: Only fixes PATCH; the module's comment stays overstated and the next caller repeats
    the mistake.
  - Confidence: MED — zod has no access to `existing`, so the check has to live in the handler,
    splitting validation across two places.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A

  Added `ClampRejectionReason` with a new `end-before-start` member and a precondition test
  ahead of the floor in `clampAbsenceHours`. Placing the test *before* the floor is what makes
  `end-before-floor` provably scoped to `start < MIN_START_TIME`, so its message may honestly
  name that boundary — the module comment now states a guarantee rather than an assumption. The
  floor→reject→cap ordering of the two clamps is untouched. New unit test
  (`absence-hours.test.ts` — "distinguishes a range disordered on arrival from one the floor
  broke") and route test (`hours-clamp.test.ts` — "PATCH naming only one time reports the
  ordering rule, not the floor").

### F2 — A stored range ending at or before 06:00 blocked every PATCH of that row

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/absences/[id].ts:151-158`
- **Detail**: The clamp runs on the *effective* range, so `PATCH {comment: "x"}` — touching
  neither time — resolved both times from `existing` and clamped them. For a stored
  `01:22:00–03:22:00` row that clamp rejects, and the 400 blocked the write, putting the row's
  comment, substitute and date out of reach of the API. Only rows with `end <= 06:00` were
  affected; `05:00–13:00` floors cleanly. No such row can be created any more — all three write
  paths clamp — so the exposure was an already-provisioned environment that skipped the purge.
  Of the two purged demo rows, `01:14–06:14` clamps fine and `01:22–03:22` did not, which is
  likely why manual criterion 2.8 passed. The behaviour falsified a claim documented in two
  places: the purge migration header (`:16-18`) and `plan.md:48-50`, both stating that an
  un-purged copy "stays editable".
- **Fix A ⭐ Recommended**: Skip the clamp when the body patches neither time field and the
  stored range is unclampable — leave the legacy range alone rather than blocking an unrelated
  write. Add the regression test.
  - Strength: Makes the documented invariant true rather than aspirational; matches the change's
    own philosophy (correct silently, never block).
  - Tradeoff: A legacy row can survive an edit still out of window — but it existed already.
  - Confidence: HIGH — the `omitted` snapshot already carries exactly what the condition needs.
  - Blind spot: Haven't traced whether the statistics/balance islands assume every stored range
    is in-window.
- **Fix B**: Keep the blocking behavior; correct the migration header, `plan.md` and
  `AGENTS.md:63` to say the purge IS required wherever these rows exist.
  - Strength: Zero code risk on an already-applied migration; the rows are gone in production.
  - Tradeoff: Leaves a real API dead-end for anyone restoring a backup or old snapshot.
  - Confidence: MED — documents a wart rather than removing one.
  - Blind spot: The file on disk would no longer match what was executed.
- **Decision**: FIXED via Fix A

  A rejection now returns 400 only when the body supplied a time the caller can correct
  (`!omitted.start_time || !omitted.end_time`). When the body patches neither, the stored range
  is left exactly as read and the rest of the patch lands; the CAS pins still hold both columns
  to their read values. The migration header's and the plan's "stays editable" claim is now true
  as written, so neither needed correcting. Regression test: "PATCH of an unrelated field on an
  unclampable legacy row still lands", which also asserts that supplying a correctable time
  still rejects.

### F3 — END_BEFORE_FLOOR_ERROR hand-synchronised across three routes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/absences/index.ts:26`, `[id].ts:18`, `bulk.ts:38`
- **Detail**: The same Polish sentence was declared verbatim in three routes, each with a "kept
  in step with the other route" comment. The repo's own precedent points the other way:
  `PARTIAL_DAY_TYPE_NAMES` lives in the dependency-free module and each route interpolates it.
  The message already interpolated `MIN_START_TIME` from `absence-hours.ts`. The F1 fix added a
  second such constant to each route, making it six hand-synced copies.
- **Fix**: Export the messages from `src/lib/absence-hours.ts` and import them in all three
  routes, deleting the sync comments.
- **Decision**: FIXED

  Went one step further than a bare constant: added `clampRejectionMessage(reason)` to
  `absence-hours.ts`, a total switch over `ClampRejectionReason`. All three routes collapse to
  `return json({ error: clampRejectionMessage(clamped.reason) }, 400)` — six duplicated
  constants and three nested ternaries removed. A future reason added to the union is now a type
  error at one place instead of silently falling through to "Nieprawidłowy format godziny." in
  three.

### F4 — Route test asserts over all employee rows, not its own date

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/tests/api/absences/hours-clamp.test.ts:116-117`
- **Detail**: `expect(rows).toHaveLength(0)` selected every row for `testEmployeeId`, so it only
  held because the preceding test deleted its insert. Any test added above it that leaves a row
  false-fails this one, reporting the failure as "rejected POST must not have inserted a row" —
  pointing at the wrong code.
- **Fix**: Scope the select to this test's own date.
- **Decision**: FIXED — `where(and(eq(employee_id, …), eq(absences.date, "2026-04-03")))`, with a
  comment recording why the bare employee filter was wrong.

## Post-fix verification

| Check | Result |
|---|---|
| `npm run test:run` | 241 passed (21 files) |
| `hours-clamp.test.ts` | 11 passed against the real DB |
| `npx playwright test tests/e2e/absence-form-dialog.spec.ts` | 6 passed |
| `npm run build` | Completed |
| `npm run lint` | 0 errors |

Files touched by the fixes:

- `src/lib/absence-hours.ts`
- `src/pages/api/absences/index.ts`
- `src/pages/api/absences/[id].ts`
- `src/pages/api/absences/bulk.ts`
- `src/tests/lib/absence-hours.test.ts`
- `src/tests/api/absences/hours-clamp.test.ts`

`bulk.ts` belongs to the later `grid-multicheck` change, not to this plan; it was touched because
it is the third caller of the shared clamp and F1/F3 are fixed at the source.
