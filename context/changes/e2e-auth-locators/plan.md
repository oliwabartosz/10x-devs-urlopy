# E2E Signin Locator Repair — Implementation Plan

## Overview

The Playwright suite has been unable to run since f748ba5 Polonized `LoginCardForm.tsx`. The
`setup` project still fills `getByLabel("Email")` / `getByLabel("Password")` and clicks
`getByRole("button", { name: "Sign in" })`, none of which exist any more; it times out after 30 s
and the three dependent `chromium` tests never start. This plan repairs the three locators,
proves the whole suite green (the three `absence-form-dialog` tests have never executed once),
and closes the gap that let the drift live unnoticed for a day.

## Current State Analysis

**The drift.** `src/components/auth/LoginCardForm.tsx` renders:

- `:78` — `<label htmlFor="email">Użytkownik / ID</label>` bound to `<input id="email">` (`:85`)
- `:122` — `<label htmlFor="password">Hasło</label>` bound to `<input id="password">` (`:129`)
- `:29` — submit button text `Zaloguj się` inside `LightSubmitButton` (`type="submit"`, `:18`)

`tests/e2e/setup/auth.setup.ts:14-16` still asks for the pre-f748ba5 English names.

**Confirmed against the deployment.** `curl https://urlopy.oliwa-bartosz.workers.dev/auth/signin`
returns all three strings in the server-rendered HTML, before hydration:
`<label for="email" …>Użytkownik / ID</label>`, `<label for="password" …>Hasło</label>`, and
`Zaloguj się` (twice — once in the page heading, once in the button). This matters for Phase 3:
a `curl` + `grep` check can assert them without a browser.

**The gotcha, already half-handled.** The password-visibility toggle at `:147-156` carries
`aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}`. A substring `getByLabel("Hasło")`
would be ambiguous. Line 15 of the setup file already passes `{ exact: true }`, so only the
string literal changes there — the option stays.

**Nothing else in the suite is broken by this.** `tests/e2e/absence-form-dialog.spec.ts` was
rewritten in 70ff594 (absence-hours-window p3) with Polish locators that match
`tests/e2e/e2e-rules.md`. But because `playwright.config.ts:48` makes `chromium` depend on
`setup`, those tests have **never executed** — they are unverified code, not known-good code.

**Why nothing failed loudly.** `.github/workflows/ci.yml` runs lint → test → build → bundle-size
→ deploy → post-deploy health check. `npm run e2e` is never invoked, which is a deliberate call
recorded in `context/foundation/test-plan.md:98` ("e2e — none planned for MVP") and `:118`. The
post-deploy health check greps the response for `sign.in\|email\|login` — and `id="email"` in the
markup still matches, so it stayed green straight through the Polonization. The only signal that
would have fired was a manual `npm run e2e`.

## Desired End State

`npm run e2e` runs to completion green against the deployed app: the `setup` project
authenticates and writes `tests/e2e/.auth/user.json`, and all three `absence-form-dialog` tests
pass. `tests/e2e/e2e-rules.md` documents the canonical signin locators alongside the grid and
dialog ones. The CI post-deploy health check asserts the actual strings the setup file depends
on, so the next copy change to the signin form turns the deploy job red instead of passing
silently. Criterion 3.1 of `context/changes/absence-hours-window/plan.md` is unblocked.

### Key Discoveries:

- `LoginCardForm.tsx:78,122,29` — the three current accessible names; `:153` — the toggle's
  `aria-label` that forces `{ exact: true }` on the password locator.
- `playwright.config.ts:37-49` — two projects; `chromium` `dependencies: ["setup"]` means a
  broken setup blocks the entire suite, not just login coverage.
- `tests/e2e/e2e-rules.md:38-45` — a "Project-specific locators" section already documents the
  grid, dialog, and tab-nav locators, but has no signin entry. That is where the repair belongs.
- `tests/e2e/e2e-rules.md:5-7` — testids are an explicit fallback "only when no accessible name
  exists"; `src/` and `tests/` contain zero `data-testid` / `getByTestId` occurrences today.
- `.github/workflows/ci.yml` post-deploy step — already `exit 1`s on HTTP ≥ 500 and on a failed
  content grep, so hard-failing on a missing string is consistent with the step's existing
  semantics rather than a new behavior.
- `playwright.config.ts:20` loads `.env`; `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` are present in
  both `.env` and `.env.example`, so no credential work is needed.

## What We're NOT Doing

- **Not adding `data-testid` anywhere.** It would contradict `e2e-rules.md:5-7` and break a
  codebase with zero testids. Accessible names stay the locator strategy.
- **Not wiring `npm run e2e` into CI.** That reverses an explicit MVP decision in
  `test-plan.md:98,118` and would need Playwright browser installs, `E2E_USER_*` secrets, and a
  managed prod test account.
- **Not auditing every locator in the suite by hand.** Running the suite proves the same thing
  empirically and faster.
- **Not fixing product bugs found in Phase 2.** A failure rooted in the clamp feature itself gets
  a new change folder, not a fix inside a test-repair change.
- **Not changing `LoginCardForm.tsx`.** The Polish copy is correct; the tests are what drifted.
- **Not touching the `chromium`/`setup` project topology in `playwright.config.ts`.**

## Implementation Approach

Repair first (Phase 1, gated on the setup project alone so the fix is isolated from the
never-run tests), then prove the whole suite (Phase 2, where the unknown lives), then install
the guard (Phase 3). Phase 3 is deliberately last: hardening a check against strings the suite
has not yet confirmed would be asserting an assumption.

## Critical Implementation Details

**Grep and non-ASCII in CI.** The Phase 3 assertions contain `ł`, `ż`, and `ó`. Use `grep -qF`
with the literal string rather than `grep -qi` with a pattern — `-F` avoids any regex
interpretation and `-q -F` is byte-comparison, so it is locale-independent on the
`ubuntu-latest` runner. Do not add `-i`: case-folding non-ASCII depends on locale, and case
insensitivity is not wanted here anyway.

**`Zaloguj się` appears twice** in the rendered page — the card subheading
("Zaloguj się, aby uzyskać dostęp do panelu") and the submit button. A presence grep is
therefore satisfied by the subheading alone. Pair it with an assertion on the label→input
bindings (`for="email"`, `for="password"`) so the check actually covers what `getByLabel`
resolves against, not just the presence of a word somewhere on the page.

---

## Phase 1: Repair the signin locators

### Overview

Swap the three drifted accessible names for the current Polish ones and record them in the E2E
rules so the next author does not rediscover the `exact` gotcha the hard way.

### Changes Required:

#### 1. Auth setup project

**File**: `tests/e2e/setup/auth.setup.ts`

**Intent**: Point the three signin locators at the accessible names the form actually renders, so
the setup project can authenticate again.

**Contract**: Lines 14-16 only. Email label becomes `Użytkownik / ID`, password label becomes
`Hasło` (keep the existing `{ exact: true }` — it disambiguates from the toggle's
`aria-label="Pokaż hasło"` / `"Ukryj hasło"`), submit button name becomes `Zaloguj się`. Nothing
else in the file changes: the `waitForURL("/")` → `/dashboard` → `getByRole("link", { name:
"Siatka" })` sequence and the `storageState` write are all still correct.

#### 2. E2E locator conventions

**File**: `tests/e2e/e2e-rules.md`

**Intent**: Add a signin entry to the "Project-specific locators" section (`:38-45`) so the
canonical strings and the `exact: true` reason live where the other project locators are
documented.

**Contract**: One bullet group under the existing section, matching the style of the neighbouring
entries: the three locator expressions, plus a one-clause note that `exact: true` on the password
label is required because the visibility toggle's `aria-label` contains `hasło`.

### Success Criteria:

#### Automated Verification:

- Setup project authenticates: `npx playwright test --project=setup`
- Session state is written: `tests/e2e/.auth/user.json` exists with a fresh mtime and a non-empty
  `cookies` array
- Linting passes: `npm run lint`

#### Manual Verification:

- The three strings in `e2e-rules.md` read back identically to `LoginCardForm.tsx:78`, `:122`,
  and `:29` — no transcription drift in the documentation itself

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Get the full suite green

### Overview

Run the whole suite for the first time since f748ba5. The three `absence-form-dialog` tests
execute here for the very first time ever, so this phase carries genuine unknown. Fix test-side
defects; escalate product-side defects out of this change.

### Changes Required:

#### 1. Absence dialog spec — only if it fails

**File**: `tests/e2e/absence-form-dialog.spec.ts`

**Intent**: Repair test-side defects surfaced by the first real execution — a stale locator, a
missing or wrong wait, a selector that resolves ambiguously. No speculative edits: change nothing
unless a run fails.

**Contract**: Triage rule for every failure. If the cause is in the test (locator, wait,
navigation, assertion mechanics), fix it here. If the cause is the clamp feature misbehaving —
the on-blur correction not flooring to `06:00`, not capping at 8 h, or the dialog not rendering
the time inputs — stop, do not touch `src/`, and open a new change folder describing the
reproduction. Record which branch was taken either way.

Known fragile spots to check first if it fails: `:20` navigates to `/dashboard?month=2027-01` and
`:27` clicks `getByText("+").first()` after `networkidle` — both depend on that future month
still having empty cells and on `AbsenceGrid` (`client:load`) having hydrated.

#### 2. Upstream plan bookkeeping

**File**: `context/changes/absence-hours-window/plan.md`

**Intent**: Tick criterion 3.1 ("E2E suite passes: `npm run e2e`", `:524`) once the suite is
actually green, closing the item this change was opened to unblock.

**Contract**: The `## Progress` line for 3.1 flips to `- [x]` with the landing commit sha
appended, per the progress-format convention. Only do this if the run is genuinely green.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm run e2e` — 1 setup + 3 chromium tests, zero failures
- Linting passes: `npm run lint`

#### Manual Verification:

- Every failure encountered during the run was triaged as test-side or product-side, and the
  decision is recorded
- Any product-side defect has its own change folder; the deferral is stated explicitly rather
  than left implicit in a green-ish run
- Criterion 3.1 of `absence-hours-window` is ticked only against a genuinely green run

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 3: Harden the post-deploy health check

### Overview

Replace the generic content grep in the deploy job with assertions on the exact strings the setup
file depends on, so a future copy change to the signin form fails loudly instead of sliding
through.

### Changes Required:

#### 1. Post-deploy health check

**File**: `.github/workflows/ci.yml` — the `Post-deploy health check` step of the `deploy` job

**Intent**: Swap the `grep -qi "sign.in\|email\|login"` assertion (which `id="email"` satisfies,
and which therefore stayed green through f748ba5) for assertions on the accessible names and
label bindings that `tests/e2e/setup/auth.setup.ts` actually resolves against.

**Contract**: Keep the existing HTTP ≥ 500 check and the `--max-time 30 --retry 3 --retry-delay 5`
curl unchanged. Replace the single content grep with a loop over required literals, each checked
via `grep -qF`, exiting 1 on the first miss with a message naming the missing string and pointing
at `tests/e2e/setup/auth.setup.ts` as the file that must be updated in the same change. Required
literals: `Użytkownik / ID`, `Hasło`, `Zaloguj się`, `for="email"`, `for="password"`.

The `-F` and the absence of `-i` are load-bearing — see "Critical Implementation Details".

#### 2. E2E locator conventions — cross-reference

**File**: `tests/e2e/e2e-rules.md`

**Intent**: Note next to the signin locator entry that the deploy job asserts these same strings,
so anyone intentionally renaming the copy knows two files move together.

**Contract**: One sentence appended to the Phase 1 signin entry naming `.github/workflows/ci.yml`.

### Success Criteria:

#### Automated Verification:

- The check's commands succeed against the live deployment when run locally: `curl` the signin
  page and confirm all five literals are present via `grep -qF`
- The CI `deploy` job's `Post-deploy health check` step passes on the push to `main`
- Linting passes: `npm run lint`

#### Manual Verification:

- Negative test: with the fetched page saved locally, grep for a deliberately altered string
  (e.g. `Zaloguj sie` without the diacritic) and confirm the check would exit 1 — proving the
  assertion is not vacuously true
- The failure message names the missing literal and points at `auth.setup.ts`, so a future
  failure is self-explaining without reading the workflow

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

None. No application code changes in this plan — `LoginCardForm.tsx` and `src/` are untouched.

### Integration Tests:

None added. The existing `npm run test:run` suite must stay green but is unaffected.

### Manual Testing Steps:

1. Run `npx playwright test --project=setup` and confirm it authenticates within a few seconds
   rather than timing out at 30 s on `locator.fill`.
2. Inspect `tests/e2e/.auth/user.json` — a fresh mtime and a populated `cookies` array.
3. Run `npm run e2e` and watch all four tests (1 setup + 3 chromium) execute.
4. For any failure, open the trace (`npm run e2e:report`) and classify it as test-side or
   product-side before changing anything.
5. `curl -s https://urlopy.oliwa-bartosz.workers.dev/auth/signin | grep -F 'Użytkownik / ID'` —
   confirm the Phase 3 literals are actually present in the deployed response.
6. Re-run step 5 against a locally mangled copy of the response to confirm the check fails when
   it should.

## Performance Considerations

None. The suite runs `workers: 1`, `fullyParallel: false` against a deployed target; the repair
does not change its runtime. Phase 3 adds four `grep` calls to an existing CI step — immaterial.

## Migration Notes

`tests/e2e/.auth/user.json` is a stale artifact from before the drift. It is regenerated by the
setup project on every run, so no manual cleanup is required; if a stale session causes confusion
during Phase 1, delete it and re-run.

## References

- Change identity: `context/changes/e2e-auth-locators/change.md`
- Blocked criterion: `context/changes/absence-hours-window/plan.md:524` (step 3.1)
- E2E conventions: `tests/e2e/e2e-rules.md`
- E2E-in-CI decision: `context/foundation/test-plan.md:98,118`
- Drift origin: f748ba5 (Polonized `LoginCardForm.tsx`); setup file last touched in d33e34e
- Exemplar spec: `tests/e2e/absence-form-dialog.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Repair the signin locators

#### Automated

- [x] 1.1 Setup project authenticates: `npx playwright test --project=setup` — cf45bbe
- [x] 1.2 Session state written: `tests/e2e/.auth/user.json` fresh with non-empty `cookies` — cf45bbe
- [x] 1.3 Linting passes: `npm run lint` — cf45bbe

#### Manual

- [ ] 1.4 `e2e-rules.md` strings read back identically to `LoginCardForm.tsx:78,122,29`

### Phase 2: Get the full suite green

#### Automated

- [x] 2.1 Full suite passes: `npm run e2e` (1 setup + 3 chromium, zero failures) — 78048f0
- [x] 2.2 Linting passes: `npm run lint` — 78048f0

#### Manual

- [x] 2.3 Every failure triaged test-side vs product-side, decision recorded — 78048f0
- [x] 2.4 Any product-side defect spun out into its own change folder — 78048f0
- [x] 2.5 Criterion 3.1 of `absence-hours-window` ticked against a genuinely green run — 78048f0

### Phase 3: Harden the post-deploy health check

#### Automated

- [x] 3.1 All five literals present in the live response via `curl` + `grep -qF`
- [ ] 3.2 CI `deploy` job's health-check step passes on push to `main`
- [x] 3.3 Linting passes: `npm run lint`

#### Manual

- [ ] 3.4 Negative test: a mangled string makes the check exit 1
- [ ] 3.5 Failure message names the missing literal and points at `auth.setup.ts`
