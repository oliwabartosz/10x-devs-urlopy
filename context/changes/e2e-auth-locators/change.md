---
change_id: e2e-auth-locators
title: Repair the E2E signin locators so the Playwright suite can run again
status: implemented
created: 2026-08-11
updated: 2026-08-11
archived_at: null
---

## Notes

Repair `tests/e2e/setup/auth.setup.ts`, whose signin locators (`getByLabel("Email")`,
`getByLabel("Password")`, `getByRole("button", { name: "Sign in" })`) have been broken since
f748ba5 Polonized `LoginCardForm.tsx` to "Użytkownik / ID", "Hasło" and "Zaloguj się". The whole
Playwright suite fails at the setup project, so no E2E test has run since; this blocks criterion
3.1 of absence-hours-window and every future E2E run.

### Established facts (from the absence-hours-window implementation run, 2026-08-11)

- Failure mode: `setup` project times out after 30 s on `locator.fill` waiting for
  `getByLabel('Email')`. The three dependent `chromium` tests never start.
- The deployed page confirms the drift — `curl` of `/auth/signin` returns
  `<label for="email">Użytkownik / ID</label>` and `<label for="password">Hasło</label>`.
- Current markup lives in `src/components/auth/LoginCardForm.tsx`: labels at `:78` and `:122`,
  submit button text "Zaloguj się" at `:29` (inside `LightSubmitButton`, `type="submit"`).
- Gotcha: the password-visibility toggle carries `aria-label="Pokaż hasło"` / `"Ukryj hasło"`
  (`:153`), so the password locator needs `{ exact: true }` to avoid matching it.
- `auth.setup.ts` was last touched in d33e34e (absence-hours-range p3) and predates f748ba5.
- Worth considering beyond the three locators: the accessible names are now the only thing
  binding the setup file to the form, and nothing failed loudly when they drifted. Whether that
  should be a data-testid, a smoke test in CI, or left as-is is a real question for the plan —
  CI runs lint + build + deploy but never `npm run e2e`, which is why this went unnoticed for
  a day.

### Phase 2 triage record (2026-08-11)

The first full run surfaced two distinct failures. Both were triaged **test-side** and fixed in
`tests/e2e/`; no product-side defect was found, so no new change folder was opened.

**Failure 1 — `setup` timed out on `waitForURL("**/dashboard")`.** Not a locator problem: the
three Phase 1 locators resolved fine. The error snapshot showed both fields *empty* and the form
re-rendered with its client-side validation errors ("Podaj adres email" / "Podaj hasło"), which
only `validate()` in `LoginCardForm.tsx:47` produces. `LoginCardForm` is a `client:load` island
(`signin.astro:26`) with controlled inputs (`value={email}`, `:90`/`:134`), so a `fill()` that
lands before hydration writes to the DOM but never to React state, and hydration then resets the
fields — the submit posts nothing. Phase 1 passed in 2.3 s because it won that race; three
consecutive re-runs later failed it. **Test-side**: `auth.setup.ts` now waits for
`networkidle` before typing and asserts `toHaveValue` on both fields, so a future regression
fails in seconds with a legible message instead of timing out on `waitForURL`.

**Failure 2 — all three `absence-form-dialog` tests: `getByRole("checkbox", { name: "Cały
dzień" })` not found.** The dialog renders the full-day toggle and the time inputs behind
`canBePartialDay` (`AbsenceFormDialog.tsx:231`), which is false until an absence type in
`PARTIAL_DAY_TYPE_NAMES` (`src/lib/absence-types.ts:11` — the two training types) is selected.
A freshly opened add-dialog has `absenceTypeId === null`, so neither control exists. This is the
documented domain rule working correctly, **not** the clamp feature misbehaving — the plan's
Phase 2 stop-rule names "the dialog not rendering the time inputs" as a product-side symptom,
but that branch is predicated on the feature misbehaving, and here it does not. **Test-side**:
the spec had never executed once (blocked at `setup` since f748ba5), so it had never been
confirmed against the real dialog. `openPartialDayDialog` now selects
"szkolenie w miejscu pracy" and waits for the toggle before returning.

After both fixes: 3 consecutive green full runs (1 setup + 3 chromium, ~12 s each).

### Open criterion at close (2026-08-12)

Criterion 3.2 ("CI `deploy` job's health-check step passes on push to `main`") is the one item
left `- [ ]`. It cannot be satisfied locally: the `deploy` job is gated on
`github.event_name == 'push' && github.ref == 'refs/heads/main'`, and this change's four commits
are still unpushed. The check's assertions were verified by hand instead — all five literals
present in the live response, and a mangled literal confirmed to exit 1 — but the job itself has
never run them.

**Tick 3.2 on the next push to `main`**, against the real CI run rather than the manual proof.
Until then the plan is closed with one unverified assertion, deliberately and visibly.
