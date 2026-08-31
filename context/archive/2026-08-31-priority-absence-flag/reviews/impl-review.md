<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Priority-Absence Flag (`[P]`)

- **Plan**: `context/changes/priority-absence-flag/plan.md`
- **Scope**: Phases 1–6 of 6 (full plan; 44/44 Progress rows complete)
- **Date**: 2026-08-31
- **Verdict**: APPROVED (triaged 2026-08-31 — 5 fixed, 1 skipped)
- **Findings**: 0 critical, 2 warnings, 4 observations

Every CRITICAL contract in the plan holds. The migration is a plain `ALTER TABLE` (CHECK and
unique index verified intact by replaying both migrations into a temp SQLite DB); bulk's
`onConflictDoUpdate.set` carries `is_priority`; guard ordering is `assertAbsenceTypeExists` →
priority guard on all three routes; `[P]` sits inside the absolutely-positioned cluster so the
120px `table-fixed` column cannot widen; and the PATCH CAS pin is present and covered by a
deterministic TOCTOU regression test. Both warnings are documentation/tooling, not code defects.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Verification performed

| Check                                      | Result                                                            |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `npm run lint`                             | 0 errors (10 pre-existing warnings in `packages/code-reviewer`)   |
| `npm run test`                             | 40 files, 469 tests passed                                        |
| `npm run build`                            | succeeds, artifact written                                        |
| `npx astro check`                          | 0 errors, 0 warnings                                              |
| `npm run db:generate` drift                | "No schema changes" — schema and migrations in sync               |
| `drizzle/meta/_journal.json`               | exactly one new `idx: 1` entry                                    |
| **2.2** guard-deletion mutation ×3 routes  | each neutralised guard fails `priority-guard.test.ts` (1 / 4 / 1) |
| **2.3** bulk `onConflictDoUpdate.set` drop | fails on the exact stale-flag assertion                           |
| **6.1** prettier on `prd.md`/`roadmap.md`  | clean                                                             |
| `npm run sample:xlsx`                      | 12 sheets; contains `[P] cały dzień`, `[P] priorytetowy`, `Priorytet: tak` |

## Findings

### F1 — "npm run lint" is not a type check, but all six phases gate on it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `package.json` (no `check` script), `.github/workflows/ci.yml`
- **Detail**: Every phase's Automated Verification reads "Type checking and linting pass:
  `npm run lint`". ESLint's type-checked rules do not perform structural assignability checking,
  so this criterion never verified the half it claims. Reproduced by deleting `is_priority` from
  the two fixtures: `npm run lint` reports 0 errors; `npx astro check` reports 2 errors naming
  `scripts/export-sample.ts:76` and `src/tests/lib/absence-range.test.ts:50`. This already
  escaped once — Phase 1 was signed off with rows 1.1–1.5 all `[x]`, and commit `7b1507a` then
  had to fix exactly those two files, its message stating "npm run lint (p1's stated gate) does
  not report a structural type mismatch; astro check does." `astro check` is in neither
  `package.json`'s scripts nor CI (lint → lint:sh → test:run → build). Current tree is clean.
- **Fix A ⭐ Recommended**: Add `"check": "astro check"` to `package.json` and a CI step between
  lint and test.
  - Strength: Closes the gap permanently and repo-wide rather than per-plan; the command already
    passes clean today, so the step goes green immediately.
  - Tradeoff: ~20s of CI; `new-design/support.js` and two unused `withBase` imports emit warnings
    (not errors), so the step passes but is noisy until tidied.
  - Confidence: HIGH — both commands were run against a real injected defect and the current tree.
  - Blind spot: Haven't confirmed `astro check` is stable on the CI runner's Node 24 without a
    prior sync (CI does run `npx astro sync`, so likely fine).
- **Fix B**: Leave tooling alone; treat it as a plan-wording defect only.
  - Strength: Zero risk to CI; plan phase blocks are read-only under `/10x-implement`.
  - Tradeoff: Leaves the repo with no type-check gate at all; the same class of escape recurs.
  - Confidence: MEDIUM — correct about the plan, does nothing about the cause.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `"check": "astro check"` added to `package.json`; a `Type check` step added to `.github/workflows/ci.yml` between `Lint shell` and `Test`. Verified: `npm run check` reports 0 errors, 0 warnings.

### F2 — Two requester overrides shipped unrecorded in Deviations

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `plan.md` (Deviations section); Progress rows 4.8, 4.9, 5.8
- **Detail**: Two deliberate requester calls during Phase 4 changed what shipped versus what the
  plan specifies, and neither was written down.
  1. Legend reads `[P] priorytetowy`, not `[P] = priorytetowy`. `AbsenceGrid.tsx:322-325` and
     `export-workbook.ts:218` both use the no-`=` form — correctly consistent with each other,
     which was the plan's stated goal. But `plan.md` specifies the `=` form in six places, and
     rows 4.8 / 5.8 are ticked `[x]` reading "The legend shows `[P] = priorytetowy`".
  2. The details marker moved inside the type chip and lost its pill styling. Plan Phase 4 §5
     asked for a `RoleBadge`-styled pill as a sibling in the flex-column stack;
     `AbsenceDetailsTable.tsx:238` ships a bare, unclassed `<span>[P]</span>` nested inside the
     type chip. Row 4.9 is ticked reading "the `[P]` pill next to the type chip".

  Both are self-documented in code comments and both are genuine product calls. The gap is that
  D1 (the roadmap move) got a Deviations entry and these did not, so the plan reads as
  authoritative for wording it no longer describes — and a future edit to either legend could
  reintroduce the `=` believing it was restoring the spec.
- **Fix**: Add a D2 entry to `plan.md`'s "Deviations from the plan" section recording both calls
  and their rationale, in the same shape as D1. Leave Progress row titles unchanged (the format
  contract forbids renaming them) — D2 is what reconciles them.
- **Decision**: FIXED — D2 entry added to `plan.md`'s Deviations section recording both the no-`=` legend wording and the inline details-chip placement, with rationale. Progress row titles left unchanged per the format contract.

### F3 — `is_priority` is required in bulk but defaulted in POST

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/absences/bulk.ts:60` vs `src/pages/api/absences/index.ts:130`
- **Detail**: `index.ts` uses `z.boolean().optional().default(false)` with the comment "Defaulted
  so a client that predates the flag keeps writing valid rows"; `bulk.ts` uses a bare
  `z.boolean()`. The same island drives both routes, so a stale open tab would get 201 from POST
  and 400 from bulk for the same omission. Deliberate and consistent with bulk's
  everything-required convention — flagged only because the stated backward-compat rationale does
  not hold across both routes.
- **Fix**: Mirror `.optional().default(false)` in `bulk.ts`, or drop the backward-compat clause
  from `index.ts`'s comment so the two routes' intent reads consistently.
- **Decision**: SKIPPED — deliberate; bulk's everything-required convention is documented at two call sites.

### F4 — The details view's `[P]` has no key and no accessible expansion

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/absence/AbsenceDetailsTable.tsx:238`
- **Detail**: The grid ships a legend and the XLSX ships a legend cell; the Details tab is a
  separate surface with neither, and the bare span announces as literal brackets to a screen
  reader.
- **Fix**: Add `title="priorytetowy"` plus an `sr-only` span, or a key pill in the Details header.
- **Decision**: FIXED — `[P]` in `AbsenceDetailsTable.tsx` is now `aria-hidden`, paired with an `sr-only` "priorytetowy" twin and a `title` for sighted hover, since this surface carries no legend.

### F5 — `dashboard.astro`'s select duplicates `absenceListColumns` by hand

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/pages/dashboard.astro:152`, `src/lib/absence-list.ts:33`
- **Detail**: This change had to add the column in both places. The in-place comment correctly
  names the failure mode ("a column added only there leaves the chip blank"), which is the right
  mitigation for now, but every future column needs the same paired edit.
- **Fix**: Have `dashboard.astro` spread `absenceListColumns` into its windowed select so a new
  column cannot land in only one. Out of scope for this change.
- **Decision**: FIXED — `dashboard.astro` now imports and spreads `absenceListColumns` instead of re-listing all twelve columns by hand. `absencesTable` is an alias of the same `absences` object, so the two selects were already column-identical; only the date window differs.

### F6 — Both drizzle snapshots still carry `"checkConstraints": {}`

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `drizzle/meta/0000_snapshot.json`, `drizzle/meta/0001_snapshot.json`
- **Detail**: drizzle-kit has no idea `absences_time_check` exists. Harmless here because the
  diff was an `ADD COLUMN`, but the next change that forces a table recreate drops the CHECK
  silently. Pre-existing and already noted in `AGENTS.md`; this change neither worsened nor
  mitigated it.
- **Fix**: Record as a recurring rule via `/10x-lesson` rather than a code fix.
- **Decision**: FIXED — added a `hand-written constraints survive the whole migration chain` suite to `src/tests/db/migrate-seed.test.ts`: asserts all four named CHECKs and `COLLATE NOCASE` are present in `sqlite_master` after the full chain, that the unique index survives, and that `absences_time_check` still *binds* (a full-day row with a time range is rejected, the null-time mirror accepted). Mutation-verified: stripping the CHECK from `0000_baseline.sql` fails both new tests.
