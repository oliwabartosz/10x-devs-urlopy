# E2E Testing Rules — urlopy

## Locators

- Use `getByRole`, `getByLabel`, `getByText` as primary locators.
- Fall back to `getByTestId` only when no accessible name exists.
- Never use CSS selectors, XPath, or DOM structure (`.locator('.some-class')`).

## Waiting

- Never use `page.waitForTimeout()`. Wait for concrete state:
  `toBeVisible()`, `waitForURL()`, `waitForResponse()`.

## Test independence

- Each test must be self-contained: own setup → action → assertion → cleanup.
- Never rely on state left by a previous test.
- Use unique identifiers (e.g., `Date.now()` suffix) for any created test data.
- Always clean up created DB rows in `afterEach` / at test end.

## Authentication

- Always authenticate via `storageState` (set up in `tests/e2e/setup/auth.setup.ts`).
- Never log in through the UI inside individual tests.

## Assertions

- Assert the **business outcome**, not implementation details.
- Every assertion must fail when its named risk materialises — if it stays
  green when you break the feature, it's decorative.

## Scope

- Target: `BASE_URL` env var (default: production Workers deployment).
- Do NOT point `BASE_URL` at `wrangler dev` — TLS rejects the Supabase cert.
- `astro dev` lacks Workers runtime; use only if the test needs no DB.

## Project-specific locators

- Time inputs in AbsenceFormDialog: `locator("#start-time")` / `locator("#end-time")`.
  (These have `aria-label="Czas od"` / `aria-label="Czas do"` in the codebase —
  switch to `getByLabel("Czas od")` / `getByLabel("Czas do")` once deployed.)
- Full-day toggle: `getByRole("checkbox", { name: "Cały dzień" })`.
- Empty grid cell: `getByText("+")` after `waitForLoadState("networkidle")` to ensure
  React island (client:load) has hydrated and onClick handlers are attached.
- Form dialog: `getByRole("dialog")` scoped to `getByRole("heading", { name: … })`.
- Tab navigation: `getByRole("link", { name: "Siatka" })` — reliable dashboard-loaded signal.

## Exemplar

`tests/e2e/absence-form-dialog.spec.ts` is the seed — model all new tests on its structure.
