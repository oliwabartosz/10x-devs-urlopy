<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Moderator XLSX Export of the Yearly Absence Grid

- **Plan**: `context/changes/export-grid-to-xlsx/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-24
- **Verdict**: NEEDS ATTENTION → **TRIAGED** (2026-08-25; all 8 findings fixed)
- **Findings**: 0 critical, 5 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | FAIL |

## Automated verification (re-run during this review)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | pass |
| `npm run lint` | pass (10 pre-existing warnings, all in `packages/code-reviewer`) |
| `npx vitest run` | 27 files, 355 tests, 0 skipped |
| `npm run sample:xlsx` | generates; `xl/comments1.xml`, `xl/drawings/vmlDrawing1.vml`, 12 worksheets, frozen `<pane>` all present |
| `npm run build` | succeeds; `hucre` isolated in `dist/client/_astro/xlsx.*.js`, 39.2 KiB gzip (plan predicted 39), absent from dashboard entry and dialog chunks |
| `grep -rn "25 MB" context/foundation/infrastructure.md` | no hits |
| `npx prettier --check` | **fails** on 4 files, all touched by this change |

## Findings

### F1 — Formatting criterion checked, but four files fail prettier

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `package.json:25`, `context/foundation/roadmap.md:41`
- **Detail**: Progress row 4.1 ("Formatting passes: `npm run format` — 45e19eb") is checked, but `npx prettier --check` fails on four files, all added or edited by this change: `package.json` (the `"sample:xlsx"` line is indented 2 spaces inside a 4-space block), `context/foundation/roadmap.md` (the S-24 table separator row), `plan-brief.md`, `research.md`. The criterion is also unfalsifiable as written — `npm run format` is `prettier --write .`, which exits 0 whether or not it rewrote anything.
- **Fix**: `npx prettier --write package.json context/foundation/roadmap.md context/changes/export-grid-to-xlsx/*.md`, and change the criterion to `npx prettier --check .` so it can actually fail.
- **Decision**: FIXED — four files formatted; criterion reworded to a scoped `npx prettier --check` at `plan.md:360` and Progress row 4.1. Repo-wide `--check .` was rejected as a criterion: 279 files fail, 275 of them pre-existing and unrelated.

### F2 — Frozen-header criterion checked, but only the date column is frozen

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `src/lib/export-workbook.ts:26`, `plan.md` Progress row 2.11
- **Detail**: `FREEZE_ROWS = 0`, not the 4 the Phase 1 §6 contract specifies. Confirmed against the generated file: every sheet emits `<pane xSplit="1" topLeftCell="B1" state="frozen"/>` with no `ySplit`, so scrolling down loses the header row. Progress row 2.11 — "Legend, header and date column stay frozen when scrolling — [x]" — asserts the opposite, as do the plan's Desired End State and §6 table. The change is deliberate and reasoned (the code comment explains top-anchored freezing would pin title + legend too) and is disclosed in commit `b74a23b`'s message, but nothing in `plan.md` records it.
- **Fix A ⭐ Recommended**: Correct the record — reword Progress row 2.11 to "date column stays frozen", and append a Deviations addendum to `plan.md` carrying `b74a23b`'s three-item list.
  - Strength: Keeps the shipped behaviour, chosen after actually opening the file in Excel and LibreOffice — better evidence than the plan's a-priori reasoning.
  - Tradeoff: Violates the repo's "phase blocks are read-only" convention unless the addendum sits outside the phase block; Progress rows are explicitly renameable-never.
  - Confidence: HIGH — the deviation is verified in the generated XML and already written down in the commit.
  - Blind spot: Whether a 31-day month is genuinely more readable without the header; the sample was not opened during this review.
- **Fix B**: Restore `freezeRows = 4` to match the plan and the checked box.
  - Strength: The plan's stated user value — "legend and header rows stay frozen while scrolling" — is delivered as specified.
  - Tradeoff: Reintroduces the 4-row frozen band the implementer rejected on sight; likely to be reverted again.
  - Confidence: MEDIUM — one-line change, but it overrides a judgement made with the file open.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Progress row 2.11 reworded to "The date column stays frozen when scrolling"; new `## Deviations from the plan` section in `plan.md` records D1–D4 from `b74a23b`.

### F3 — A cancelled export still downloads and still mutates dialog state

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/absence/AbsenceExportDialog.tsx:75-91`
- **Detail**: The fetch phase honours `controller.signal` correctly and distinguishes `AbortError` from a real failure. The generation phase that follows (`buildExportWorkbook` → dynamic import → `writeWorkbook` → `downloadWorkbook` → `setBusy(null)` → `setOpen(false)`) checks the signal nowhere. `onOpenChange(false)` fires on Escape or an outside click and is not blocked while busy — only the two footer buttons are `disabled`. Failure scenario: user clicks "Pobierz plik" for 2024; the fetch resolves and generation starts; user presses Escape; the dialog closes and abort fires, but generation continues and downloads `nieobecnosci-2024.xlsx` anyway. If they reopened and selected 2025 in the meantime, the stale run's `setOpen(false)` closes the dialog under them.
- **Fix**: Add `if (controller.signal.aborted) return;` after the dynamic import and again after `writeWorkbook` resolves.
- **Decision**: FIXED — two `if (controller.signal.aborted) return;` guards added after the dynamic import and after `writeWorkbook` resolves.

### F4 — hucre requires Node ≥ 24; the project pins 22.14.0

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `package.json:51`, `.nvmrc:1`, `.github/workflows/ci.yml:18,73`
- **Detail**: `hucre@1.1.0` declares `engines: { node: ">=24" }`. `.nvmrc` says `22.14.0` and both CI jobs use `node-version: 22`. There is no `.npmrc`, so engine-strict is off and `npm ci` only warns. CI stays green because nothing there executes hucre — the browser path is a dynamic import and the server build only type-imports. But `npm run sample:xlsx` does run it under local Node, and that harness is what Phase 2's verification rests on. The successful sample run during this review was on **Node v24.15.0**, i.e. off-`.nvmrc` — so criterion 2.4 has never been demonstrated on the Node version the repo pins. hucre is also a young, single-maintainer package (four releases, first published 2026-03-27, zero dependencies, no install scripts). The plan anticipated the bus-factor risk and mitigated it with the single-adapter design; the engine mismatch it did not anticipate.
- **Fix A ⭐ Recommended**: Bump `.nvmrc` and both `ci.yml` jobs to Node 24.
  - Strength: Aligns the declared toolchain with what actually works and with what the sample was verified on; Node 22 is already past its active-LTS peak.
  - Tradeoff: Touches CI for every job, not just this feature — worth a separate commit and a green run before merging.
  - Confidence: HIGH — the mismatch is verified from hucre's own `package.json` and the workflow file.
  - Blind spot: Whether any other dependency or the Cloudflare adapter constrains the repo to 22; the rest of the dependency tree's `engines` fields were not checked.
- **Fix B**: Keep Node 22, run `npm run sample:xlsx` on it to confirm hucre works, and record the result plus the engines mismatch.
  - Strength: No CI churn; the declared engines floor may be conservative rather than load-bearing.
  - Tradeoff: Leaves an undeclared-support dependency that any hucre patch release could break without warning.
  - Confidence: MEDIUM — depends entirely on what hucre uses Node 24 for, which was not read.
  - Blind spot: Same.
- **Decision**: FIXED via Fix A — `.nvmrc` → `24.15.0`, both `ci.yml` jobs → `node-version: 24`, `CLAUDE.md:46` and `AGENTS.md:101` updated. Blind spot cleared: no dependency in the tree declares an upper bound below 24. `npm run sample:xlsx` re-verified on the pinned version — 12 sheets, 28.7 KiB.

### F5 — Commit 5453a4b bundles four unplanned changes, one of which alters a public API's validation contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `src/lib/absence-list.ts`, `src/components/absence/AbsenceStats.tsx`, `src/pages/api/absences/{index,bulk,stats}.ts`
- **Detail**: No phase's Changes Required mentions any of these:
  - `src/lib/services/absence-list.ts` → `src/lib/absence-list.ts`, with a `json` helper de-duplicated out of three routes and `YearSchema` hoisted and narrowed from `\d{4}` to `[12]\d{3}`. That last one is a behaviour change on two live endpoints — `?year=0000` now returns 400 instead of reaching Postgres and raising 22008 as a 500. A genuine improvement, but shipped under an export plan.
  - `AbsenceStats.tsx` gains a `yearlyEmployees` prop. This is a real pre-existing bug: `dashboard.astro:176-183` windows a moderator's employee list to the browsed month, and `buildMatrix` sums only over the list it is handed — so a mid-year hire silently vanished from the *yearly* totals whenever a moderator browsed an earlier month.
  - `stats-scope.test.ts` gains two cases (an `is_system` caller on the non-moderator join arm; the year-zero 400).

  The commit message discloses all of it and explains why it could not be split — `dashboard.astro` carries both edits, and landing only the export half would push a main passing a prop `AbsenceStats` does not declare. The reasoning is sound and the work is good. The problem is that `plan.md`, the artefact a future review treats as ground truth, records none of it.
- **Fix**: Append an addendum to `plan.md` listing the four bundled changes and why they shipped here, so the next review does not re-flag them as unexplained diff.
  - Strength: Preserves work that is already tested and correct, and makes the `AbsenceStats` yearly-totals bug findable later — right now it exists only in a commit message.
  - Tradeoff: The plan becomes a partly-moving target; the alternative (splitting into a separate change folder retroactively) costs more than it returns now that it has landed.
  - Confidence: HIGH — every claim above is verified against the diff and `dashboard.astro`.
  - Blind spot: Whether the yearly-totals bug affected any figure a moderator has already acted on.
- **Decision**: FIXED — recorded as D5/D6 in `plan.md`, including the `YearSchema` contract change, the `AbsenceStats` yearly-totals bug, and an explicit note that the bug's blast radius on figures moderators already acted on was **not** verified.

### F6 — Phase 1 §6 contract is stale in four further ways

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/export-workbook.ts:95-116`, `:249`; `plan.md` Phase 1 §6
- **Detail**: Beyond F2's freeze change: `ExportCell` gained a `border?: boolean` field not in the interface; a full-day cell reads `"cały dzień"` rather than the specified `""`, and a comment is appended as a second wrapped line in the cell itself; the harness is `scripts/export-sample.ts` run via tsx, not the planned `.mjs` run via node (plain node cannot resolve the `@/` alias — this matches `seed-admin.ts` and `team-digest.ts`, so it is the better choice); and `exportYearOptions` uses a fixed 5-year floor rather than the earliest `created_at`, because every employee record was created the year the app shipped, which made back-filled years unreachable. All four are disclosed in commit messages, and all are improvements on the plan. Everything else in §3–§6 matches exactly — including the two traps most likely to be got wrong silently: `absenceNote` uses ungated `rawTimeRange` while cell text uses gated `cellTimeRange` (not swapped), and dates are built with `new Date(y, m-1, d)` with no ISO parsing anywhere. The Phase 1 §7 test list is fully covered, 60 assertions, none skipped.
- **Fix**: Fold these into the same `plan.md` addendum as F2/F5.
- **Decision**: FIXED — D2/D3/D4 covered by the F2 fix; the remaining `exportYearOptions` item recorded as D7. Corrected in the process: the 5-year floor is a `Math.min` against hire years, so the range still extends further back for an earlier hire — not a hard cap.

### F7 — src/lib/services/ is now a two-file remnant

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/absence-list.ts` vs `src/lib/services/`
- **Detail**: After the move, `src/lib/services/` holds only `absence-partial-day.ts` and `holiday-balance.ts`, while `src/lib/` holds ~25 modules including `absence-list.ts`, which composes Drizzle fragments and encodes role-visibility rules — the same character as the two that stayed. CLAUDE.md says helpers go in `src/lib/` "or `src/lib/services/` for extracted business logic" without a rule for choosing. The move follows the numerical majority, so it is not wrong; the directory just no longer explains itself.
- **Fix**: Add one line to CLAUDE.md/AGENTS.md stating the actual rule (e.g. `services/` = single-consumer extracted logic), or fold the two remaining files into `src/lib/` and drop the directory.
- **Decision**: FIXED — rule documented in `CLAUDE.md:41` and `AGENTS.md:27`. The rule found in the code, not invented: `services/` modules take a `Db` and execute queries; `absence-list.ts` states "no `createDb`, no query execution". Directory kept, no files moved.

### F8 — revokeObjectURL is not scheduled on a throwing path

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/export-xlsx.ts:84-97`
- **Detail**: `createObjectURL` runs, then five unguarded DOM calls, then the deferred revoke. If anything between them throws, the blob URL leaks for the tab's lifetime. Low probability — the deferred revoke itself is correct and its Safari rationale is right.
- **Fix**: Wrap the anchor block in `try/finally` so the `setTimeout` revoke is scheduled regardless.
- **Decision**: FIXED — anchor block wrapped in `try`, deferred revoke moved to `finally`.

## Cleared without finding

- **Server-side moderator gating** — `dashboard.astro:241-256` renders `AbsenceExportDialog` and its props only when `currentEmployee?.role === "moderator"`, evaluated before any HTML is sent. A non-moderator's page never contains the component or its props.
- **API scope** — `GET /api/absences?year=` is role-scoped but not moderator-gated; that is pre-existing, deliberate and documented ("Scope, not secrecy", `stats.ts:20-25`), and unchanged here. The export adds no new access boundary.
- **Formula injection** — `absence.comment` and employee names flow unescaped into cell text and notes, but hucre emits `<f>` only when `resolved.formula` is explicitly set, and `toCell()` never sets it. String values are always written as `inlineStr`/shared-string content, never auto-promoted from a leading `=`/`+`/`-`/`@`.
- **Performance** — `buildExportWorkbook` uses a `Map` keyed on `employee_id|date` for O(1) per-cell lookups; no O(n·m) scans. Bounded by `LIST_LIMIT = 5000` and the ~10-employee target scale.
- **Double-click** — the button is `disabled={busy !== null}` and `handleExport` aborts any prior controller before starting. The reachable race is cancel-then-restart (F3), not a double-click.
- **Unmount cleanup** — present, `AbsenceExportDialog.tsx:32-36`, matching the `AbsenceStats` precedent the plan cited.
- **Data safety** — read-only feature; no write paths added or touched.
- **Code splitting** — `hucre` appears in exactly one build chunk (`xlsx.*.js`, 39.2 KiB gzip), absent from the dashboard entry chunk and from both `AbsenceExportDialog` chunks. The plan's single-adapter containment holds: `hucre/xlsx` is imported at exactly one site, `src/lib/export-xlsx.ts:64`.
