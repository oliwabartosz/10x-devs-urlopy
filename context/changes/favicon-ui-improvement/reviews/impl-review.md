<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Palm-on-island brand mark, month-bar "today" control, and the `choroba` sub-caption

- **Plan**: `context/changes/favicon-ui-improvement/plan.md`
- **Scope**: Phases 0–3 (all)
- **Date**: 2026-09-02
- **Verdict**: NEEDS ATTENTION (nothing blocking — every functional criterion verified)
- **Findings**: 0 critical, 4 warnings, 6 observations

## Verification performed

Executed, not read: `npm run lint` (0 errors) · `npm run test` (505/505) · `npm run check` (0 errors) ·
`npm run build` (emits `dist/client/icon.svg`; no `template.png`, no `*.scaffold`) ·
`BASE_URL=http://localhost:4321 npx playwright test` (**11/11 pass**) · CI sign-in copy gates against the
live render (`Zaloguj się` ×2, all four literals present) · runtime check of the month-bar control (absent
on the current month with and without an explicit `?month=`; present otherwise; tab + subcard preserved on
all four branches; heading x-position identical between `luty` and `wrzesień`) · icon rendered at
16/24/32/64/160 px (legible at 16) · type picker screenshotted with `choroba` selected (caption gray,
non-bold, unique).

`npm run pack` was **not** re-run — a full tar of an unpruned `node_modules` was disproportionate, and
`dist/client/` already proves the only aspect this change affects.

All eleven "What We're NOT Doing" guardrails hold.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Unplanned dashboard page-title change

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: src/pages/dashboard.astro:244 (commit 9eed7df, Phase 1)
- **Detail**: `<Layout title="Urlopy — Ewidencja nieobecności">` became `<Layout title="Nieobecności — Ewidencja">`. No plan step authorizes it. It is the same line the plan cites at `plan.md:290` as evidence the default title doesn't matter. The plan uses an explicit "Deviation" mechanism elsewhere (`plan.md:199`); none was written here.
- **Fix A ⭐ Recommended**: Keep it, add a one-line deviation note to Phase 1.
  - Strength: Harmonizes the dashboard with the two login pages ("Nieobecności — Logowanie"); retires another "Urlopy"-era string. No test or CI grep asserts on this title.
  - Tradeoff: Plan becomes a slightly moving target.
  - Confidence: HIGH — all three page titles diffed; dashboard was the only outlier.
  - Blind spot: Whether anyone outside this session had a view on the dashboard tab title.
- **Fix B**: Revert to "Urlopy — Ewidencja nieobecności".
  - Strength: Strict scope discipline; the copy change gets its own sign-off.
  - Tradeoff: Re-introduces the inconsistency Phase 1 otherwise removed.
  - Confidence: MEDIUM.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — deviation note added to plan.md Phase 1, item 2.

### F2 — The twin-SVG invariant is a comment, not a gate

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/BrandMark.astro:5-7, public/icon.svg:18-21
- **Detail**: The files are in sync today — all 8 `d="…"` attributes are byte-identical, differing only in the documented `#072143`→`currentColor` swaps. But both files say "nothing enforces that they match". The repo answers this exact class of problem with a source-scanning vitest guard (`src/tests/lib/base-path-coverage.test.ts`) and gives `src/lib/absence-types.ts` a drift-guard test for the same reason. This pair got neither.
- **Fix A ⭐ Recommended**: Add a ~10-line vitest that reads both files, extracts `d="…"`, and asserts equality.
  - Strength: Matches `base-path-coverage.test.ts` exactly; converts the one hand-maintained duplication this change introduced into an enforced invariant at near-zero cost.
  - Tradeoff: One more test file; colour/`fill` divergences must be normalized out with a comment naming the legitimate ones.
  - Confidence: HIGH — the precedent file is in this repo and passes.
  - Blind spot: A future third legitimate divergence widens the allowlist.
- **Fix B**: Accept comment-only discipline.
  - Strength: No new code; both comments are thorough and name each other.
  - Tradeoff: A silent divergence ships as "favicon and login tile are different marks" — Astro copies `public/` verbatim and no build step reads either file.
  - Confidence: MEDIUM — depends how often the mark is edited.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `src/tests/lib/brand-mark-twin.test.ts` added (3 assertions); verified to fail on a one-digit geometry drift, then restored.

### F3 — `npm run format` exits 2; criterion 1.2 is marked [x] but fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/favicon-ui-improvement/research.md:274
- **Detail**: Phase 1 criterion 1.2 ("Formatting is clean: `npm run format`") is marked `[x] — 9eed7df` but does not pass. The ```astro fence at `research.md:274` is missing its opening `---`, so prettier-plugin-astro parses the body as a template and throws `SyntaxError: Unexpected token, expected "}" (1:10)`; `prettier --check` on that file exits 2. Repo-wide this is now one of two such files (the other predates this change), so `npm run format` was already red — which is why a criterion could be ticked against a failing command. CI does not run format, so nothing else catches it. All eleven changed *code* files are prettier-clean.
- **Fix**: Add the missing `---` opening delimiter to the ```astro fence at research.md:274 (or retag it ```text).
- **Decision**: FIXED — missing `---` added to the ```astro fence; prettier no longer crashes on the file (exit 2 → 1, the same style-warning tier as ~30 pre-existing markdown files). The repo-wide cosmetic reflow prettier wanted (212 lines of `*em*`→`_em_`) was deliberately not taken.

### F4 — The new button is the only control in its row with a tooltip

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/MonthNav.astro:30,32 vs :42-43
- **Detail**: The new control carries both `title` and `aria-label` per the plan; its two siblings carry `aria-label` only. Three visually identical buttons, one of which shows a tooltip on hover. The comment at :36-37 also overstates — `EmployeeManagementSheet.tsx:163-164` deliberately makes `aria-label` more specific than `title`, and the siblings do it not at all. Adding `title` to the arrows is not "touching the ‹/› glyphs", so it is not excluded by the plan's guardrail.
- **Fix**: Add `title="Poprzedni miesiąc"` / `title="Następny miesiąc"` to MonthNav.astro:30,32 and soften the :36-37 comment.
- **Decision**: FIXED — `title` added to both arrows at MonthNav.astro:30,32; the overstated comment replaced.

### F5 — E2E landed a new test block, not the contracted single assertion

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/e2e/absence-form-dialog.spec.ts:58-74
- **Detail**: The plan contracted "one added assertion inside the existing dialog-open flow". What landed is a standalone `test()` with three expects — a 20-line diff where a reviewer expects two. Intent is met and over-delivered (it also pins manual criterion 3.7), it reuses the existing helper, and it passes. Separately, the comment at :69-71 claims "No other type gains one" but the assertion only proves *this* caption appears once; the broader claim is carried by `src/tests/lib/absence-types.test.ts:71-77`.
- **Fix**: Accept the larger test; reword the :69-71 comment to what it asserts and point at the unit test for the general claim.
- **Decision**: FIXED — test kept as landed; the overstated comment at :69 reworded to what it asserts, pointing at the unit test for the broader claim.

### F6 — `BrandMark` has no default size

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/BrandMark.astro:28
- **Detail**: The root `<svg>` has neither width/height nor a default class; the twin `public/icon.svg` carries `width="512" height="512"`, and the lucide glyph it replaced emitted 24×24 regardless of caller. Both current call sites pass `class="size-10 text-white"`, so nothing is broken. A third call site that forgets `class` gets the 300×150 CSS replaced-element default or a flex-stretched blob — which the component's own doc-comment does not warn about.
- **Fix**: `class:list={["shrink-0", className]}` plus `width="1em" height="1em"`.
- **Decision**: FIXED — `width="1em" height="1em"` and `shrink-0` added; login tile re-measured at 40×40, unchanged.

### F7 — Wrong seed.ts line reference

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/absence-types.ts:39
- **Detail**: `// Name verbatim from src/db/seed.ts:25.` — `"choroba"` is at `seed.ts:28` (line 25 is inside the multi-line szkolenie object). The sibling reference at `:26` is correct. This is the one file whose whole premise is that seed cross-references stay accurate, and `lessons.md` already records that load-bearing claims must be verified before being written down. The plan carried the same wrong number, so it was copied faithfully rather than invented.
- **Fix**: Change `:25` to `:28`.
- **Decision**: FIXED — `:25` → `:28`.

### F8 — Third literal copy of the subcard-preservation ternary

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:209-229
- **Detail**: `prevMonthUrl`, `nextMonthUrl` and now `currentMonthUrl` each repeat `currentTab === "details" ? …&subcard=… : …`. The plan asked for "identical shape" and it delivered that literally. Three copies is the usual extraction threshold; a future fourth query param would have to be added in three places or silently diverge.
- **Fix**: Extract a local `const monthUrl = (m: string) => …` and collapse all three to one-liners.
- **Decision**: FIXED — `monthUrl()` extracted; all three links re-verified at runtime across grid / stats / details+monthly / details+yearly.

### F9 — Server timezone is unpinned in the deploy units

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: deploy/urlopy.service, deploy/user/urlopy.service (absence of `TZ`)
- **Detail**: The new logic is correct and is the safest shape available — it reads `getFullYear()`/`getMonth()` off the same `now` at `dashboard.astro:29` that resolves the default month at `:31-33`, so the button always lands on exactly the month an absent `?month=` resolves to, with no DST or month-overflow hazard (unlike its prev/next siblings, which construct Dates). The residual risk is environmental and pre-existing: no unit sets `TZ`, so the Node process inherits the VPS default. If that is UTC while users are in `Europe/Warsaw`, the server's "current month" differs from the user's for an hour or two per month boundary. The app already splits on this (`AbsenceDetailsSubcards.tsx:28` computes "today" in the browser; `dashboard.astro:39` on the server).
- **Fix**: Add `Environment=TZ=Europe/Warsaw` to both unit files. Out of scope for this change — recorded because this is where it surfaced.
- **Decision**: QUEUED — recorded in `context/changes/favicon-ui-improvement/follow-ups/review-fixes.md`. Not applied here: it edits deployment units no phase touches.

### F10 — First `.astro` file in the repo importing lucide-react, ungated

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/MonthNav.astro:2
- **Detail**: `grep -rn "lucide-react" src/ --include=*.astro` returns this line only. `/dashboard` is SSR-only, so `npm run build` never renders it and CI's smoke test only fetches `/`. Nothing in the pipeline proves it works. It does — RotateCcw renders server-side with no client JS, and the E2E suite exercises the page. The point is that no automated gate covers it.
- **Fix**: Accept (it works and is exercised by E2E), or use an inline `<svg>` the way the sibling arrows use the ‹ / › glyphs.
- **Decision**: SKIPPED — accepted as-is. Renders correctly server-side with no client JS and the E2E suite exercises the page.
