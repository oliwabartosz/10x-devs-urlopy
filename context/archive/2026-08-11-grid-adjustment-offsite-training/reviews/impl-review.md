<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Bound the grid's column width and drop the type name from the cell

- **Plan**: `context/changes/grid-adjustment-offsite-training/plan.md`
- **Scope**: Phases 1–4 (all)
- **Date**: 2026-08-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Verification run during this review

- `npm run lint` — 0 errors (10 pre-existing warnings, all `no-console` in `packages/code-reviewer`)
- `npm run test:run` — 17 files, 161/161 passed
- `npm run build` — complete
- `npm run e2e` — accepted on recorded evidence: 5/5 against the deployed Worker at `07049c0`,
  the first deploy carrying Phases 3 and 4 (see `change.md`, "Resolved 2026-08-13")

Scope was clean: commits `23628c0`, `d9bcaa3`, `6bd2f3d`, `4d9b2c5` touch exactly the four planned
source files and nothing else. Every "What We're NOT Doing" boundary held.

Checked and clean, recorded so it is not re-checked: the five `FULL_DAY_ONLY_TYPES` names in
`absence-grid-cell.test.ts` match the seed rows verbatim (a typo would have made those cases
vacuously pass); the `truncate` the plan's analysis correctly called inert now genuinely clips in
both header variants, because `table-fixed` gives the `<th>` a real width.

## Findings

### F1 — The Phase 1 icon migration has no execution path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260812153000_offsite_training_single_codepoint_icon.sql`
- **Detail**: The file itself is correct — the executable statement sets exactly one codepoint
  (U+1F3C3), and it is absent from `supabase/migrations/meta/_journal.json`, both as the contract
  specified. The problem is what runs it: nothing does.
  `20260807122840_faulty_hobgoblin.sql:30` — which writes the 8-codepoint ZWJ sequence — *is*
  journaled (idx 3), so `npm run db:migrate` applies it on every fresh environment; the correction
  is not journaled, so the same command skips it. Unlike the template it followed
  (`20260811120000_purge_demo_partial_day_absences.sql`, a one-off cleanup that genuinely should not
  re-run), this is a catalogue correction every environment needs. AGENTS.md's "Migration discipline"
  section documents no hand-apply list, so no step anywhere names it. Production is unaffected —
  `change.md` records it already stored `🏃`, which is also why the migration was never executed and
  the gap went unnoticed. But Phase 3 made the icon the cell's only type discriminator, so a newly
  provisioned environment renders three or four glyphs where the single signal should be.
- **Fix A ⭐ Recommended**: Add a short "hand-applied migrations" list to AGENTS.md's Migration
  discipline section naming the two non-journaled data migrations, so provisioning a new environment
  includes running them.
  - Strength: Keeps the convention the plan deliberately chose (data migrations outside
    `drizzle-kit`) and closes the actual gap — that nobody is told to run the file. AGENTS.md already
    documents per-environment steps like `seed:admin`.
  - Tradeoff: Relies on a human following a doc; nothing enforces it.
  - Confidence: HIGH — one doc line, and the repo already carries this kind of provisioning note.
  - Blind spot: Does nothing for an environment provisioned before the doc lands — currently only
    production, which is already correct.
- **Fix B**: Add a journal entry for `20260812153000` so `db:migrate` applies it automatically.
  - Strength: Enforced rather than remembered; no human step.
  - Tradeoff: Drizzle pairs journal entries with `meta/*.snapshot.json` by idx. Hand-inserting an
    entry with no matching snapshot may confuse the next `db:generate`, and it breaks the convention
    the plan explicitly adopted.
  - Confidence: MEDIUM — the snapshot-pairing behaviour is untested here.
  - Blind spot: Haven't verified `drizzle-kit` tolerates a journal entry with no snapshot.
- **Decision**: FIXED via Fix A — `AGENTS.md` "Migration discipline" now carries a hand-applied
  migrations list marking `20260812153000` required on a fresh environment and `20260811120000`
  not required, plus a note that the pre-drizzle baseline is likewise unjournaled.

### F2 — role="img" hides the substitute badge and comment marker from AT

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/absence/AbsenceGrid.tsx:344-345`
- **Detail**: `role="img"` makes every descendant presentational, so the substitute badge
  (`🔁 KL`, `:355`) and the comment marker (`💬`, `:361`) — both children of the labelled div — leave
  the accessibility tree. The `aria-label` replaces them with type and range only. Before this change
  the div had no role, so its text content was exposed in browse mode. The plan specified
  `role="img"` and this label, and the reasoning behind the role is sound; it simply did not account
  for the two badges living inside the chip. Partly mitigated: with `aria-label` present the `title`
  becomes the accessible description, and `buildTooltip` does emit `Komentarz:` and `Zastępstwo:`
  lines — but description announcement is configuration-dependent, so it is not a guarantee. Manual
  criterion 3.7 checked only that the type name is announced instead of the emoji.
- **Fix**: Extend the `aria-label` to carry both signals, e.g.
  `` `${absenceType.name}${range ? `, ${range}` : ""}${substituteInitials ? `, zastępstwo ${substituteInitials}` : ""}${absence.comment ? ", komentarz" : ""}` `` —
  both values are already in scope at `:313-317`.
- **Decision**: FIXED — a `chipLabel` const now joins type, range, `zastępstwo: <full name>` and
  `komentarz`, and feeds the chip's `aria-label`. The substitute reads as a full name rather than
  the initials the badge shows, since the initials were never meant to be spoken.

### F3 — The tooltip's range formatting is an untested copy

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/absence/AbsenceGrid.tsx:137-140`
- **Detail**: `buildTooltip` re-implements the full-day / missing-time checks and the U+2013 join
  inline. This is exactly what the plan's contract asked for, and the comment recording why the two
  surfaces disagree is present and good. The side effect is that only the *gate* is deliberately
  different — the formatting half is duplicated, and the test pinning the en dash against a hyphen
  (`absence-grid-cell.test.ts:70-74`) does not cover this copy. The two can drift apart silently.
- **Fix**: Export an ungated `rawTimeRange(absence)` from `src/lib/absence-grid-cell.ts`, have
  `cellTimeRange` call it after the whitelist check, and call it from `buildTooltip` — keeping the
  existing comment, since the asymmetry stays intentional.
- **Decision**: FIXED — `rawTimeRange` is now exported from `src/lib/absence-grid-cell.ts`,
  `cellTimeRange` is the whitelist check plus a call to it, and `buildTooltip` calls it directly.
  Nine new test cases pin the shared formatting and the fact that only the gate differs.

## Post-triage verification

All three fixes applied and verified together: `npm run lint` 0 errors, `npm run test:run`
18 files / 178 passed (9 new), `npm run build` complete. Not re-run: `npm run e2e`, which needs a
deployment — the fixes touch the chip's `aria-label` and an internal extraction, neither of which any
E2E spec asserts, but the next push to `main` should confirm it stays 5/5.
