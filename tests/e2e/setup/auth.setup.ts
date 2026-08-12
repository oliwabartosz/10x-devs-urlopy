import { test as setup, expect } from "@playwright/test";

const authFile = "tests/e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  if (!email || !password) {
    throw new Error("E2E_USER_EMAIL and E2E_USER_PASSWORD must be set in .env to run E2E tests.");
  }

  await page.goto("/auth/signin");
  // LoginCardForm is a React island (client:load) with controlled inputs. Filling before
  // hydration writes to the DOM but never to React state, and hydration then resets the
  // fields — validate() then blocks the submit with preventDefault(), so no POST is ever
  // issued and waitForURL below times out at 30 s with nothing to explain it.
  //
  // networkidle is only a cheap proxy for "the island's script arrived": it settles after
  // 500 ms of no requests, which a warm cache or Astro's 1 s importWithRetry backoff can
  // both satisfy before hydrateRoot commits. A one-shot toHaveValue does not close that
  // either — web-first assertions return on their first passing poll, so a wipe landing
  // just after it still gets through. Re-fill until the values stick instead.
  await page.waitForLoadState("networkidle");

  const emailInput = page.getByLabel("Użytkownik / ID");
  const passwordInput = page.getByLabel("Hasło", { exact: true });
  await expect(async () => {
    await emailInput.fill(email);
    await passwordInput.fill(password);
    // Short inner timeouts: a wipe should cost one fast iteration, not the whole budget.
    await expect(emailInput).toHaveValue(email, { timeout: 1000 });
    await expect(passwordInput).toHaveValue(password, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  await page.getByRole("button", { name: "Zaloguj się" }).click();

  // A rejected credential redirects to /?error=<supabase message> (src/pages/api/auth/signin.ts),
  // and '/' renders the login card for an unauthenticated user — so without this the failure is
  // indistinguishable from a hydration wipe: an opaque 30 s waitForURL timeout with the actual
  // error sitting unread in the query string.
  await expect(page).not.toHaveURL(/error=/);

  // Signin redirects to '/' on success, which redirects authenticated users on to
  // /dashboard (src/pages/index.astro) — so '/' is never a settled URL here.
  await page.waitForURL("**/dashboard");
  // Wait for the tab nav — confirms dashboard loaded and auth is valid
  await expect(page.getByRole("link", { name: "Siatka" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
