/**
 * Risk: AbsenceFormDialog must reveal two time-range inputs when "Cały dzień"
 * is unchecked, and hide them when it is re-checked.
 *
 * Risk: the dialog must correct an out-of-window range on blur — floor the start to
 * 06:00 and cap the duration at 8 h — so the user sees the value that will be stored
 * rather than discovering the server's correction after the reload.
 *
 * Ref: context/changes/absence-hours-range/plan.md — Phase 3, steps 3.3–3.5
 *      context/changes/absence-hours-window/plan.md — Phase 3
 * Exemplar: this file also serves as the seed pattern for future E2E tests.
 */
import { test, expect } from "@playwright/test";

// Opens the add-absence dialog on an empty cell of a future month and selects an absence
// type that may carry a time range, which is what puts "Cały dzień" on screen. No DB writes
// happen — every test below closes with "Anuluj", so no cleanup is needed.
async function openPartialDayDialog(page: import("@playwright/test").Page) {
  // Navigate to a future month guaranteed to have empty cells — no test data needed
  await page.goto("/dashboard?month=2027-01");
  // Wait for the React island (AbsenceGrid, client:load) to fully hydrate
  // before clicking — the tab link is Astro static HTML and becomes visible
  // before React attaches onClick handlers to the grid cells.
  await page.waitForLoadState("networkidle");

  // Open the form dialog by clicking any empty clickable cell (shows '+')
  await page.getByText("+").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // The full-day toggle and the time inputs are gated behind `canBePartialDay`
  // (AbsenceFormDialog.tsx) — only the two training types in PARTIAL_DAY_TYPE_NAMES
  // (src/lib/absence-types.ts) may carry a range, and no type is selected on open.
  // Without this step the dialog renders neither control, by design.
  await page.getByRole("radio", { name: "szkolenie w miejscu pracy" }).click();
  await expect(page.getByRole("checkbox", { name: "Cały dzień" })).toBeVisible();
}

test("form dialog reveals time-range inputs when partial-day is selected", async ({ page }) => {
  await openPartialDayDialog(page);
  await expect(page.getByRole("heading", { name: "Dodaj nieobecność" })).toBeVisible();

  // Default state: "Cały dzień" checked → time inputs must not be visible
  const checkbox = page.getByRole("checkbox", { name: "Cały dzień" });
  await expect(checkbox).toBeChecked();
  const startInput = page.getByLabel("Czas od");
  const endInput = page.getByLabel("Czas do");
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

test("blurring the time inputs floors a start before 06:00", async ({ page }) => {
  await openPartialDayDialog(page);
  await page.getByRole("checkbox", { name: "Cały dzień" }).uncheck();

  const startInput = page.getByLabel("Czas od");
  const endInput = page.getByLabel("Czas do");
  await startInput.fill("04:00");
  await endInput.fill("13:00");
  await endInput.blur();

  await expect(startInput).toHaveValue("06:00");
  // The end is inside the 8 h cap measured from the floored start, so it must not move.
  await expect(endInput).toHaveValue("13:00");

  await page.getByRole("button", { name: "Anuluj" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("blurring the time inputs caps a range longer than 8 h", async ({ page }) => {
  await openPartialDayDialog(page);
  await page.getByRole("checkbox", { name: "Cały dzień" }).uncheck();

  const startInput = page.getByLabel("Czas od");
  const endInput = page.getByLabel("Czas do");
  await startInput.fill("08:00");
  await endInput.fill("20:00");
  await endInput.blur();

  // Start is already past the floor, so only the end is pulled back — to start + 8 h.
  await expect(startInput).toHaveValue("08:00");
  await expect(endInput).toHaveValue("16:00");

  await page.getByRole("button", { name: "Anuluj" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
