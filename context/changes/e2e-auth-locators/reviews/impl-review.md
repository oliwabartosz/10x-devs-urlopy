<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: E2E Signin Locator Repair

- **Plan**: `context/changes/e2e-auth-locators/plan.md`
- **Scope**: Phases 1–3 of 3
- **Date**: 2026-08-12
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Verification performed

- **E2E suite**: 4 consecutive full runs, 1 setup + 3 chromium, zero failures (13.8–16.0 s each; setup 3.3–4.0 s).
- **Session state**: `tests/e2e/.auth/user.json` regenerates fresh with a non-empty `cookies` array.
- **Phase 3 literals**: all five present in the live deployment (HTTP 200). Negative control confirms a mangled `Zaloguj sie` is absent, so the check is not vacuously true as a whole.
- **Lint**: `HEAD` lints clean (0 errors). The working-tree `npm run lint` failure is entirely uncommitted radial-timepicker work, not this change.
- **Scope**: zero `src/` files touched; no testids added; `playwright.config.ts` untouched; `npm run e2e` still out of CI. No guardrail violated.
- **Phase 2 triage**: verified factually supported — `canBePartialDay` gates both the toggle and the time inputs, `absenceTypeId` starts `null`, and `PARTIAL_DAY_TYPE_NAMES` contains exactly the two training types. Declining to open a product-side change folder was correct.

## Findings

### F1 — Health check leaves the submit button uncovered

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:112`
- **Detail**: The five literals split by target: `Użytkownik / ID` + `for="email"` guard the email input, `Hasło` + `for="password"` guard the password input, and `Zaloguj się` is the only guard on the submit button. Verified against the live response that `Zaloguj się` occurs twice — once at `signin.astro:21` ("Zaloguj się, aby uzyskać dostęp do panelu") and once in the button. `grep -qF` is satisfied by the subheading alone, so renaming the button leaves every literal passing while `auth.setup.ts:29` breaks and takes the whole suite down. That is the exact regression class this phase existed to prevent. The gap originates in the plan: "Critical Implementation Details" prescribed pairing the grep with the label→input bindings, but those cover the two inputs, not the button.
- **Fix A ⭐ Recommended**: Require two occurrences of `Zaloguj się` (`grep -cF … -lt 2`)
  - Strength: One line; the subheading accounts for exactly one, so a count ≥ 2 restores button coverage without depending on markup shape. Verified: the live page has exactly 2.
  - Tradeoff: Couples the assertion to the subheading copy.
  - Confidence: HIGH — occurrence count verified against the deployment.
  - Blind spot: A future third `Zaloguj się` anywhere silently loosens the check again.
- **Fix B**: Assert the button-scoped literal `type="submit">Zaloguj się`
  - Strength: Binds directly to the submit element; unaffected by the subheading. Present verbatim in the live response.
  - Tradeoff: Depends on React's attribute ordering; brittle to a refactor of `LightSubmitButton`.
  - Confidence: MEDIUM — works today, not robust to markup churn.
  - Blind spot: Haven't checked whether the class list ever renders after `type`.
- **Decision**: FIXED via Fix A. Implemented as an occurrence count (`grep -oF … | wc -l`), not `grep -cF` — the response is minified onto two lines, so both hits share a line and line-counting would have returned 1 and failed spuriously. Verified by executing the edited step against the real live body (pass) and against a body with only the button renamed (fail, correct message).

### F2 — Hydration barrier is a proxy, and its safety net can pass too early

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `tests/e2e/setup/auth.setup.ts:18`, `:26-27`
- **Detail**: `waitForLoadState("networkidle")` means "500 ms with no in-flight requests" — the last byte arrived, not the island hydrated. It works here incidentally, because Astro's island runtime dynamically imports the chunk and the renderer. Three holes: a warm cache produces no network activity at all; `importWithRetry` sleeps 1 s before retrying, a window with zero traffic in which networkidle will fire; and the Sentry browser SDK's session POST both masks the problem and makes the barrier hostage to an external host's latency. The `toHaveValue` assertions detect rather than prevent — web-first assertions return on first pass, so: fill → poll passes → hydration commits and resets the controlled input → click → `validate()` calls `preventDefault()` → no POST is ever issued → `waitForURL` times out at 30 s. Four green runs is evidence the race is usually won, not that it is gone — which is what `change.md` records happening in Phase 1.
- **Fix A ⭐ Recommended**: Wrap fill+assert in `expect(async () => {…}).toPass()`
  - Strength: Self-healing — re-fills after a wipe instead of failing. Touches only `auth.setup.ts`; no `src/` change, so it stays inside the plan's guardrails.
  - Tradeoff: Still a retry loop around a race rather than a real barrier.
  - Confidence: HIGH — standard Playwright idiom for exactly this.
  - Blind spot: Haven't measured how many iterations a cold CI run needs.
- **Fix B**: Wait on the island — `expect(page.locator("astro-island[ssr]")).toHaveCount(0)`
  - Strength: Deterministic; keys off the attribute Astro's runtime removes only after `hydrateRoot` commits.
  - Tradeoff: A CSS selector, which `e2e-rules.md:7` forbids — needs a documented exception or a shared helper.
  - Confidence: MEDIUM — correct mechanism, but couples the suite to an Astro runtime internal.
  - Blind spot: Not verified against a multi-island page.
- **Decision**: FIXED via Fix A. `fill` + `toHaveValue` now run inside `expect(async () => {…}).toPass({ timeout: 15_000 })` with 1 s inner assertion timeouts, so a hydration wipe costs one fast iteration instead of the run. `networkidle` is kept as a cheap first pass but its comment no longer claims to guarantee hydration. Validated: setup project 5/5 green at 2.9–3.5 s (no measurable cost), lint clean.

### F3 — Change closed as `implemented` with criterion 3.2 unrunnable

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/e2e-auth-locators/plan.md:354`
- **Detail**: All four commits (cf45bbe, 78048f0, 5a8cc7b, dbd29df) are unpushed — `main` is 7 ahead of `origin/main`, and the newest CI run is 5246e09 from before this change. The hardened health check has never executed once; its only evidence is a manual curl. The `[ ]` on 3.2 is honest and the epilogue commit body says so, but `change.md` reads `status: implemented` and the plan is closed out around an unverified assertion. Note: the two interleaved radial-timepicker commits (202fa37, 8580fc9) would ship with any push, and pushing `main` triggers a real deploy.
- **Fix**: Push when the radial-timepicker work is shippable, then tick 3.2 with the CI run — or note in `change.md` that 3.2 defers to `/10x-archive` so the gap is visible in the artifact, not just the commit body.
- **Decision**: FIXED. Added an "Open criterion at close" section to `change.md` naming the `deploy`-job gate, the unpushed state, what was verified by hand instead, and the instruction to tick 3.2 against the real CI run on the next push.

### F4 — Phase 1 broke its own contract without recording a deviation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/e2e-auth-locators/plan.md:123-127`
- **Detail**: The Phase 1 contract says "Lines 14-16 only… Nothing else in the file changes: the `waitForURL("/")` → `/dashboard` → `Siatka` sequence… still correct." cf45bbe deleted that sequence and substituted `waitForURL("**/dashboard")`. The edit was necessary — 7c34d01 added a `/` → `/dashboard` redirect at `index.astro:8`, so `waitForURL("/")` could never settle — and the commit body explains it. But `plan.md` was first committed in that same commit and still asserts the false clause. The three locators themselves are byte-perfect matches.
- **Fix**: Append a deviation note under Phase 1 recording the navigation rewrite and the 7c34d01 redirect that forced it.
- **Decision**: FIXED. Blockquoted deviation note added under the Phase 1 contract in `plan.md`, stating that the clause was wrong when written and why.

### F5 — e2e-rules.md contradicts itself on waiting, and the change propagated it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `tests/e2e/e2e-rules.md:11` vs `:45-46`
- **Detail**: The Waiting section prescribes concrete-state waits; the locators section codifies `networkidle` and claims it "ensure[s] React island (client:load) has hydrated and onClick handlers are attached" — which, per F2, it does not. This change carried that idiom into `auth.setup.ts:18`, and `:58` designates `absence-form-dialog.spec.ts` as the seed to "model all new tests on". The rules file now actively teaches the weaker pattern.
- **Fix**: Reconcile the two sections once F2 is decided — either sanction `networkidle` with its stated limits, or document the chosen hydration barrier as the project idiom and migrate both call sites.
- **Decision**: FIXED. Added a "Waiting for island hydration" subsection to `e2e-rules.md` stating that `networkidle` is a proxy, not a barrier, and documenting the `toPass()` re-fill idiom with a code sample. Corrected the "Empty grid cell" bullet, which had claimed `networkidle` guarantees onClick handlers are attached. **Confirmed empirically during this review**: `openPartialDayDialog` failed once in ~15 executions at `expect(dialog).toBeVisible()` — a grid click landing before `AbsenceGrid` hydrated, exactly the failure the old wording denied was possible. (Both edits were clobbered mid-review by a concurrent session editing the same file and had to be re-applied.)

### F6 — Upstream tick breaks the progress-format convention

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `context/changes/absence-hours-window/plan.md:524`
- **Detail**: Annotated `— e2e-auth-locators p2` where every neighbouring row (`:508-511`, `:525-526`) carries a bare sha. Not greppable back to a commit.
- **Fix**: Replace with `— 78048f0`.
- **Decision**: FIXED.

### F7 — Public CI log now dumps the full page body on routine copy edits

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:118`
- **Detail**: Nothing sensitive is in the body (verified: `curl -o` captures body only, no `Set-Cookie`; secrets are `access: "secret"` in `astro.config.mjs` so Astro won't inline them). But the repo is public and the dump went from unreachable to firing on any label rename.
- **Fix**: `head -c 2000 /tmp/body.txt` — the failing literal is already echoed, so the full body adds little.
- **Decision**: PENDING

### F8 — Bad credentials look identical to a hydration failure

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `tests/e2e/setup/auth.setup.ts:33`
- **Detail**: `api/auth/signin.ts:19` redirects to `/?error=<message>` on auth failure; `/` renders the login card for an unauthenticated user, so `waitForURL` times out generically and the Supabase error text on screen never reaches the log.
- **Fix**: Add `await expect(page).not.toHaveURL(/error=/)` before `waitForURL`.
- **Decision**: PENDING

### F9 — Spec durability: substring "+" locator and a decaying future month

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `tests/e2e/absence-form-dialog.spec.ts:20`, `:27`
- **Detail**: Both lines are unchanged by this change and the plan correctly left them alone (they didn't fail). Still: `getByText("+")` is substring-matched and `.first()` suppresses the strict-mode error that would flag an ambiguity — one "+2 więcej" badge away from clicking the wrong element. And hardcoded `2027-01` is ~5 months out, so "guaranteed empty" is decaying.
- **Fix**: Scope the locator to a cell and compute the month relative to today (e.g. +24 months).
- **Decision**: PENDING

## Not flagged

The extra `e2e-rules.md:25-27` Authentication bullet is beyond the contracted single bullet group, but it is the documentation counterpart of F4's navigation fix and factually correct. Benign.
