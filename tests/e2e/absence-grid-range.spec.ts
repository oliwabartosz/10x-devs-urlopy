/**
 * Risk: the range's core claim is *which days it writes*. A drag from Friday to Monday must
 * create exactly the two weekdays and leave the weekend untouched — if the weekend filter
 * breaks, the feature silently books absences on Saturdays, and nothing else in the suite
 * would notice.
 *
 * Risk: a range crossing an existing entry overwrites it, which destroys data — a partial-day
 * training entry replaced by a full-day type loses its hours. The confirmation must appear,
 * must name the affected day and what it currently holds, and „Anuluj" must write nothing.
 *
 * Ref: context/changes/grid-multicheck/plan.md — Phase 6
 * Exemplar: tests/e2e/absence-form-dialog.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

// A far-future month no other spec writes to, so these tests cannot collide with the exemplar's
// 2027-01 or with each other. 1 March 2027 is a Monday, which puts a clean Fri->Mon span mid-month.
const MONTH = "2027-03";
const ANCHOR_DATE = "2027-03-05"; // Friday
const TARGET_DATE = "2027-03-08"; // Monday
const WEEKEND_DATES = ["2027-03-06", "2027-03-07"];
const EXPECTED_WRITTEN = [ANCHOR_DATE, TARGET_DATE];

const MONTH_FROM = "2027-03-01";
const MONTH_TO = "2027-03-31";

const RANGE_HEADING = "Dodaj nieobecność na zakres dni";

interface AbsenceRow {
  id: string;
  employee_id: string;
  date: string;
}

async function listAbsences(page: Page): Promise<AbsenceRow[]> {
  const res = await page.request.get(`/api/absences?from=${MONTH_FROM}&to=${MONTH_TO}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as AbsenceRow[];
}

/** Every row this run created in the test month, for assertions and for cleanup. */
async function listOwnAbsences(page: Page, employeeId: string): Promise<AbsenceRow[]> {
  return (await listAbsences(page)).filter((row) => row.employee_id === employeeId);
}

async function deleteOwnAbsences(page: Page, employeeId: string) {
  for (const row of await listOwnAbsences(page, employeeId)) {
    await page.request.delete(`/api/absences/${row.id}`);
  }
}

async function openGrid(page: Page) {
  await page.goto(`/dashboard?month=${MONTH}`);
  await page.waitForLoadState("networkidle");
}

/** A specific (employee, day) cell. The testid is the only way to address one — see e2e-rules.md. */
function cell(page: Page, employeeId: string, date: string) {
  return page.getByTestId(`absence-cell-${employeeId}-${date}`);
}

/**
 * The signed-in user's employee id, read off the grid itself.
 *
 * `AbsenceGrid` renders the current user's column first (`selfFirst`), so the first cell carrying
 * a given date belongs to them. Encoding the employee id in the testid is what makes this
 * recoverable at all — there is no endpoint that reports "who am I" as an employee row.
 */
async function ownEmployeeId(page: Page): Promise<string> {
  const anyCell = page.getByTestId(new RegExp(`^absence-cell-.*-${ANCHOR_DATE}$`)).first();
  await expect(anyCell).toBeAttached({ timeout: 15_000 });
  const testId = (await anyCell.getAttribute("data-testid")) ?? "";
  return testId.slice("absence-cell-".length, testId.length - ANCHOR_DATE.length - 1);
}

/**
 * Drag from one cell to another and wait for the range dialog.
 *
 * **No pixel geometry appears here.** Playwright derives every point from the located element, so
 * the test names cells, not coordinates. That is the distinction `e2e-rules.md` draws: the rule
 * against pointer drags exists because the *dial* would need the test to compute an angle, which
 * is arithmetic the test would then be asserting against itself. A grid cell needs none of that —
 * the element is the target.
 *
 * Synthesizing the events instead does not work: React derives `onMouseEnter` from delegated
 * `mouseover`/`mouseout` with a `relatedTarget`, so a dispatched `mouseenter` reaches no handler.
 * Driving the real pointer is both simpler and closer to what a user does.
 *
 * Wrapped in `toPass` because the grid is a `client:load` island and a press landing before
 * hydration is swallowed silently — the same hazard the exemplar guards, per e2e-rules.md.
 */
async function dragRange(page: Page, employeeId: string, from: string, to: string) {
  await expect(async () => {
    await cell(page, employeeId, from).hover();
    await page.mouse.down();
    await cell(page, employeeId, to).hover();
    await page.mouse.up();
    await expect(page.getByRole("heading", { name: RANGE_HEADING })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

test.afterEach(async ({ page }) => {
  // Safety net as well as cleanup: re-derives the employee id rather than trusting a variable the
  // test may never have reached, so a mid-test failure still leaves the month empty.
  await openGrid(page);
  await deleteOwnAbsences(page, await ownEmployeeId(page));
});

test("a range spanning a weekend writes only the weekdays", async ({ page }) => {
  await openGrid(page);
  const employeeId = await ownEmployeeId(page);
  await deleteOwnAbsences(page, employeeId);
  await openGrid(page);

  await dragRange(page, employeeId, ANCHOR_DATE, TARGET_DATE);

  // The heading is the first place the weekend filter is visible: four calendar days dragged,
  // two working days reported. A broken filter would say "4 dni robocze" here.
  await expect(page.getByText("5–8 marca · 2 dni robocze")).toBeVisible();

  await page.getByRole("radio", { name: "choroba" }).click();
  await page.getByRole("button", { name: "Zapisz" }).click();

  // The save reloads the page, so waiting for the written cell to render its chip is what carries
  // the test across the reload without a timeout.
  await expect(cell(page, employeeId, ANCHOR_DATE).getByRole("img")).toBeVisible({ timeout: 20_000 });

  // The claim itself, asserted against the stored rows rather than the DOM: exactly the two
  // weekdays exist, and neither weekend day does.
  const written = (await listOwnAbsences(page, employeeId)).map((row) => row.date).sort();
  expect(written).toEqual(EXPECTED_WRITTEN);
  for (const weekendDate of WEEKEND_DATES) {
    expect(written).not.toContain(weekendDate);
  }
});

test("a range crossing an entry confirms before overwriting, and Anuluj writes nothing", async ({ page }) => {
  await openGrid(page);
  const employeeId = await ownEmployeeId(page);
  await deleteOwnAbsences(page, employeeId);
  await openGrid(page);

  // Seed one entry inside the range, through the ordinary single-cell path. Done in the UI rather
  // than the API because no endpoint reports absence type ids, and it doubles as a check that
  // click-to-add still works with the drag handlers attached.
  await expect(async () => {
    await cell(page, employeeId, TARGET_DATE).click();
    await expect(page.getByRole("heading", { name: "Dodaj nieobecność", exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("radio", { name: "choroba" }).click();
  await page.getByRole("button", { name: "Zapisz" }).click();
  await expect(cell(page, employeeId, TARGET_DATE).getByRole("img")).toBeVisible({ timeout: 20_000 });

  const seeded = await listOwnAbsences(page, employeeId);
  expect(seeded.map((row) => row.date)).toEqual([TARGET_DATE]);

  // Now drag a range across it and choose a different type, so the confirmation must name the
  // *existing* one rather than the one being written.
  await dragRange(page, employeeId, ANCHOR_DATE, TARGET_DATE);
  await page.getByRole("radio", { name: "wyjazd zagraniczny" }).click();
  await page.getByRole("button", { name: "Zapisz" }).click();

  // The confirmation, and what it must say: which day, and what that day currently holds. A count
  // alone would not tell the user what an overwrite destroys.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Czy na pewno chcesz nadpisać 1 istniejący wpis?")).toBeVisible();
  await expect(dialog.getByText("8 marca")).toBeVisible();
  await expect(dialog.getByText("choroba")).toBeVisible();

  // „Anuluj" on the confirmation steps back to the form rather than closing, and writes nothing.
  await dialog.getByRole("button", { name: "Anuluj" }).click();
  await expect(dialog.getByRole("radio", { name: "wyjazd zagraniczny" })).toBeChecked();

  await dialog.getByRole("button", { name: "Anuluj" }).click();
  await expect(page.getByRole("heading", { name: RANGE_HEADING })).not.toBeVisible();

  // Nothing written: the seeded row is untouched and still the only one, with its original id.
  const after = await listOwnAbsences(page, employeeId);
  expect(after.map((row) => row.date)).toEqual([TARGET_DATE]);
  expect(after.map((row) => row.id)).toEqual(seeded.map((row) => row.id));
});
