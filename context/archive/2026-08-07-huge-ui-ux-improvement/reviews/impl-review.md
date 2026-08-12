<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Adopt the new-design prototype: token layer + restyle

- **Plan**: `context/changes/huge-ui-ux-improvement/plan.md`
- **Scope**: Full plan — Phases 1–8 of 8
- **Date**: 2026-08-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 7 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## What passed

Every planned change verdicts MATCH. All ten explicit plan constraints hold with file:line
evidence: `textColorForBg` deleted; weekends non-interactive with no hover; column DnD intact
(listeners on the handle, no CSS `transform` on the `<th>`); type filter holds hidden ids with
an escapable all-hidden state; `Dodano` a sixth sortable column with FR-006 unamended; single
day figure via a once-declared `FULL_DAY_HOURS`; the Korekta gate by column omission with the
role resolved server-side; partial-day gating and target-not-editor substitute exclusion
preserved; employee-derived surfaces read from props only; and the migration exactly three
`ADD COLUMN`s with no `DROP`, no `ALTER COLUMN`, and the `absence_types_color_check` left
untouched and verified still present.

Nothing from the twelve-item "What We're NOT Doing" list was built. The six unplanned
`src/lib/` modules are precisely the extractions the plan's Testing Strategy required. The
OKLCH conversions round-trip to the exact brand hexes; the ZWJ offsite-training icon survived
as a correct 8-codepoint sequence.

Automated criteria re-run at review time: lint 0 errors; build completes; 83/83 tests across
12 files; catalogue verified against the live database; all 9 Progress SHAs resolve to real
commits; plan phase blocks byte-identical to the Phase 1 commit.

## Findings

### F1 — Details sub-tab can lock on "Ładowanie…" until reload

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceDetailsSubcards.tsx:137, :162
- **Detail**: `todayFetched.current` is set true before the fetch resolves, but the cleanup aborts on every `activeSubcard` change. Switching away mid-flight and back leaves `weekAbsences === null && !weekError && !weekLoading`, so the render guard at :300 shows "Ładowanie…" permanently and the guard at :136 blocks any refetch. Identical shape for yearly at :161/:322.
- **Fix**: Move the flag assignment into the success handler so an aborted fetch leaves the ref false and re-entry refetches.
- **Decision**: FIXED — flag now set in the success handler, both effects

### F2 — Two new full-year aggregates read a silently truncated endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:114
- **Detail**: The `.limit(5000)` is pre-existing, but this change added two consumers rendering aggregates over the full year (`AbsenceStats.tsx:281`, `AbsenceDetailsSubcards.tsx:165`). Truncation used to mean a short list; it now means KPI totals, per-type percentages, stacked bars and medals are silently wrong with no visible cue.
- **Fix A ⭐ Recommended**: Return a `truncated` marker and surface it at both consumers.
  - Strength: Makes the failure visible where it is read; both consumers already branch on error.
  - Tradeoff: Small response-shape change plus two call-site edits.
  - Confidence: HIGH — both consumers already render error states.
  - Blind spot: Other `/api/absences` callers not audited for shape assumptions.
- **Fix B**: Raise or remove the cap for the year query.
  - Strength: No shape change; the real dataset is ~10 employees.
  - Tradeoff: Trades silent-wrong for unbounded; defers rather than surfaces.
  - Confidence: MEDIUM — safe at current scale, not structurally.
  - Blind spot: No measurement of response size at 5000 rows.
- **Decision**: FIXED via Fix A — GET probes LIST_LIMIT+1 and reports `X-Result-Truncated`; both aggregate consumers surface it

### F3 — Pickers lost keyboard/screen-reader parity with the Selects they replaced

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceFormDialog.tsx:139-176, :253-297
- **Detail**: Phase 8 replaced two shadcn `<Select>` primitives with hand-rolled `role="radiogroup"` grids. Roles and `aria-checked` are correct, but there is no roving tabindex and no arrow-key handling, so every option is a separate tab stop. The substitute avatars' only accessible name is two initials plus a `title`. The replaced Selects provided all of this.
- **Fix A ⭐ Recommended**: Add roving tabindex + arrow handlers, and an `aria-label` carrying the full name on each substitute avatar.
  - Strength: Restores the parity the primitives provided; contained to one file.
  - Tradeoff: ~30 lines of keyboard handling to write and test.
  - Confidence: HIGH — standard, well-specified pattern.
  - Blind spot: No a11y acceptance bar defined for this project.
- **Fix B**: Accept for now, file as follow-up.
  - Strength: Internal HR tool; the plan set no a11y criteria.
  - Tradeoff: A regression against the pre-change baseline ships.
  - Confidence: MEDIUM — depends whether any user is keyboard-only.
  - Blind spot: Unknown assistive-tech usage among staff.
- **Decision**: FIXED via Fix A — new `useRovingRadioGroup` hook wires arrows/Home/End and a single tab stop on both pickers; substitute avatars gain `aria-label`

### F4 — "Dodano" renders the UTC date, one day early after midnight

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceDetailsTable.tsx:238
- **Detail**: `new Date(created_at).toISOString().slice(0,10)` converts to UTC before slicing. Reproduced: a record created 2026-08-10 01:30 Warsaw renders as 2026-08-09. Every other date in the file uses local-time `parseIsoDate`/`formatDate`, so the newly-added sixth column is inconsistent with the five beside it — and it is the column Phase 5 made sortable to satisfy FR-006.
- **Fix**: Format from local components, reusing the `Intl.DateTimeFormat("pl-PL")` path the file already has.
- **Decision**: FIXED — new `localIsoDate()` builds from local components

### F5 — The test suite's pass/fail is not reproducible

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: vitest.config.ts:10-16
- **Detail**: No `testTimeout`/`hookTimeout` is set, so the 5s default races DB round trips measuring 3–5s against remote Supabase. Four runs this session: 83/83, 74/83, 6/6-failed on one file, then 83/83 with `--testTimeout=60000`. A timed-out test also skips its `afterEach`, so the next run cascades into `23505` duplicate-key, which reads like a real failure. Six phases assert "tests pass" as an automated criterion.
- **Fix**: Set `testTimeout`/`hookTimeout` (30–60s) in `vitest.config.ts`.
- **Decision**: FIXED — `testTimeout`/`hookTimeout` set to 60s; suite now 83/83 reproducibly

### F6 — Stale authorization comment survived one file over

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/holiday-balances/[id].ts:30-31
- **Detail**: Reads "No role/owner gate on the delete — consistent with the 'both roles can edit any balance' rule (POST has no role gate either)." POST now has a gate. The DELETE behaviour is correct per plan (ungated, S-15 stands); only the justification is false. This is the exact failure the plan named for `index.ts:147`, landing one file over — where a reader could cite it to relax the gate.
- **Fix**: Rewrite to state DELETE stays ungated per S-15 while POST carries a field-level gate on `used_adjustment_days` per S-17.
- **Decision**: FIXED — comment rewritten to state the S-15 delete rule and the S-17 field-level POST gate separately

### F7 — AbsenceGrid hand-concatenates conditional classes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/absence/AbsenceGrid.tsx:62-64, :281, :303-305
- **Detail**: Three conditional class template literals; the file never imports `cn`. `CLAUDE.md` ("use the `cn()` helper… Do not concatenate class strings manually") and `AGENTS.md` both name this rule, and every other component restyled in this change follows it.
- **Fix**: Import `cn` from `@/lib/utils` and convert the three sites.
- **Decision**: FIXED — `cn` imported and all three sites converted

### F8 — Quota dialog keeps abandoned edits after Cancel

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/holiday/HolidayBalanceDialog.tsx:56-59
- **Detail**: `HolidayBalanceCard.tsx:89` mounts the dialog unconditionally, so the four `useState` initialisers run once. Edit → Cancel → reopen shows abandoned values, not stored ones. Harmless on save (page reloads) but wrong on cancel — and Phase 7 added steppers, which make accidental edits easier to produce.
- **Fix**: Key the dialog on its open state, or reset the four fields in an effect keyed on `open`.
- **Decision**: FIXED — dialog keyed on open state in `HolidayBalanceCard`. The effect-reset variant was rejected by `react-hooks/set-state-in-effect`; remount is the idiomatic fix

### F9 — Token layer has 8 straight bypasses and a stale `.dark` block

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/styles/global.css:48-80; AbsenceStats.tsx:228,237,253,262; HolidayBalanceCard.tsx:60; AbsenceDetailsSubcards.tsx:277; AbsenceGrid.tsx:63; AbsenceFormDialog.tsx:162
- **Detail**: Token adoption is ~78% (138 token utilities vs 38 raw hexes), and absence-type colours correctly stay dynamic from the DB — zero hardcoded type colours. But 8 of the 38 bypass tokens that already exist: `#c8c8c8` where `--line` is defined, `#6f6f6f` where `--muted-foreground` is, `#072143` where `--primary` is. Separately the `.dark` block still carries the stock achromatic shadcn palette and defines none of the three new tokens. The plan said `.dark` "stays for now", so this is not drift — but it describes a theme that no longer exists.
- **Fix**: Convert the 8 bypasses; either migrate or delete the `.dark` block.
- **Decision**: FIXED — 8 bypasses converted to `text-line`/`bg-line`/`ring-primary`/`text-muted-foreground`; `.dark` block deleted, `@custom-variant` kept so `ui/*` `dark:` utilities still compile

### F10 — `used_adjustment_days` defaults to 0 for an omitting moderator

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/holiday-balances/index.ts:111
- **Detail**: `z.number().int().min(0).optional().default(0)` means a moderator POST omitting the field silently zeroes the stored adjustment. Not reachable today — the dialog full-replaces all four fields, and the plan kept Korekta/Do dnia in the modal precisely to avoid this hazard. Noted because the follow-up change (`holiday-balance-valid-until`) proposes moving those fields to another modal, which is exactly the edit that would make it reachable.
- **Fix**: Drop `.default(0)` and treat `undefined` as "leave unchanged", using the same spread trick as the role gate.
- **Decision**: FIXED — `.default(0)` dropped; omission now means leave-unchanged for moderators too

## Also noted, not itemised

- `getWeekRange()` runs at module scope (`AbsenceDetailsSubcards.tsx:55`) — a tab open across midnight keeps yesterday's grouping.
- The Details `canEdit` comment claims parity with the grid but drops its `!isWeekend` term. Benign: no server-side weekend rule exists anywhere in `src/pages/api/absences/` or `src/lib/`.
- `avatarColor(NaN)` returns `undefined`; `-1` is handled.
- `GET /api/holiday-balances` has no role gate on `employee_id` — pre-existing, consistent with this app's open-visibility model.

## Clean

Injection, secrets, XSS, list keys, error boundaries, `useMemo` dependency completeness (all
four arrays checked value by value), the six new `src/lib/` modules against
`absence-types.ts` conventions, test-file conventions, and the ported `initialsOf` crash —
genuinely fixed and locked by tests.
