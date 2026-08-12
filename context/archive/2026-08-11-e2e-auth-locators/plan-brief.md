# E2E Signin Locator Repair — Plan Brief

> Full plan: `context/changes/e2e-auth-locators/plan.md`

## What & Why

The Playwright suite has not run since f748ba5 Polonized the login form. `auth.setup.ts` still
fills `getByLabel("Email")` / `getByLabel("Password")` and clicks `getByRole("button", { name:
"Sign in" })` — none of which exist any more — so the `setup` project times out after 30 s and
every dependent test dies at the gate. This blocks criterion 3.1 of `absence-hours-window` and
every future E2E run.

## Starting Point

`LoginCardForm.tsx` renders `Użytkownik / ID` (`:78`), `Hasło` (`:122`), and `Zaloguj się`
(`:29`); the password-visibility toggle carries `aria-label="Pokaż hasło"` (`:153`), which is why
the password locator needs `{ exact: true }` — it already has it. `playwright.config.ts:48` makes
`chromium` depend on `setup`, so the three `absence-form-dialog` tests written in 70ff594 have
**never executed once**. CI runs lint → test → build → deploy → a `curl` health check that greps
for `sign.in\|email\|login` — which `id="email"` still satisfies, so it stayed green throughout.

## Desired End State

`npm run e2e` runs green end to end: setup authenticates, writes `user.json`, and all three
dialog tests pass. The canonical signin locators are documented in `e2e-rules.md` next to the
grid and dialog ones. The deploy job asserts the actual rendered strings, so the next copy change
to the signin form turns CI red instead of sliding through.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Drift guard | Harden the existing post-deploy health check | ~3 lines in a step that already runs and already hard-fails; would have caught f748ba5 same-day while honoring `test-plan.md`'s "no E2E in CI for MVP". |
| `data-testid`? | No | Contradicts `e2e-rules.md:5-7` and breaks a codebase with zero testids; accessible names stay the strategy. |
| E2E in CI? | No | Reverses an explicit MVP decision; needs browser installs, secrets, and a managed prod test account. |
| Repair scope | Setup file + `e2e-rules.md` entry | The "Project-specific locators" section documents grid/dialog/tab-nav but not signin — that is where the `exact: true` gotcha belongs. |
| Verification bar | Full `npm run e2e` green | Criterion 3.1 needs the whole suite, and the three p3 tests are unverified code until they actually run. |
| p3 failures | Fix test-side, spin out product-side | Keeps this change owning "the suite can run" without absorbing a clamp regression into a test-repair PR. |
| Check strictness | Hard fail, post-deploy | Matches the step's existing 500/grep semantics; forces `ci.yml` and `auth.setup.ts` to move together on an intentional rename. |

## Scope

**In scope:** the three locator strings in `auth.setup.ts`; a signin entry in `e2e-rules.md`;
running the full suite and fixing test-side defects; hardening the `ci.yml` health check; ticking
3.1 in the `absence-hours-window` plan.

**Out of scope:** `data-testid`; wiring `npm run e2e` into CI; changing `LoginCardForm.tsx`;
fixing clamp-feature bugs; touching the Playwright project topology; a by-hand locator audit.

## Architecture / Approach

Three sequential gates. Repair first, gated on `--project=setup` alone so the fix is isolated
from the never-run tests. Then the full suite, where the genuine unknown lives. Then the guard —
last on purpose, since hardening a check against strings the suite has not yet confirmed would be
asserting an assumption. The check itself is a `curl` + `grep -qF` over five literals
(`Użytkownik / ID`, `Hasło`, `Zaloguj się`, `for="email"`, `for="password"`), all verified present
in the deployed server-rendered HTML.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Repair locators | `setup` authenticates; signin locators documented | Low — three strings, verified against the live page |
| 2. Full suite green | 1 setup + 3 chromium tests pass; 3.1 unblocked | The p3 tests have never run; `getByText("+").first()` on `2027-01` after `networkidle` is the fragile spot |
| 3. Harden CI check | Deploy job fails on signin copy drift | Non-ASCII grep in CI (`-F`, no `-i`); `Zaloguj się` appears twice, so label bindings are asserted too |

**Prerequisites:** `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` in `.env` (already present), network
access to the deployment. Phase 3's CI gate only closes on a push to `main`.
**Estimated effort:** ~1 session; Phase 1 is minutes, Phase 2's length depends entirely on what
the first-ever run of the p3 tests reveals.

## Open Risks & Assumptions

- The three `absence-form-dialog` tests are unverified code. Phase 2 could surface a real clamp
  bug, which would leave 3.1 blocked pending a separate change — that outcome is accepted, not
  worked around.
- `openPartialDayDialog` assumes `2027-01` still has empty cells and that `AbsenceGrid` has
  hydrated by `networkidle`; either assumption could produce a flake unrelated to this repair.
- The hardened check is post-deploy, so it alarms after bad code is live rather than gating merge.
- Coupling `ci.yml` to UI copy means an intentional rename costs an extra file edit — deliberate,
  since that coupling is exactly what was missing.

## Success Criteria (Summary)

- `npm run e2e` completes green against the deployment — the suite is usable again.
- Criterion 3.1 of `absence-hours-window` is checked off against a real run.
- Renaming a signin label without updating the tests turns the deploy job red.
