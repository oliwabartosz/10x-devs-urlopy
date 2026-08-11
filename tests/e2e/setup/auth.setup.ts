import { test as setup, expect } from "@playwright/test";

const authFile = "tests/e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  if (!email || !password) {
    throw new Error("E2E_USER_EMAIL and E2E_USER_PASSWORD must be set in .env to run E2E tests.");
  }

  await page.goto("/auth/signin");
  await page.getByLabel("Użytkownik / ID").fill(email);
  await page.getByLabel("Hasło", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  // Signin redirects to '/' on success, which redirects authenticated users on to
  // /dashboard (src/pages/index.astro) — so '/' is never a settled URL here.
  await page.waitForURL("**/dashboard");
  // Wait for the tab nav — confirms dashboard loaded and auth is valid
  await expect(page.getByRole("link", { name: "Siatka" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
