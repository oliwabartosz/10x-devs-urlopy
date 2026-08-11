---
change_id: e2e-auth-locators
title: Repair the E2E signin locators so the Playwright suite can run again
status: implementing
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
