/**
 * Seed test — E2E quality exemplar for this project.
 *
 * Risk: AbsenceFormDialog must reveal two time-range inputs when "Cały dzień"
 * is unchecked, and hide them when it is re-checked.
 *
 * Ref: context/changes/absence-hours-range/plan.md — Phase 3, steps 3.3–3.5
 * Seed pattern: references/seed-test-pattern.md
 */
import { test, expect } from "@playwright/test";

test("form dialog reveals time-range inputs when partial-day is selected", async ({ page }) => {
  // Navigate to a future month guaranteed to have empty cells — no test data needed
  await page.goto("/dashboard?month=2027-01");
  // Wait for the React island (AbsenceGrid, client:load) to fully hydrate
  // before clicking — the tab link is Astro static HTML and becomes visible
  // before React attaches onClick handlers to the grid cells.
  await page.waitForLoadState("networkidle");

  // Open the form dialog by clicking any empty clickable cell (shows '+')
  await page.getByText("+").first().click();

  // Verify the add-absence dialog opened
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dodaj nieobecność" })).toBeVisible();

  // Default state: "Cały dzień" checked → time inputs must not be visible
  const checkbox = page.getByRole("checkbox", { name: "Cały dzień" });
  await expect(checkbox).toBeChecked();
  // ID-based locators: inputs have id="start-time"/"end-time" but no aria-label yet
  // (aria-label="Czas od"/"Czas do" will be present after the next deployment;
  //  switch to getByLabel("Czas od") / getByLabel("Czas do") at that point)
  const startInput = page.locator("#start-time");
  const endInput = page.locator("#end-time");
  await expect(startInput).not.toBeVisible();
  await expect(endInput).not.toBeVisible();

  // Uncheck "Cały dzień" — time-range inputs must appear
  await checkbox.uncheck();
  await expect(startInput).toBeVisible();
  await expect(endInput).toBeVisible();

  // Re-check "Cały dzień" — time-range inputs must disappear
  await checkbox.check();
  await expect(startInput).not.toBeVisible();
  await expect(endInput).not.toBeVisible();

  // Close without saving — no cleanup needed (no DB writes occurred)
  await page.getByRole("button", { name: "Anuluj" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
