# E2E Testing Rules — urlopy

## Locators

- Use `getByRole`, `getByLabel`, `getByText` as primary locators.
- Fall back to `getByTestId` only when no accessible name exists.
- Never use CSS selectors, XPath, or DOM structure (`.locator('.some-class')`).

## Waiting

- Never use `page.waitForTimeout()`. Wait for concrete state:
  `toBeVisible()`, `waitForURL()`, `waitForResponse()`.

### Waiting for island hydration

`waitForLoadState("networkidle")` is a **proxy, not a barrier**. It settles after 500 ms with no
in-flight requests, which is not the same as "hydrateRoot committed": a warm cache produces no
requests at all, and Astro's `importWithRetry` sleeps 1 s between attempts — a window with zero
traffic. Use it as a cheap first pass, never as a guarantee.

For anything that must survive a pre-hydration interaction, make the step **self-healing** rather
than one-shot. Controlled React inputs are the sharp case: a `fill()` that lands before hydration
writes to the DOM but not to React state, hydration then resets the field, and the submit posts
nothing. A single `toHaveValue()` does not catch this either — web-first assertions return on
their first passing poll, so a wipe landing just after still gets through. Re-fill until it
sticks (`tests/e2e/setup/auth.setup.ts` is the reference):

```ts
await expect(async () => {
  await input.fill(value);
  await expect(input).toHaveValue(value, { timeout: 1000 });
}).toPass({ timeout: 15_000 });
```

The same applies to clicking a not-yet-hydrated element: the click succeeds against the DOM, no
handler runs, and the failure surfaces later as a missing dialog. Prefer `toPass()` around
click-then-assert over trusting `networkidle` alone.

## Test independence

- Each test must be self-contained: own setup → action → assertion → cleanup.
- Never rely on state left by a previous test.
- Use unique identifiers (e.g., `Date.now()` suffix) for any created test data.
- Always clean up created DB rows in `afterEach` / at test end.

## Authentication

- Always authenticate via `storageState` (set up in `tests/e2e/setup/auth.setup.ts`).
- Never log in through the UI inside individual tests.
- After a successful signin the POST redirects to `/`, which redirects authenticated users
  on to `/dashboard` (`src/pages/index.astro`). Wait for `**/dashboard`, never for `/` —
  `/` is never a settled URL for an authenticated session.

## Assertions

- Assert the **business outcome**, not implementation details.
- Every assertion must fail when its named risk materialises — if it stays
  green when you break the feature, it's decorative.

## Scope

- Target: `BASE_URL` env var (default: production Workers deployment).
- Do NOT point `BASE_URL` at `wrangler dev` — TLS rejects the Supabase cert.
- `astro dev` lacks Workers runtime; use only if the test needs no DB.

## Project-specific locators

- Time inputs in AbsenceFormDialog: `getByLabel("Czas od")` / `getByLabel("Czas do")`. One clock
  button beside the pair opens the radial dial holding both ends:
  `getByRole("button", { name: "Wybierz godziny na tarczy zegara" })`. The dial's two handles are
  `getByRole("slider", { name: "Godzina rozpoczęcia" })` / `{ name: "Godzina zakończenia" }`, read
  through `aria-valuetext` (`"HH:MM"`). Drive them with the keyboard — a pointer drag depends on
  pixel geometry. While the dial is open its `PopoverContent` is a second `role="dialog"`, so
  `getByRole("dialog")` is only unambiguous with the dial closed.
- Full-day toggle: `getByRole("checkbox", { name: "Cały dzień" })`.
- Empty grid cell: `getByText("+")`, after `waitForLoadState("networkidle")` as a first pass.
  Note this does **not** guarantee `AbsenceGrid` (client:load) has attached its onClick handlers
  — see "Waiting for island hydration". A click that lands early is silently swallowed and shows
  up later as a dialog that never opened; this has been observed intermittently. Prefer wrapping
  the click and the `expect(dialog).toBeVisible()` in a single `toPass()`.
- Form dialog: `getByRole("dialog")` scoped to `getByRole("heading", { name: … })`.
- Tab navigation: `getByRole("link", { name: "Siatka" })` — reliable dashboard-loaded signal.
- Signin form (`LoginCardForm.tsx`): `getByLabel("Użytkownik / ID")` for email,
  `getByLabel("Hasło", { exact: true })` for password, and
  `getByRole("button", { name: "Zaloguj się" })` for submit. `exact: true` on the password label
  is required because the visibility toggle's `aria-label` ("Pokaż hasło" / "Ukryj hasło")
  contains `hasło`. The `Post-deploy health check` step in `.github/workflows/ci.yml` asserts
  these same strings, so renaming the copy means moving both files in one change.

## Exemplar

`tests/e2e/absence-form-dialog.spec.ts` is the seed — model all new tests on its structure.
