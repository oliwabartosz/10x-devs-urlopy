# Bulk Delete of Absences from the Grid Selection — Implementation Plan

## Overview

Add a second action to the monthly grid's drag selection: deleting the absences the selected run
already holds. Today the gesture has exactly one action — open the range dialog, which writes N days
in one upsert. "Bulk add" and "bulk change type" are the same `POST /api/absences/bulk` call, so
delete is the genuine second verb.

The work is a new `DELETE /api/absences/bulk` route, a `Usuń` action on the existing range dialog's
confirm step, and — first — closing the route-level test gap on the single-row delete this new path
lands beside.

## Current State Analysis

Bulk delete is absent by **deliberate scope exclusion**, not by oversight and not behind a disabled
button. `grid-multicheck` (S-21) wrote it out of scope three times
(`context/archive/2026-08-12-grid-multicheck/plan.md:105`, `plan-brief.md:46`, `:58-60`) and then
encoded the exclusion in the type system. There is no bulk-delete endpoint, no toolbar, no context
menu, and no TODO. The reasoning was scope discipline; **no safety objection to bulk delete is
recorded anywhere**.

What exists, and what it means for this change:

- **The gesture is finished and needs no work.** `src/lib/absence-range.ts` owns all the arithmetic;
  `AbsenceGrid.tsx` owns three DOM events. A selection is always a contiguous weekday run inside one
  employee column and one rendered month — discontiguous and multi-employee selections are
  inexpressible by data shape, and `MAX_BULK_DATES = 31` (`bulk.ts:42`) encodes the same fact
  server-side.
- **The client already holds every id and every row a delete needs.** `partitionRange`
  (`absence-range.ts:165-180`) returns each occupied day carrying its whole `Absence`, computed off
  the already-rendered `absenceMap` with no pre-flight request. The dialog already renders exactly
  that per-day list — date · type · hours — in the overwrite confirmation
  (`AbsenceFormDialog.tsx:519-552`).
- **The exclusion is type-level, so removing it is a type change.**
  `AbsenceFormDialogRangeProps` (`:110-121`) has no `existingAbsence` field at all; `existingAbsence`
  is hard-nulled in range mode at `:163`; the `Usuń` button's only guard is `{existingAbsence && (`
  at `:835`. The file states the consequence in as many words at `:159-162`.
- **The nearest server template is the weakest write path in the repo.**
  `DELETE /api/absences/:id` (`[id].ts:287-332`) has **no `is_system` guard** — the only absence
  write path without one — and **zero route-level test coverage**: no test in `src/tests/` imports
  `DELETE` from that module (only `PATCH`, from four suites). Copying it is precisely the mechanism
  `absence-write-hardening` was opened to fix, and which `context/foundation/lessons.md` records.
- **A delete has almost no domain side effects.** `absences` is a leaf table (`schema.ts:84-118`) —
  nothing references it, no cascades, no triggers — the holiday balance is computed on read
  (`services/holiday-balance.ts:16-66`), and `is_priority` / partial-day are per-row write-time rules
  with no cross-row invariant. The correctness work is entirely authorization and reporting.
- **Three fetch-once `useRef` caches** (`AbsenceStats.tsx:337`, `AbsenceDetailsSubcards.tsx:99`,
  `:100`) are harmless *only* because every mutation ends in `window.location.reload()`.

## Desired End State

A moderator or employee drags a run of days in the grid over cells that hold absences, and the range
dialog offers `Usuń` alongside `Zapisz`. Pressing it shows the same per-day list the overwrite
confirmation shows — each day named with its type and hours, not counted — under delete copy, and
confirming removes exactly those rows in one statement. The page reloads and the days are empty. If
someone else deleted one of those days in the meantime, the user is told which day did not exist
before the page refreshes.

Verify by: dragging over three occupied weekdays as a moderator on a colleague's column, deleting,
and observing the three cells empty and the surrounding days untouched; then by
`npm run lint && npm run test:run && npm run build`.

### Key Discoveries:

- `AbsenceFormDialog.tsx:207` — the `step: "form" | "confirm"` machine already swaps body and footer
  inside one Radix dialog, deliberately not a nested one ("two stacked Radix dialogs fight over the
  focus trap"). A delete confirmation is a second consumer of that machine, not a new dialog.
- `AbsenceFormDialog.tsx:144-153`, `:428-453` — `unannouncedOverwrites` + the blocking `toast.warning`
  with an `Odśwież` action is the fix for impl-review finding F1 (a stale client-computed set
  destroyed rows the confirmation never named). **A delete's staleness is the exact inverse** — days
  the confirmation named that turned out already gone — and reuses the same mechanism.
- `src/lib/absence-write-target.ts:78-117` — `resolveAbsenceWriteTarget` resolves the target from an
  *optional* body `employee_id`, silently ignoring a non-moderator's, and refuses the protected admin
  with 403 after a 404-before-403 gate order. With a `dates`-shaped body this makes the where-clause
  `employee_id = <resolved> AND date IN (…)` **both** the ownership gate and the `is_system` gate.
  No hand-rolled guard, no ownership ternary.
- `bulk.ts:231-234` — there is deliberately **no `db.transaction()` anywhere in the repo**; a single
  statement is already atomic. A single multi-row `DELETE … WHERE … IN (…)` inherits that.
- `bulk.ts:263-275` — no unique-violation arm and no FK arm is reachable for a delete: `absences` is
  a leaf table, so `SQLITE_CONSTRAINT_FOREIGNKEY` cannot be raised, and no CHECK can be violated by
  removing a row. The catch block collapses to one 500 arm, matching `[id].ts:326-331`'s reasoning.
- `node_modules/astro/dist/core/app/middlewares.js` — Astro 6's origin check is **content-type
  dependent**: it 403s a non-safe method only when the content type is form-like *or absent*. Today's
  bodyless `DELETE /api/absences/:id` takes the absent branch and requires a same-origin `Origin`
  header; a JSON-bodied `DELETE` skips the check entirely.
- Test date windows: Jan–Sep 2026 are all claimed by the eight existing absence suites (bulk owns
  May 1–15 plus a July/Aug over-cap list, `is-system-guard` May 18–Jun 11, `error-contract` July,
  `priority-guard` September). **October and November 2026 are free** — verified across `src/tests/`
  and `tests/`.

## What We're NOT Doing

- **Not adding an `is_system` guard to `DELETE /api/absences/:id`.** The new route is guarded by
  construction; the existing one is left as it is. `absence-write-hardening` reasoned that PATCH and
  DELETE on `[id].ts` cannot retarget a row, so no admin absence can be created to delete
  (`plan-brief.md:37`). That reasoning is unchanged by this change.
- **Not adding a confirmation to the single-day `Usuń`.** It has none today; changing proven
  single-day behaviour is scope nobody asked for. This change makes the asymmetry visible and leaves
  it.
- **Not a new gesture or affordance.** No toolbar, no context menu, no modifier-key drag. Delete is
  reached from the range dialog only.
- **Not optimistic updates.** Every mutation still ends in `window.location.reload()`; the three
  fetch-once refs depend on it.
- **Not multi-employee or discontiguous selection.** Both are inexpressible in `DragSelection` and
  stay so.
- **Not deleting by id.** The body carries dates, not `absence_ids`.
- **Not a weekend guard on the delete route** (see Phase 2 — this is a deliberate asymmetry with
  `POST`, not an omission).
- **No new FR in the PRD.** The multi-day *create* feature (S-21) has no dedicated FR either — the
  roadmap maps it to FR-001 + FR-004 — so the delete counterpart sits in the same position under
  `prd.md:74` / `:76`, which authorize deletion with no cardinality qualifier.

## Implementation Approach

Four phases, ordered so the riskiest code is never the least-tested code.

**Tests first, on code this change does not modify.** The single-row DELETE is the closest sibling to
the new route and has no route-level coverage. Backfilling it (Phase 1) is a pure addition with no
production risk, establishes a delete-route test template for Phase 2 to mirror, and closes the gap
`lessons.md` was written about — where routing verification away from the highest-risk file shipped
`bulk.ts` untested.

**Server before client**, so the client is written against a real contract rather than an intended
one. The route's authorization is delegated wholly to `resolveAbsenceWriteTarget` — the module that
exists precisely so "the next absence write path cannot inherit a mistake a third time"
(`absence-write-target.ts:9-14`).

**Best-effort with a per-day report**, mirroring `created_dates` / `overwritten_dates`. Per-day
reporting is the bulk route's distinguishing feature, and it is what makes the F1 staleness class
detectable at all. The single-row 404-on-no-match convention does not extend to N ids and is
deliberately not carried over.

**The client reuses the confirm step** rather than growing a second dialog, with the pending verb
held in state so the shared per-day list can branch its copy.

## Critical Implementation Details

**Origin check asymmetry.** Astro 6 skips its cross-site check for a request that declares a
non-form `Content-Type` (`middlewares.js`: form-like → checked, absent → checked, other → skipped).
The existing bodyless `DELETE /api/absences/:id` is checked and the E2E teardown calls therefore
*must* send `Origin` (`tests/e2e/e2e-rules.md:98-103`); the new JSON-bodied `DELETE` is not checked
and would work without it. Keep sending `Origin` on every state-changing `page.request.*` call
anyway — the rule is about cleanups failing loudly, and a spec that depends on which branch of a
framework middleware it lands in is a spec that breaks on an Astro upgrade.

**State sequencing in the dialog.** `step` must be reset to `"form"` and `pendingAction` cleared on
a *failed* delete, exactly as `submitAbsence` does at `:459-461` — a confirm step describing a write
that did not happen offers a retry whose error the user cannot see behind the summary. On the
staleness-warning path the dialog must stay `isSubmitting` (as `:452` does), because the delete
already landed and a second press must not repeat it.

## Phase 1: Route-Level Tests for the Single-Row DELETE

### Overview

Cover `DELETE /api/absences/:id` at the route boundary for the first time, so the new destructive
path in Phase 2 does not arrive on top of an untested foundation. No production code changes.

### Changes Required:

#### 1. New route-level delete suite

**File**: `src/tests/api/absences/delete.test.ts` (new)

**Intent**: Assert the guards `DELETE /api/absences/:id` actually has — the 401 gate, the
no-live-employee-row 403, the ownership ternary in both directions, the malformed-id 400, and
404-on-no-match — each also asserting the row's survival or removal in the database rather than only
the status code. This is the gap `lessons.md` records: `crud.test.ts:153` is a raw Drizzle statement
exercising no route, no auth and no ownership gate.

**Contract**: Direct handler import (`import { DELETE } from "@/pages/api/absences/[id]"`), a
hand-built `APIContext` with `params.id` and a nullable `locals.user`, following the
`partial-day-guard.test.ts` harness and the caller-varying `makeContext` from
`korekta-gate.test.ts:32`. Cases, mirroring `src/tests/api/holiday-balances/delete.test.ts:100-155`:

| Case | Expected |
|---|---|
| unauthenticated | 401 `{ error: "Brak autoryzacji." }`, row survives |
| caller has no live `employees` row (soft-deleted) | 403 `{ error: "Nie znaleziono rekordu pracownika." }`, row survives |
| employee deletes own row | 204, no body, row gone |
| employee deletes a colleague's row | 404 `{ error: "Nie znaleziono." }`, row **survives** |
| moderator deletes a colleague's row | 204, row gone |
| unknown uuid | 404 `{ error: "Nie znaleziono." }` |
| malformed id (`"not-a-uuid"`) | 400 `{ error: "Nieprawidłowy identyfikator." }` |

The 204 cases must assert `res.body === null` — the route answers `new Response(null, …)` and the
client relies on never parsing a success body (`AbsenceFormDialog.tsx:474-476`).

**Date window**: November 2026, unclaimed by any suite. Give each test its own weekday: `absences`
carries `UNIQUE (employee_id, date)`, so a shared date makes one test's leftover row the next test's
failure. Follow `bulk.test.ts:32-133`'s `SUITE_DATES` + `afterEach` cleanup pattern, including the
dates of tests that assert nothing is written — a cap or gate that later loosens starts landing rows
a cleanup that cannot reach them would leave behind.

**A comment must record why the employee-deletes-a-colleague case expects 404 and not 403**: ownership
is a where-clause predicate, never a pre-check, so a non-matching row is indistinguishable from a
nonexistent one. That is the established convention and the new route must not contradict it.

### Success Criteria:

#### Automated Verification:

- New suite passes: `npm run test:run -- src/tests/api/absences/delete.test.ts`
- Full suite still green: `npm run test:run`
- Linting passes: `npm run lint`

#### Manual Verification:

- Deleting a single absence from the grid dialog still works unchanged in `npm run dev`.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 2: `DELETE /api/absences/bulk`

### Overview

The new route and its DTOs. Authorization is delegated entirely to the shared write-target guard;
the report is the delete analogue of `created_dates` / `overwritten_dates`.

### Changes Required:

#### 1. Shared DTOs

**File**: `src/types.ts`

**Intent**: Add the command and result shapes beside `AbsenceBulkCreateCommand` /
`AbsenceBulkCreateResult` (`:27-50`), so both bulk verbs are read together and the delete report's
kinship with the create report is visible.

**Contract**:

```ts
export interface AbsenceBulkDeleteCommand {
  /** Moderator-only; ignored for an employee, who always deletes from their own column. */
  employee_id?: string;
  /** `YYYY-MM-DD`, no duplicates, at most one rendered month's worth. */
  dates: string[];
}

export interface AbsenceBulkDeleteResult {
  deleted_dates: string[];
  /** Requested days that held no row for this employee — the staleness signal. */
  missing_dates: string[];
}
```

`deleted_dates` and `missing_dates` partition `dates` exactly. A doc comment should say so, and say
why the result carries no `absences` array: unlike the create result there is nothing left to render.

#### 2. The route

**File**: `src/pages/api/absences/bulk.ts`

**Intent**: Add a `DELETE` export alongside the existing `POST`, following `[id].ts`'s precedent of
co-locating methods on one route file. Remove the rows the selected days hold for the resolved
target, in one statement, and report which days went and which held nothing.

**Contract**: `DELETE /api/absences/bulk`, body `AbsenceBulkDeleteCommand`, success `200` with
`AbsenceBulkDeleteResult`. Handler order, mirroring `POST`'s prologue verbatim so the two cannot
drift:

1. `!context.locals.user` → 401 `{ error: "Brak autoryzacji." }`.
2. Caller lookup selecting `id, role, is_system` filtered on `isNull(employees.deleted_at)`; DB error
   → 503 `Błąd bazy danych.`; no row → 403 `Nie znaleziono rekordu pracownika.` (this is what
   excludes deactivated callers).
3. Body parse failure → 400 `Nieprawidłowe dane żądania.`; zod failure → 400 with
   `parsed.error.issues[0]?.message`.
4. `resolveAbsenceWriteTarget(db, employeeRow, { employeeId, substituteEmployeeId: null }, "DELETE /api/absences/bulk")`
   — returns a `Response` to send, or `{ targetEmployeeId }`. Passing `null` for the substitute makes
   gate 4 a no-op; gates 1–3 give the target resolution, the 404-for-unknown-employee and the 403 for
   the protected admin.
5. One `db.delete(absences).where(and(eq(absences.employee_id, targetEmployeeId), inArray(absences.date, dates))).returning({ date: absences.date })`.
6. `200` with `deleted_dates` = the returned dates sorted, `missing_dates` = the requested dates not
   in that set.

The zod schema reuses `DateSchema` (real calendar validation — SQLite's TEXT column rejects nothing),
`.min(1, "Podaj co najmniej jeden dzień.")`, `.max(MAX_BULK_DATES, …)` reusing the module-private
constant, and the same no-duplicates `.refine` message `POST` uses.

**Three deliberate asymmetries with `POST`, each needing a comment that states the reason:**

- **No weekend guard.** `POST` refuses a weekend loudly because a weekend absence must never be
  *created*. A weekend row can only exist as legacy or hand-crafted data — and refusing to delete it
  would make it undeletable through the UI, which is the same class of bug as the unguarded admin row
  (`absence-write-hardening/plan.md:40`). A weekend date that holds nothing simply lands in
  `missing_dates`.
- **No pre-read.** `POST` reads occupied dates before its upsert because afterwards every day looks
  occupied. `DELETE`'s `RETURNING` answers the same question from the write itself, so the report
  costs one round trip instead of two and has no unprotected gap to disclaim.
- **The catch block collapses to a single 500 arm.** `absences` is a leaf table, so
  `SQLITE_CONSTRAINT_FOREIGNKEY` is unraisable; no CHECK and no unique index can be violated by
  removing a row. Same reasoning `[id].ts:326-331` records for its own DELETE.

**No transaction**, per `bulk.ts:231-234` — one statement is already atomic and the repo has no
`db.transaction()` pattern.

**Also state, in a comment, why there is no ownership ternary**: `resolveAbsenceWriteTarget` silently
ignores a non-moderator's `employee_id` and resolves to the caller's own id, so
`employee_id = targetEmployeeId` *is* the ownership gate. A row belonging to someone else is not
matched, and therefore reported as missing rather than refused — the N-id analogue of the single-row
route's 404-on-no-match.

#### 3. Route-level suite for the new endpoint

**File**: `src/tests/api/absences/bulk-delete.test.ts` (new)

**Intent**: Cover every rejection path and the report, in the class of request the UI cannot produce
— which is the class the route exists to refuse.

**Contract**: Direct `import { DELETE } from "@/pages/api/absences/bulk"`, same harness as Phase 1.
**Date window: October 2026.** Cases:

| Case | Expected |
|---|---|
| unauthenticated | 401, nothing deleted |
| caller with no live `employees` row | 403 `Nie znaleziono rekordu pracownika.` |
| empty `dates` | 400 `Podaj co najmniej jeden dzień.` |
| 32 dates | 400 containing "31" (assert with a literal count, not by importing the constant — `bulk.test.ts:42-49` explains the trade) |
| duplicate dates | 400 `Lista dni zawiera duplikaty.` |
| `2026-02-31` | 400, not a 500 |
| happy path, 3 occupied weekdays | 200, `deleted_dates` = all three sorted, `missing_dates` empty, rows gone |
| mixed run: 2 occupied + 1 free | 200, the report partitions exactly, only the two rows gone |
| all-free run | 200, `deleted_dates: []`, `missing_dates` = every requested day, nothing else touched |
| employee sends a colleague's `employee_id` | 200 but scoped to the caller — the colleague's rows **survive** and appear as `missing_dates` |
| moderator sends a colleague's `employee_id` | 200, the colleague's rows gone |
| moderator targets the `is_system` admin | 403 `Nie można modyfikować tego konta.`, row survives |
| unknown `employee_id` (moderator) | 404 `Pracownik nie został znaleziony.` (404 before 403) |
| soft-deleted target (moderator) | 404 |
| **a weekend date that holds a row** | 200, that row **deleted** — the asymmetry with `POST` asserted, not just commented |
| a neighbouring occupied day outside the requested run | survives untouched, with its original id |

The employee-sends-a-colleague's-`employee_id` case is the one that would catch a hand-rolled
ownership check regressing into the shared guard's silent-ignore contract; give it a comment saying
so.

### Success Criteria:

#### Automated Verification:

- New suite passes: `npm run test:run -- src/tests/api/absences/bulk-delete.test.ts`
- Full suite green: `npm run test:run`
- Type checking and linting pass: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- With `npm run dev`, a hand-issued `curl -X DELETE` (JSON body, session cookie) against three
  occupied dates returns the expected report and empties exactly those days.
- The same request as a non-moderator against a colleague's `employee_id` leaves the colleague's rows
  in place.

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 3: `Usuń` on the Range Dialog

### Overview

Surface the route. The range dialog gains a delete action, driven by the `occupiedDays` prop it
already receives, sharing the confirm step and its per-day list with the overwrite flow.

### Changes Required:

#### 1. The delete action and the shared confirm step

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Offer `Usuń` in range mode when the run holds entries, confirm it by naming each affected
day, issue the bulk delete, and report back any day the confirmation named that turned out already
gone before reloading.

**Contract**:

- **New state**: a `pendingAction: "save" | "delete"` (or equivalent discriminator) set when the
  confirm step is entered, so the shared confirm body and footer know which verb they are confirming.
  `"save"` must be the value the existing overwrite path sets, leaving its behaviour byte-identical.
- **Footer, `step === "form"`, range mode**: a destructive `Usuń` rendered when
  `occupiedDays.length > 0`, `className="mr-auto"`, `disabled={isSubmitting}` — the same shape and
  position the single-day `Usuń` occupies at `:834-845`. **Hidden, not disabled, when the run is
  empty**: this mirrors the single-day rule (`{existingAbsence && (`) so one rule covers both modes,
  and matches the file's convention of withholding affordances rather than no-op'ing them
  (`AbsenceGrid.tsx:404`).
- **Footer, `step === "confirm"`, `pendingAction === "delete"`**: `Anuluj` steps back to the form as
  it already does, and the primary becomes a destructive `Usuń wpisy` /
  `{isSubmitting ? "Usuwanie…" : "Usuń wpisy"}` calling the new handler.
- **`existingAbsence` must stay null in range mode.** Do *not* widen
  `AbsenceFormDialogRangeProps` — the union's rationale at `:123-131` (a range plus an
  `existingAbsence` has no meaning) is unaffected by this change, and the single-day `Usuń` keeps its
  `existingAbsence &&` guard. The range `Usuń` is a separate render behind
  `isRange && occupiedDays.length > 0`. Update the comment at `:159-162`, which currently asserts
  range mode is create-only, to say what is now true: range mode never *edits*, and the delete arm
  reads `occupiedDays`, not `existingAbsence`.
- **Confirm body copy branches on `pendingAction`.** The `<ul>` of days at `:531-551` is reused
  verbatim — same `rawTimeRange` ungated view (a legacy row carrying hours on a type the product now
  forbids them on must still show them, because this list names what is about to be destroyed), same
  `max-h-[240px]` scroll. Only the lead paragraph changes: for delete, Polish copy asking whether to
  delete N entries, pluralised with `pluralPl` from `@/lib/plural`, stating that the days below will
  be removed. Keep the "each day named, not just counted" property — it is an inherited constraint
  (`grid-multicheck/frame.md:67-68`).
- **Title on the delete-confirm step**: `Usuń nieobecności z zakresu dni`. Confirming a deletion
  under the heading "Dodaj nieobecność na zakres dni" misdescribes the action. This is a **fourth
  dialog heading** and must be registered in Phase 4.
- **New handler** (`handleRangeDelete`, beside `handleDelete` at `:470-486`):
  `fetch(withBase("/api/absences/bulk"), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: targetEmployee.id, dates: occupiedDays.map((d) => d.key) } satisfies AbsenceBulkDeleteCommand) })`.
  **Send only the occupied days, not `rangeDays`** — the free days are known to hold nothing, and
  sending them would fill `missing_dates` with noise that defeats the staleness signal below.
- **Staleness report, the inverse of `unannouncedOverwrites`**: a module-level helper beside it at
  `:144-153`, reading `missing_dates` and returning the days the confirmation *named* that came back
  missing. When non-empty, `toast.warning` with `duration: Infinity` and an `Odśwież` action holding
  the reload behind an acknowledgement, and **stay `isSubmitting`** — the delete already landed, so a
  second press must not repeat it. Copy along the lines of "Część wpisów została już usunięta przez
  kogoś innego: …". Same reasoning as F1: the reload would swallow a plain toast. A malformed or
  unreadable body yields `[]` — the delete succeeded either way.
- **Failure path**: `toast.error(data.error ?? "Nie udało się usunąć. Spróbuj ponownie.")`,
  `setIsSubmitting(false)`, and `setStep("form")` — matching `submitAbsence`'s reasoning at
  `:459-461`.
- The dialog's existing `onEscapeKeyDown` / `onInteractOutside` guards already hold it shut while
  `isSubmitting`, so a delete in flight cannot be dismissed. No change needed.

#### 2. Legend copy

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: The legend at `:330-332` advertises the gesture's verbs in prose
("Kliknij komórkę, aby dodać. Przeciągnij, aby zaznaczyć zakres dni."). It still reads correctly —
dragging selects a range, and what the dialog then offers is its own business — so **verify rather
than assume** a change is needed. Change it only if the delete action is genuinely undiscoverable
without it; if so, extend the second sentence rather than adding a third.

**Contract**: `AbsenceGrid.tsx:330-332`, hint text only. No behavioural change. `partitionRange`'s
call site at `:180` needs **no** change: `occupied.length === 0` already answers "is the run empty",
so `free` stays discarded.

### Success Criteria:

#### Automated Verification:

- Type checking and linting pass: `npm run lint`
- Full suite green: `npm run test:run`
- Build succeeds: `npm run build`

#### Manual Verification:

- As an employee: drag over three of your own occupied weekdays → `Usuń` appears → the confirmation
  names all three with their types and hours → confirming empties exactly those cells.
- Drag over a run of entirely free days → no `Usuń` button, and `Zapisz` behaves exactly as before.
- Drag over a mixed run (some occupied, some free) → `Usuń` appears and the confirmation lists only
  the occupied days.
- `Anuluj` on the delete confirmation returns to the filled-in form, not a fresh one, and `Zapisz`
  from there still writes the range.
- As a moderator on a colleague's column: the same flow works and the colleague's name still shows in
  the header.
- Staleness: with the grid open, delete one of the days in a second browser tab, then delete the run
  in the first → the blocking warning names that day and the page reloads only after `Odśwież`.
- Failure: with the server stopped mid-flow, the error toast appears and the dialog returns to the
  form.
- The monthly stats card, Szczegóły subcards and the balance card all show the reduced usage after
  the reload (the three fetch-once refs are re-initialised by it).

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 4: E2E Spec and Rules Registration

### Overview

A browser-level spec for the gesture, and the `e2e-rules.md` bookkeeping the new dialog heading
requires.

### Changes Required:

#### 1. Bulk-delete E2E spec

**File**: `tests/e2e/absence-grid-range.spec.ts`

**Intent**: Drive the real gesture — seed rows, drag, `Usuń`, confirm — and assert the **stored
rows**, following the two existing range specs at `:124` and `:152` which assert storage rather than
UI, and which check that an untouched neighbouring row keeps its original id.

**Contract**: Reuse the file's existing drag helper (`:101-112`, real `page.mouse.down()/up()` —
dispatched `mouseenter` reaches no handler) and the `absence-cell-<employeeId>-<date>` locator
(`:74`), the repo's only permitted `data-testid`. Everything else via `getByRole` / `getByText`.
Setup and teardown use `page.request.*` with an **explicit `Origin` header and an asserted status**
(`e2e-rules.md:98-103`) — required for the bodyless single-row DELETE and kept for the new one
regardless of Astro's content-type branch.

Two cases: (a) a drag over three seeded occupied weekdays, deleted, asserting all three rows gone and
a seeded row on the following weekday untouched with its original id; (b) `Anuluj` on the delete
confirmation deletes nothing.

Pick a date window no existing spec uses, and note that `playwright.config.ts:24`'s `baseURL` still
defaults to the stale `main`-branch Cloudflare URL and must be overridden with `BASE_URL`.

#### 2. Register the new dialog heading

**File**: `tests/e2e/e2e-rules.md`

**Intent**: `:90-92` enumerates the three known dialog headings so specs match them `exact`. The
delete-confirm step adds a fourth.

**Contract**: Add `Usuń nieobecności z zakresu dni` to the list at `:90-92`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Full unit suite still green: `npm run test:run`

#### Manual Verification:

- `BASE_URL=http://localhost:4321 npm run e2e` passes both new cases against a locally-built server.
- Both pre-existing range specs still pass unchanged.
- Note in the change log that **E2E does not run in CI** (`ci.yml` only greps the sign-in copy
  strings), so this spec is developer-run coverage.

---

## Testing Strategy

### Unit Tests:

No new pure module is introduced — `partitionRange` already answers everything the delete set needs,
so `src/lib/absence-range.ts` is unchanged and its existing unit tests stand. The staleness helper in
`AbsenceFormDialog.tsx` is a module-private function in a React file with no jsdom in the harness; it
is covered by the Phase 3 manual staleness check and the Phase 2 report assertions, as
`unannouncedOverwrites` is today.

### Integration Tests:

Two new route-level suites, the layer this repo calls integration:

- `src/tests/api/absences/delete.test.ts` — the existing single-row DELETE, November 2026.
- `src/tests/api/absences/bulk-delete.test.ts` — the new route, October 2026.

Both assert the database state, not only the status code, on every path — including that **nothing
was deleted** on every refusal, per `error-contract.test.ts:13-25`'s posture.

### Manual Testing Steps:

1. Seed three consecutive occupied weekdays for yourself; drag across them; confirm `Usuń` names all
   three with type and hours; delete; verify the cells are empty and neighbouring days untouched.
2. Drag over entirely free days; verify no `Usuń` button and unchanged save behaviour.
3. Drag a mixed run; verify only occupied days are listed and only they are removed.
4. `Anuluj` from the delete confirmation; verify the form is as you left it and nothing was deleted.
5. As a moderator, repeat step 1 on a colleague's column.
6. Two-tab staleness: delete one day in tab B, then delete the run in tab A; verify the blocking
   warning names that day and the reload waits for `Odśwież`.
7. Stop the server mid-delete; verify the error toast and the return to the form.
8. After a successful delete, verify the monthly stats, Szczegóły subcards and balance card all
   reflect the reduced usage.

## Performance Considerations

None material. The delete is one statement against at most 31 rows matched by
`(employee_id, date IN …)` — the same index the unique constraint provides. The report is derived
from `RETURNING`, so unlike `POST` there is no pre-read: one round trip, not two. The client sends
only the occupied subset, so the body is at most the size the create path already sends.

## Migration Notes

No schema change, no migration, no data backfill. `absences` is a leaf table, so removing rows cannot
violate a constraint or orphan a reference, and the holiday balance is computed on read
(`services/holiday-balance.ts:16-66`) — nothing stored needs recomputing after a delete.

Rollback is a code revert with no data implications. The new route is additive: existing clients
never call it, and `POST /api/absences/bulk` is untouched.

## References

- Related research: `context/changes/grid-bulk-delete/research.md`
- The gesture this extends: `context/archive/2026-08-12-grid-multicheck/plan.md`,
  `reviews/impl-review.md:45-69` (finding F1 — client-computed set staleness)
- How a bulk route inherits a guard gap: `context/archive/2026-08-18-absence-write-hardening/plan.md`
- Closest test template: `src/tests/api/holiday-balances/delete.test.ts:100-155`
- Closest route template: `src/pages/api/absences/bulk.ts:97-275`, `src/pages/api/absences/[id].ts:287-332`
- Shared authorization: `src/lib/absence-write-target.ts:78-117`
- `context/foundation/lessons.md` — "Repo-wide claims are load-bearing"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Route-Level Tests for the Single-Row DELETE

#### Automated

- [x] 1.1 New suite passes: `npm run test:run -- src/tests/api/absences/delete.test.ts` — 84622ed
- [x] 1.2 Full suite still green: `npm run test:run` — 84622ed
- [x] 1.3 Linting passes: `npm run lint` — 84622ed

#### Manual

- [x] 1.4 Deleting a single absence from the grid dialog still works unchanged in `npm run dev` — 84622ed

### Phase 2: `DELETE /api/absences/bulk`

#### Automated

- [x] 2.1 New suite passes: `npm run test:run -- src/tests/api/absences/bulk-delete.test.ts`
- [x] 2.2 Full suite green: `npm run test:run`
- [x] 2.3 Type checking and linting pass: `npm run lint`
- [x] 2.4 Build succeeds: `npm run build`

#### Manual

- [x] 2.5 Hand-issued `curl -X DELETE` against three occupied dates returns the expected report and empties exactly those days
- [x] 2.6 The same request as a non-moderator against a colleague's `employee_id` leaves the colleague's rows in place

### Phase 3: `Usuń` on the Range Dialog

#### Automated

- [ ] 3.1 Type checking and linting pass: `npm run lint`
- [ ] 3.2 Full suite green: `npm run test:run`
- [ ] 3.3 Build succeeds: `npm run build`

#### Manual

- [ ] 3.4 Employee: drag over three own occupied weekdays → `Usuń` appears, names all three with types and hours, deletes exactly those cells
- [ ] 3.5 Entirely free run → no `Usuń` button, `Zapisz` unchanged
- [ ] 3.6 Mixed run → confirmation lists only the occupied days
- [ ] 3.7 `Anuluj` on the delete confirmation returns to the filled-in form and `Zapisz` still writes the range
- [ ] 3.8 Moderator on a colleague's column: same flow works, colleague's name still in the header
- [ ] 3.9 Two-tab staleness: blocking warning names the already-deleted day, reload waits for `Odśwież`
- [ ] 3.10 Server stopped mid-flow: error toast appears, dialog returns to the form
- [ ] 3.11 Monthly stats, Szczegóły subcards and balance card all reflect reduced usage after the reload

### Phase 4: E2E Spec and Rules Registration

#### Automated

- [ ] 4.1 Linting passes: `npm run lint`
- [ ] 4.2 Full unit suite still green: `npm run test:run`

#### Manual

- [ ] 4.3 `BASE_URL=http://localhost:4321 npm run e2e` passes both new cases
- [ ] 4.4 Both pre-existing range specs still pass unchanged
- [ ] 4.5 Recorded that E2E does not run in CI, so this spec is developer-run coverage
