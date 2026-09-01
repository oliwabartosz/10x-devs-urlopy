/**
 * Risk: AbsenceFormDialog must reveal two time-range inputs when "Cały dzień"
 * is unchecked, and hide them when it is re-checked.
 *
 * Risk: the dialog must correct an out-of-window range on blur — floor the start to
 * 06:00 and cap the duration at 8 h — so the user sees the value that will be stored
 * rather than discovering the server's correction after the reload.
 *
 * Risk: the radial dial is a second path onto the same two values. A handle moved on the
 * dial must write straight back into the field it is bound to, in quarter-hour steps, and
 * Escape must dismiss only the dial — if either breaks, the pointer path silently disagrees
 * with the typed one.
 *
 * Risk: `choroba` covers both a sick note and care leave, which the bare label does not say. The
 * picker must carry the clarifying caption, and it must reach the radio's accessible name — that
 * name is the only contract the rest of the suite binds to, since this codebase has no testids.
 *
 * Risk: the dial's hard stops are the change's headline behaviour — a handle that could reach
 * a value the server then rewrites would reproduce the very symptom this change removes. The
 * 06:00 floor and the 8 h cap must be unreachable from either handle, not merely corrected
 * after the fact.
 *
 * Ref: context/changes/absence-hours-range/plan.md — Phase 3, steps 3.3–3.5
 *      context/changes/absence-hours-window/plan.md — Phase 3
 *      context/changes/radial-timepicker-ux/plan.md — Phase 4
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

  // `networkidle` is a first pass, not a guarantee: it says the requests stopped, not that React
  // attached its handlers. A click that lands early is swallowed by the DOM and surfaces later as
  // a dialog that never opened — observed intermittently on this very locator. So click and assert
  // together and let `toPass` retry the pair, per `e2e-rules.md:36-37,76-80`.
  await expect(async () => {
    await page.getByText("+").first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  // The full-day toggle and the time inputs are gated behind `canBePartialDay`
  // (AbsenceFormDialog.tsx) — only the two training types in PARTIAL_DAY_TYPE_NAMES
  // (src/lib/absence-types.ts) may carry a range, and no type is selected on open.
  // Without this step the dialog renders neither control, by design.
  await page.getByRole("radio", { name: "szkolenie w miejscu pracy" }).click();
  await expect(page.getByRole("checkbox", { name: "Cały dzień" })).toBeVisible();
}

test("the choroba radio carries the clarifying caption in its accessible name", async ({ page }) => {
  await openPartialDayDialog(page);

  // Asserted on the accessible name rather than on the text node, because the name is what the
  // rest of the suite resolves `choroba` by — six locators in absence-grid-range.spec.ts match it
  // by substring. If the caption ever stops being rendered inside the button, those keep passing
  // while this one fails, which is the point of stating it here.
  const sick = page.getByRole("radio", { name: "choroba" });
  await expect(sick).toHaveCount(1);
  await expect(sick).toHaveAccessibleName(/choroba\s+zwolnienie lub opieka/);

  // No other type gains one: the caption is additive, not a label map.
  await expect(page.getByRole("radio", { name: "zwolnienie lub opieka" })).toHaveCount(1);

  await page.getByRole("button", { name: "Anuluj" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

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
  // A correction nobody is told about is the second symptom this change exists to remove, so the
  // rewrite has to be announced as well as applied. The notice is deferred (see
  // `announceCorrection`), hence a text assertion rather than an immediate one.
  await expect(page.getByText("Poprawiono początek na 06:00")).toBeVisible();

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
  await expect(page.getByText("Poprawiono koniec na 16:00")).toBeVisible();

  await page.getByRole("button", { name: "Anuluj" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("the dial writes a keyboard-moved handle back into the bound field", async ({ page }) => {
  await openPartialDayDialog(page);
  await page.getByRole("checkbox", { name: "Cały dzień" }).uncheck();

  const startInput = page.getByLabel("Czas od");
  const endInput = page.getByLabel("Czas do");
  // A legal range to begin with, so nothing the blur clamp does can be mistaken for the dial.
  await startInput.fill("08:00");
  await endInput.fill("12:00");
  await endInput.blur();

  await page.getByRole("button", { name: "Wybierz godziny na tarczy zegara" }).click();

  const startHandle = page.getByRole("slider", { name: "Godzina rozpoczęcia" });
  const endHandle = page.getByRole("slider", { name: "Godzina zakończenia" });
  // Positive assertions first: a `not.toBeVisible()` on a renamed locator resolves to nothing
  // and passes, so the dismissal check further down only means something once these have run.
  await expect(startHandle).toBeVisible();
  await expect(endHandle).toBeVisible();
  await expect(startHandle).toHaveAttribute("aria-valuetext", "08:00");
  await expect(endHandle).toHaveAttribute("aria-valuetext", "12:00");

  // Keyboard rather than a pointer drag: one ArrowUp is exactly one quarter-hour step, so the
  // assertion is deterministic where a synthesized drag would depend on pixel geometry.
  await startHandle.focus();
  await page.keyboard.press("ArrowUp");

  await expect(startHandle).toHaveAttribute("aria-valuetext", "08:15");
  await expect(startInput).toHaveValue("08:15");
  // The anchored handle must not drift when the other one moves.
  await expect(endHandle).toHaveAttribute("aria-valuetext", "12:00");
  await expect(endInput).toHaveValue("12:00");

  // Escape dismisses the popover's own layer only. The form stays open, holding the value the
  // dial just wrote — see the portal note in `src/components/ui/popover.tsx`.
  await page.keyboard.press("Escape");
  await expect(startHandle).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Dodaj nieobecność" })).toBeVisible();
  await expect(startInput).toHaveValue("08:15");

  await page.getByRole("button", { name: "Anuluj" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("the dial's handles stop at the 06:00 floor and the 8 h cap", async ({ page }) => {
  await openPartialDayDialog(page);
  await page.getByRole("checkbox", { name: "Cały dzień" }).uncheck();

  const startInput = page.getByLabel("Czas od");
  const endInput = page.getByLabel("Czas do");
  await startInput.fill("08:00");
  await endInput.fill("12:00");
  await endInput.blur();

  await page.getByRole("button", { name: "Wybierz godziny na tarczy zegara" }).click();

  const startHandle = page.getByRole("slider", { name: "Godzina rozpoczęcia" });
  const endHandle = page.getByRole("slider", { name: "Godzina zakończenia" });
  await expect(startHandle).toBeVisible();
  await expect(endHandle).toBeVisible();

  // Home is that handle's legal extreme, so it lands exactly on the floor rather than near it.
  await startHandle.focus();
  await page.keyboard.press("Home");
  await expect(startHandle).toHaveAttribute("aria-valuetext", "06:00");
  await expect(startInput).toHaveValue("06:00");

  // The stop itself: one more step in the same direction must be refused outright. `commit`
  // returns early when the constrained pair is unchanged, so a working stop shows up as a value
  // that does not move — which only means something because the press above proved the key works.
  await page.keyboard.press("ArrowDown");
  await expect(startHandle).toHaveAttribute("aria-valuetext", "06:00");
  await expect(startInput).toHaveValue("06:00");

  // The end's extreme is `start + 8 h` (14:00), not 23:59 — the duration cap, not the day's end.
  await endHandle.focus();
  await page.keyboard.press("End");
  await expect(endHandle).toHaveAttribute("aria-valuetext", "14:00");
  await expect(endInput).toHaveValue("14:00");

  await page.keyboard.press("ArrowUp");
  await expect(endHandle).toHaveAttribute("aria-valuetext", "14:00");
  await expect(endInput).toHaveValue("14:00");

  // Widening from the other side is the case a per-handle clamp gets wrong: with the end at 14:00
  // the start is pinned at 06:00 by the cap measured backwards, so it cannot retreat either.
  await startHandle.focus();
  await page.keyboard.press("ArrowDown");
  await expect(startInput).toHaveValue("06:00");
  await expect(endInput).toHaveValue("14:00");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Anuluj" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
