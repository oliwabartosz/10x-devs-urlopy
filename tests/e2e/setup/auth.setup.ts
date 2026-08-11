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
  // fields — the submit posts nothing and the form re-renders with "Podaj adres email".
  // Wait for the island's script to land before typing.
  await page.waitForLoadState("networkidle");

  const emailInput = page.getByLabel("Użytkownik / ID");
  const passwordInput = page.getByLabel("Hasło", { exact: true });
  await emailInput.fill(email);
  await passwordInput.fill(password);
  // Fail fast and legibly here if hydration ever wipes the fields again, instead of
  // timing out 30 s later on waitForURL with an empty-form redirect.
  await expect(emailInput).toHaveValue(email);
  await expect(passwordInput).toHaveValue(password);

  await page.getByRole("button", { name: "Zaloguj się" }).click();

  // Signin redirects to '/' on success, which redirects authenticated users on to
  // /dashboard (src/pages/index.astro) — so '/' is never a settled URL here.
  await page.waitForURL("**/dashboard");
  // Wait for the tab nav — confirms dashboard loaded and auth is valid
  await expect(page.getByRole("link", { name: "Siatka" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
