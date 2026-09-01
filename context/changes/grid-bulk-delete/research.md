---
date: 2026-09-01T09:15:43+02:00
researcher: bartorelli-omarchy
git_commit: bae467be6fce91d59e9be8054336c1ae6c9add8e
branch: main
repository: 10x-devs-urlopy
topic: "Bulk delete of absences from the monthly grid selection"
tags: [research, codebase, absences, absence-grid, absence-range, bulk, delete, authorization, is-system]
status: complete
last_updated: 2026-09-01
last_updated_by: bartorelli-omarchy
permalink_base: https://github.com/oliwabartosz/10x-devs-urlopy/blob/bae467be6fce91d59e9be8054336c1ae6c9add8e/
---

# Research: Bulk delete of absences from the monthly grid selection

**Date**: 2026-09-01T09:15:43+02:00
**Researcher**: bartorelli-omarchy
**Git Commit**: `bae467be6fce91d59e9be8054336c1ae6c9add8e`
**Branch**: `main`
**Repository**: 10x-devs-urlopy

> File references below are local `path:line` (clickable in the editor). `HEAD` is pushed to
> `origin/main`, so any of them can be turned into a permalink by prefixing `permalink_base`
> from the frontmatter and appending `#L<line>`.

## Research Question

> User can now bulk add or change type of holidays in grid. However when it comes to bulk
> deleting, the option is unavailable — but it should!

Scope agreed before research: the full path end to end (selection UI → action wiring → API →
side effects → tests), with all four focus areas — authorization & ownership, side effects on
delete, test & E2E coverage, and prior decisions in the archive.

## Summary

**Bulk delete is absent by deliberate scope exclusion, not by oversight or by a disabled button.**
The `grid-multicheck` change (S-21) that introduced drag selection wrote it out of scope three
times over, and then encoded the exclusion in the type system: the range dialog is a discriminated
union arm that *has no `existingAbsence` field*, and the `Usuń` button's only guard is
`{existingAbsence && …}`. There is no bulk-delete endpoint, no toolbar, no context menu, and no
TODO. Nothing is broken — the feature was never built.

Five findings shape what building it costs:

1. **"Bulk change type" is not a separate feature.** It is the same `POST /api/absences/bulk`
   call, whose statement is an upsert (`ON CONFLICT DO UPDATE` on `(employee_id, date)`).
   Changing types across a run is "bulk add over occupied days". So the grid today has exactly
   *one* range action, not two, and delete would be the genuine second one.
2. **The client already holds everything a delete needs.** `partitionRange` returns each occupied
   day carrying its whole `Absence` row — id included — computed from the already-rendered
   `absenceMap` with no pre-flight request. `AbsenceGrid.tsx:180` currently destructures only
   `{ occupied }` and discards `free`.
3. **There is no bulk-delete-shaped route to copy, and the single-row one is the weakest write
   path in the repo.** `DELETE /api/absences/:id` has **no `is_system` guard** — the only absence
   write path without one. A bulk route written by copying it would inherit that gap by exactly
   the mechanism `absence-write-hardening` was opened to fix, and which `lessons.md` already
   records.
4. **A delete has almost no domain side effects.** `absences` is a leaf table (nothing references
   it, no cascades, no triggers), the holiday balance is computed on read, and `is_priority` /
   partial-day are per-row write-time rules with no cross-row invariant. The correctness work is
   all in authorization and in reporting *which* rows went, not in repair.
5. **`DELETE /api/absences/:id` has zero route-level test coverage today.** No test in
   `src/tests/` imports `DELETE` from `@/pages/api/absences/[id]` (verified by grep); the one test
   named for DELETE, `crud.test.ts:153`, is a raw Drizzle statement that exercises no route, no
   auth and no ownership gate. Every sibling guard (`is_system`, priority, error contract) *is*
   route-tested. So bulk delete arrives on top of an untested foundation.

The honest framing of the user's report: the option is unavailable because it was never in scope,
and the reason given at the time — "the prototype's seed-from-first-day silently inherits one
arbitrary day into an N-day write" — was an argument against *seeding the form from an existing
entry*, not an argument against deletion itself. There is no recorded safety objection to bulk
delete. It is a straightforward gap to close, but it is a new destructive path and the repo's own
history (finding F1 below) says exactly where such a path goes wrong.

## Detailed Findings

### 1. Selection: what the gesture produces

The pure module `src/lib/absence-range.ts` owns every decision; `AbsenceGrid` owns only the three
DOM events. The split exists because vitest runs node-only with no jsdom, so pointer behaviour is
untestable while pure functions are exhaustively testable (`absence-range.ts:1-10`).

State shape — `absence-range.ts:72-76`:

```ts
export interface DragSelection {
  employeeId: string;
  anchorIndex: number;
  currentIndex: number;
}
```

held at `AbsenceGrid.tsx:114`. Properties that constrain any future action:

- **One employee column only.** Extension is gated on the anchored column
  (`AbsenceGrid.tsx:485-489`) and so is the highlight (`absence-range.ts:110-114`). Multi-employee
  selection is impossible by data shape, not by policy.
- **Always a contiguous vertical run inside one rendered month.** `selectionSpan` normalises
  `[min,max]` (`absence-range.ts:81-85`), `expandSpanToWeekdays` walks every index between
  (`:126-136`). A discontiguous selection is inexpressible. `MAX_BULK_DATES = 31`
  (`bulk.ts:42`) encodes the same fact server-side.
- **Weekends silently dropped** at `absence-range.ts:133`; weekend cells never receive drag
  handlers at all.
- **Handlers are withheld, not no-op'd**, where the cell is not writable —
  `AbsenceGrid.tsx:404`:
  ```ts
  const clickable = (isOwn || isModerator) && !isWeekend && !isInactive;
  ```

| Event | Where | Behaviour |
|---|---|---|
| start | `AbsenceGrid.tsx:459-470` | primary button only; anchors on the cell's day index |
| extend | `AbsenceGrid.tsx:471-492` | bails if `event.buttons === 0`; updates `currentIndex` within the anchored column |
| commit | `AbsenceGrid.tsx:161-198` (window `mouseup`) | bails if `!isRangeGesture` (one day falls through to the cell's `onClick`), expands, partitions, opens the dialog |
| abandon | `AbsenceGrid.tsx:188-190` (window `blur`) | clears without committing |

There are **no hooks** involved; `src/components/hooks/` holds only `useRovingRadioGroup.ts`.

### 2. What the selection can do today — and why delete is not on the list

Exactly one action: open `AbsenceFormDialog` in `mode="range"`. `AbsenceGrid.tsx:105-107`:

```ts
type DialogState =
  | { kind: "single"; day: Date; absence: Absence | null; targetEmployee: EmployeeListItem }
  | { kind: "range"; rangeDays: RangeDay[]; occupiedDays: OccupiedRangeDay[]; targetEmployee: EmployeeListItem };
```

Rendered at `:577-591` (single) and `:592-607` (range); the `key` forces a fresh mount per
selection so form state never leaks.

The range arm offers **Zapisz**, a confirm step when the run crosses existing entries
(`AbsenceFormDialog.tsx:378-384` — deliberately *not* unconditional, so the confirmation is not
trained away), and **Nadpisz i zapisz**. It offers no `Usuń`, because:

- `AbsenceFormDialog.tsx:163` — `const existingAbsence = props.mode === "range" ? null : props.existingAbsence;`
- `AbsenceFormDialog.tsx:835` — the button lives behind `{existingAbsence && (`
- `AbsenceFormDialog.tsx:110-121` — `AbsenceFormDialogRangeProps` has no `existingAbsence` field
  at all; the union "rules out the combination that has no meaning: a range plus an
  `existingAbsence`" (`:123-131`)
- `AbsenceFormDialog.tsx:159-162` states the consequence in as many words: range mode being
  create-only is "what keeps the delete button's existing `existingAbsence &&` guard sufficient
  rather than needing a mode check of its own".

The legend advertises only two verbs (`AbsenceGrid.tsx:330-332`): *"Kliknij komórkę, aby dodać.
Przeciągnij, aby zaznaczyć zakres dni."*

**No TODOs, no disabled buttons, no dead code.** The exclusion is prose plus type-level absence.

### 3. The client already knows which selected days hold absences

`AbsenceGrid.tsx:177-182`:

```ts
const rangeDays: RangeDay[] = dates.map((date) => ({ date, key: dateKey(date) }));
const { occupied } = partitionRange(dates, (key) => absenceMap.get(`${drag.employeeId}_${key}`));
setDialogState({ kind: "range", rangeDays, occupiedDays: occupied, targetEmployee });
```

with `absence-range.ts:139-152`:

```ts
export interface RangeDay { date: Date; key: string; }
export interface OccupiedRangeDay extends RangeDay { absence: Absence; }
export interface RangePartition { free: RangeDay[]; occupied: OccupiedRangeDay[]; }
```

Each occupied day carries the **whole** `Absence` (`src/types.ts:19`, `typeof absences.$inferSelect`)
— id, type, hours, priority, comment, substitute. The dialog already renders that per-day list in
the overwrite confirmation (`AbsenceFormDialog.tsx:534-550`), naming date, type and hours.

So a delete confirmation has its content for free, and a delete-by-id body has its ids for free.
Note `AbsenceGrid.tsx:180` discards `free` today — a delete flow wants to know whether the run is
entirely empty (nothing to delete) as well as which days are occupied.

### 4. Server: the write paths and their authorization model

`src/pages/api/absences/bulk.ts` exports **only `POST`** (`:97`). Its shape, which a delete route
would be judged against:

- 401 gate (`:98-100`) — `PROTECTED_ROUTES` in `src/middleware.ts:15` covers only `/dashboard`, so
  every API route does its own check.
- Caller lookup selecting `id, role, is_system` filtered on `isNull(employees.deleted_at)`
  (`:108-112`); DB error → 503 `Błąd bazy danych.`; no row → 403 `Nie znaleziono rekordu
  pracownika.` **This is what excludes deactivated callers.**
- Body parse → 400; zod → 400 with `parsed.error.issues[0]?.message` (`:121-131`).
- `resolveAbsenceWriteTarget(...)` (`:143-152`), then `assertAbsenceTypeExists` (`:157-160`), then
  the content guards: weekend (`:165-168`), partial-day (`:172-181`), priority (`:186-194`), hour
  clamp (`:200-207`).
- A **pre-read** of occupied dates via `inArray(absences.date, dates)` (`:219-223`), explicitly not
  transactionally protected (`:213-216`) — it is what makes the per-day report possible.
- One multi-row `INSERT … ON CONFLICT DO UPDATE` (`:235-253`). **No `db.transaction()` anywhere in
  the repo**; the comment at `:231-234` says a single statement is already atomic and the pattern
  is deliberately absent.
- 201 with `AbsenceBulkCreateResult { absences, created_dates, overwritten_dates }`
  (`src/types.ts:46-50`).

`DELETE /api/absences/:id` (`src/pages/api/absences/[id].ts:287-332`) is the thinnest path in the
file and the closest template. Its entire authorization is one where-clause ternary (`:315-322`):

```ts
.delete(absences)
.where(
  employeeRow.role === "moderator"
    ? eq(absences.id, id)
    : and(eq(absences.id, id), eq(absences.employee_id, employeeRow.id)),
)
.returning({ id: absences.id });
```

`deleted.length === 0` → 404 `Nie znaleziono.` (`:323`); success → `204` with no body (`:324`).
**An ownership failure surfaces as 404, never 403** — an established convention worth preserving.

What that handler does **not** do (verified by reading the whole thing):

- **No `is_system` guard.** It never selects `employees.is_system`, never calls `isProtectedAdmin`.
  Compare `DELETE /api/holiday-balances/:id` (`src/pages/api/holiday-balances/[id].ts:60-76`),
  which joins `employees` to fetch `is_system` and answers 403 `Nie można modyfikować tego konta.`
- No locked/past-date rule — **the concept does not exist anywhere in this repo** (grepped for
  `locked`, `zablokowan`, `przeszł`).
- No deactivated-*target* check: only the caller must be non-deleted. A moderator may delete a
  soft-deleted employee's absence, which is intentional given historical rows stay visible.
- No side effects at all: no `updated_at` touch, no audit row, no balance recompute.

Shared helpers, for the seam question:

- `src/lib/absence-write-target.ts:78-117` — `resolveAbsenceWriteTarget` answers "which employee
  does this write land *on*", driven by an optional body `employee_id`. Gate order is **404 before
  403**. A non-moderator's `employee_id` is *silently ignored, not rejected* (`:55-57`).
- `src/lib/employees.ts:24-26` — `isProtectedAdmin(row) => row.is_system`, with the header at
  `:4-12` stating there is no database backstop, so the invariant "must be re-asserted in every
  read surface and every write path".
- `src/lib/absence-list.ts:50-54` — the shared `json()` helper, hoisted "after the third verbatim
  copy appeared". `[id].ts:50-54` still carries its own copy.

The exact role rules as they stand:

| Actor | Own rows | Others' rows | The `is_system` admin's rows |
|---|---|---|---|
| Unauthenticated | 401 | 401 | 401 |
| Caller with no live `employees` row (incl. deactivated) | 403 | 403 | 403 |
| `employee` | create / PATCH / DELETE | invisible — POST's `employee_id` ignored, PATCH/DELETE pin `employee_id` → 404 | n/a |
| `moderator` | same | create via body `employee_id` (404 if target missing/soft-deleted); PATCH/DELETE any row by id | create/PATCH **403**; **DELETE currently unguarded** |

**No multi-row DELETE exists in production code.** Every `db.delete(...)` under `src/pages/` is
single-row by primary key (`absences/[id].ts:316`, `holiday-balances/[id].ts:83`). `inArray`
appears in exactly one production file — `bulk.ts:8,222`, and there only in the pre-read `SELECT`.
Every `inArray`-in-a-delete is test teardown. The only other array-bodied write route is
`PATCH /api/employees/order` (`src/pages/api/employees/order.ts`), moderator-only, `.max(500)`,
statement pushed into `src/lib/employee-reorder.ts` so it is directly testable, returning
`{ ok: true }` with no per-item outcome — `src/types.ts:41-44` notes `AbsenceBulkCreateResult` is
"that shape extended rather than copied".

### 5. Side effects of an absence disappearing — almost none

`absences` (`src/db/schema.ts:84-118`, created in `drizzle/0000_baseline.sql:27-49`) is a **leaf
table**: three FKs point outward (`employee_id`, `absence_type_id`, `substitute_employee_id`),
nothing references it, no `ON DELETE CASCADE`, no triggers, no views. A delete can never raise
`SQLITE_CONSTRAINT_FOREIGNKEY`, and neither the `absences_time_check` CHECK nor the unique
`(employee_id, date)` index can be violated by a delete.

- **Holiday balance: nothing to recalculate.** `computeUsedDays`
  (`src/lib/services/holiday-balance.ts:16-66`) reads the absence rows live; `holiday_balances`
  stores only entitlement inputs (`schema.ts:120-144`), never a decremented remaining count.
  `left = current + carryover − used` is derived in `buildBalanceView` (`:73-92`). Correctness
  after a bulk delete is free, provided the client re-reads.
- **Priority: no cross-row invariant.** `isPriorityViolation`
  (`src/lib/services/absence-priority.ts:23-32`) is a per-row type-eligibility rule only. The
  schema says so at `schema.ts:100-104`: *"The flag carries no behaviour: no collision resolution,
  no balance or statistics effect."* Every `is_priority` consumer is a renderer.
- **Partial-day: same shape**, `src/lib/services/absence-partial-day.ts:19-30`. A write guard with
  nothing to validate on a delete; the CHECK constraint means a deleted partial-day row removes a
  consistent unit.
- **Weekend rule is write-time policy only** (`bulk.ts:159-168`), irrelevant to deletion.

Read surfaces are all live per request — no HTTP caching of `/api/absences*`, no service worker,
nothing materialised. The grid, monthly Szczegóły, monthly stats and the balance card are
server-rendered props from `src/pages/dashboard.astro:143-168`; XLSX export re-fetches per click
(`AbsenceExportDialog.tsx:55`). **The only caches are three fetch-once `useRef` flags** —
`AbsenceStats.tsx:337` (`fetchedYear`), `AbsenceDetailsSubcards.tsx:99` (`todayFetched`) and
`:100` (`yearlyFetched`). They are harmless *only because every mutation ends in
`window.location.reload()`* (`AbsenceFormDialog.tsx:445`, `:453`, `:476`). A bulk delete that
updated state in place instead would leave all three stale.

`is_system` is a column on **`employees`**, not on `absences` (`schema.ts:62-65`). Reads are
filtered by `visibleEmployeesFilter()` in `absenceEmployeeJoin` (`src/lib/absence-list.ts:80-84`)
and again in `dashboard.astro:112-121`, so an admin-owned absence can never surface in the UI —
which is precisely why one, if it existed, would also be undeletable through the UI (the argument
`absence-write-hardening/plan.md:40` makes).

### 6. Test and E2E coverage

**Harness.** `src/tests/helpers/astro-env.ts:25-33` stubs `astro:env/server` and mints one
throwaway SQLite file per test file under `tmpdir()/urlopy-vitest`; `db.ts:16-18` memoises
`migrateAndSeed(...).then(createDb)`; `setup.ts:13-15` removes the `.db`/`-wal`/`-shm` siblings in
`afterAll`; `fixtures.ts:42-72` provides `createTestEmployee` / `createTestModerator` /
`teardownTestEmployee` (absences → holiday_balances → users, since FKs are enforced without
cascade). Absence suites hand-roll a narrow `makeContext` rather than using `http.ts`'s
`makeApiContext`, and each suite **owns a date window** to stay parallel-safe (bulk owns May 2026,
`is-system-guard` May 18–Jun 11, `error-contract` July, `priority-guard` September).

**`src/tests/api/absences/bulk.test.ts`** (302 lines) covers: weekend in the run → 400 and *nothing
written* (`:141`); non-training type with `is_full_day:false` → 400 (`:153`); duplicate dates
rejected at the zod refine (`:169`); 32 dates → 400 containing "31" (`:180`, with `MAX_BULK_DATES`
deliberately not imported); `2026-02-31` → 400 not a DB 500 (`:194`); an employee's `employee_id`
silently ignored (`:208`); a moderator's honoured (`:225`); `created_dates`/`overwritten_dates`
reporting asserted against stored rows (`:238`); `is_priority` cleared on the overwrite path
(`:266`); unauthenticated → 401 (`:296`).

**`is-system-guard.test.ts`** runs every case against **both** write routes through a shared
`Write` type (`:93-104`) so they cannot drift: 403 for a moderator targeting the admin (`:156`),
403 for the admin writing its own column (`:169`), 403 for the admin as substitute (`:182`), 404
(not 403) for an unknown `employee_id` (`:212`), 404 for a soft-deleted target (`:221`), 422 for a
nonexistent substitute (`:241`), and a soft-deleted substitute still allowed (`:258`).

**`error-contract.test.ts`** locks status codes at the route boundary (`:13-25` explains why a
helper-level test cannot), asserting exact-equality on whole bodies and that **nothing was
written** on every failure path.

**The gap.** No test in `src/tests/` imports `DELETE` from `@/pages/api/absences/[id]` — verified:
the only imports from that module across the suite are `PATCH` (`error-contract.test.ts:11`,
`hours-clamp.test.ts:11`, `partial-day-guard.test.ts:11`, `priority-guard.test.ts:11`).
`crud.test.ts:153` ("DELETE — SELECT returns zero rows after deletion") is a raw Drizzle statement
at the DB level, exercising no route, no auth, no ownership gate. The closest existing template
for what is missing is `src/tests/api/holiday-balances/delete.test.ts`, which *does* cover a route
DELETE including "an employee cannot delete another employee's balance" (`:115`) and "nobody may
delete the technical admin's balance" (`:144`).

**E2E.** `tests/e2e/` holds `absence-form-dialog.spec.ts`, `absence-grid-range.spec.ts`,
`setup/auth.setup.ts` and `e2e-rules.md`. `playwright.config.ts` runs `fullyParallel: false`,
`workers: 1`, with a `setup` project producing `tests/e2e/.auth/user.json`. Auth is a **real UI
sign-in** against a live deployment using `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`; note `baseURL`
still defaults to the stale `main`-branch Cloudflare URL (`playwright.config.ts:24`) and must be
overridden with `BASE_URL`. Cell locators are `data-testid="absence-cell-<employeeId>-<date>"`
(`absence-grid-range.spec.ts:74`), and the drag helper uses real `page.mouse.down()/up()`
(`:101-112`) because dispatched `mouseenter` reaches no handler. Existing range specs: "a range
spanning a weekend writes only the weekdays" (`:124`) and "a range crossing an entry confirms
before overwriting, and Anuluj writes nothing" (`:152`) — both assert the **stored rows**, not just
the UI, and the second checks the untouched row keeps its original id.

Two `e2e-rules.md` conventions bind a bulk-delete spec specifically:

- `absence-cell-<employeeId>-<date>` is **the repo's only `data-testid`** (`e2e-rules.md:81-84`);
  everything else must be `getByRole`/`getByLabel`/`getByText`. Dialog headings are matched
  `exact`, and the three known ones are "Dodaj nieobecność", "Edytuj nieobecność" and "Dodaj
  nieobecność na zakres dni" (`:90-92`) — a delete flow adding a fourth must register it there.
- State-changing `page.request.*` calls **need an explicit `Origin` header and must assert their
  status** (`e2e-rules.md:98-103`, `absence-grid-range.spec.ts:50-65`): Astro's
  `security.checkOrigin` answers 403 *"Cross-site DELETE form submissions are forbidden"*, and "a
  cleanup that cannot fail loudly is a cleanup that eventually stops running". The existing specs
  already call `DELETE /api/absences/:id` this way as teardown plumbing.

Also note for the client: the single DELETE answers **204 with no body**, and `handleDelete` never
parses one on success (`AbsenceFormDialog.tsx:474-476`). A bulk-delete client must not assume JSON
comes back unless the new route deliberately returns a report.

**E2E does not run in CI.** `.github/workflows/ci.yml` only greps the sign-in copy strings that
`auth.setup.ts` locates against (`:80`, `:94-95`, `:112-113`) so the two cannot drift. Scripts:
`npm run test` / `test:run` (vitest), `npm run e2e` (playwright).

## Code References

- `src/components/absence/AbsenceGrid.tsx:105-107` — the `DialogState` union a delete arm must join
- `src/components/absence/AbsenceGrid.tsx:161-198` — the commit effect; where a delete gesture would branch
- `src/components/absence/AbsenceGrid.tsx:180` — `partitionRange` call that currently discards `free`
- `src/components/absence/AbsenceGrid.tsx:404` — `clickable`, the writability rule per cell
- `src/components/absence/AbsenceGrid.tsx:330-332` — legend hint copy naming only two verbs
- `src/components/absence/AbsenceGrid.tsx:592-607` — the range dialog render site
- `src/components/absence/AbsenceFormDialog.tsx:110-131` — `AbsenceFormDialogRangeProps` and the union rationale
- `src/components/absence/AbsenceFormDialog.tsx:163` — the line that makes `Usuń` invisible in range mode
- `src/components/absence/AbsenceFormDialog.tsx:207`, `:519-552`, `:813-861` — the `form | confirm` step machine and footer
- `src/components/absence/AbsenceFormDialog.tsx:404-427` — the single fetch call site (bulk / PATCH / POST)
- `src/components/absence/AbsenceFormDialog.tsx:144-153`, `:428-453` — `unannouncedOverwrites` and the staleness warning
- `src/components/absence/AbsenceFormDialog.tsx:470-486` — `handleDelete`, single-id only, no confirmation
- `src/components/employee/DeleteConfirmDialog.tsx:21-80` — the repo's destructive-confirm pattern
- `src/lib/absence-range.ts:72-76`, `:139-152`, `:165-180` — selection and partition types
- `src/pages/api/absences/bulk.ts:42`, `:97`, `:143-152`, `:219-253`, `:263-275` — cap, POST-only export, target resolution, pre-read + upsert, error map
- `src/pages/api/absences/[id].ts:287-332` — the single-row DELETE, ownership ternary, 404-on-miss
- `src/pages/api/holiday-balances/[id].ts:60-76` — the join-to-`employees` pattern that supplies `is_system` for a row known only by id
- `src/lib/absence-write-target.ts:52-117`, `:132-169` — gate order, silent-ignore rule, substitute policy
- `src/lib/employees.ts:20-26` — `visibleEmployeesFilter`, `isProtectedAdmin`
- `src/lib/absence-list.ts:50-54` — the shared `json()` helper
- `src/lib/services/holiday-balance.ts:16-66` — used-days computed on read
- `src/db/schema.ts:84-118` — `absences` columns and constraints; `:100-104` — the priority flag carries no behaviour
- `src/types.ts:27-50` — `AbsenceBulkCreateCommand` / `AbsenceBulkCreateResult`, where a delete DTO would sit
- `src/tests/api/absences/bulk.test.ts:32-133` — date-window ownership and `afterEach` cleanup pattern
- `src/tests/api/holiday-balances/delete.test.ts:115`, `:144` — the closest template for a route-level delete suite
- `tests/e2e/absence-grid-range.spec.ts:74`, `:101-112`, `:124`, `:152` — testid scheme, drag helper, existing range specs
- `tests/e2e/e2e-rules.md:81-84`, `:90-92`, `:98-103` — the only permitted testid, exact dialog headings, the `Origin`-header rule for state-changing requests

## Architecture Insights

- **The pure-core / thin-shell split is the house pattern for gestures.** Arithmetic goes in
  `src/lib/*.ts` (dependency-free, unit-tested); the React island tracks events and asks. Any
  delete-set arithmetic belongs in `absence-range.ts` alongside `partitionRange`, not in the grid.
- **Ownership is expressed as a where-clause predicate, never as a pre-check.** The consequence is
  that a non-matching row is indistinguishable from a nonexistent one, and the repo answers 404
  rather than 403 for both. With N ids this stops being free: "N requested, M deleted" is the
  natural signal, and the all-or-nothing versus best-effort choice is a genuinely new decision.
- **Separate routes over widened ones.** `bulk.ts:21-33` argues the single-row create path is
  proven and should not be put at risk for a caller it never serves. The same argument applies to
  widening `DELETE /api/absences/:id`.
- **Every guard is application-level; there is no database backstop.** RLS never applied on the
  service-role connection and does not exist on SQLite (`bulk.ts:28-33`, `employees.ts:4-12`).
  Server routes therefore re-validate everything the gesture claims to have done.
- **One `window.location.reload()` per mutation** is the accepted refresh model; optimistic updates
  have been out of scope in every prior plan. Three fetch-once refs quietly depend on it.
- **Per-day reporting is the bulk route's distinguishing feature.** `created_dates` /
  `overwritten_dates` exist so the client can detect that the server touched a day the
  confirmation never named. A delete has the exact analogue.

## Historical Context (from prior changes)

**Bulk delete was explicitly considered and rejected, three times, in `grid-multicheck` (S-21):**

- `context/archive/2026-08-12-grid-multicheck/plan.md:105` — under "What We're NOT Doing":
  > `- **Bulk delete.** Deletion stays per-cell; the prototype's delete loop is not ported.`
- `context/archive/2026-08-12-grid-multicheck/plan-brief.md:46` — decision table:
  > `| Dialog seeding | Blank form, no bulk delete | The prototype's seed-from-first-day silently inherits one arbitrary day into an N-day write. | Plan |`
- `context/archive/2026-08-12-grid-multicheck/plan-brief.md:58-60` — Scope:
  > `**Out of scope:** … optimistic updates; bulk delete; public holidays; entitlement blocking; …`
- `context/archive/2026-08-12-grid-multicheck/plan.md:393-394` — how the exclusion was implemented:
  > "`existingAbsence` is absent, so the delete button's existing `existingAbsence &&` guard
  > already hides it and the `handleDelete` path is unreachable. No new condition needed."
- `context/archive/2026-08-12-grid-multicheck/reviews/impl-review.md:38-40` confirms the guardrail
  held through implementation.

The reasoning was **scope discipline, not a safety objection**. The source prototype
(`new-design/10xUrlopy.dc.html`) *had* a delete loop; it was consciously left unported, and
`research.md:127-128` notes its one flaw — the delete loop did not re-check the weekday rule,
harmless there only because weekends can never hold an entry.

**Constraints inherited from that change that bind this one:**

- Destructive range operations require an explicit Polish confirmation **naming the affected days,
  not a count** (`frame.md:67-68`, `:124-127`; `plan-brief.md:44`), following
  `DeleteConfirmDialog.tsx`.
- The client already knows what is occupied at mouse-release — **no pre-flight request**
  (`frame.md:86-89`).
- The server must re-validate everything the gesture claims (`plan.md:127-131`).
- **Finding F1** (`reviews/impl-review.md:45-69`) is the closest precedent to a bulk-delete hazard:
  a stale grid overwrote entries with no confirmation, because the confirm was gated purely on
  client-computed `occupiedDays`. Fixed by reading the server's `overwritten_dates` back and
  toasting a blocking warning for any day the confirmation never named. **The same staleness
  applies to any client-computed delete set.**

**`absence-write-hardening` (2026-08-18)** is the cautionary tale for how a bulk route is built
here: `bulk.ts` was created by copying `index.ts` "under a plan instruction to do so" and inherited
its missing `is_system` guard, invisible for months because the read side *is* filtered — so such a
row is undeletable through the UI (`plan.md:40`). That change deliberately left `PATCH`/`DELETE` on
`[id].ts` unguarded on the reasoning that "they cannot retarget a row, so they cannot create an
admin row; after this change none can exist to edit" (`plan-brief.md:37`). That reasoning is sound
for the existing routes but does not transfer automatically to a new bulk-delete path.

**`crud-integrity` (2026-06-03)** established the integration-test posture and noted DELETE's catch
block handles fewer error codes than its siblings, deliberately (`research.md:183`).

**`context/foundation/lessons.md`** — "Repo-wide claims are load-bearing": both false claims it
records were about *this* area (the `is_system` guard, and "there is no integration-test layer"),
and the second routed all `bulk.ts` verification to manual checks, so the highest-risk file in
`grid-multicheck` shipped untested.

**PRD and roadmap.** The PRD authorizes absence deletion **per entry, with no cardinality
qualifier and no bulk language**:

> `prd.md:74` — `FR-002: Pracownik can add, edit, and delete their own absence entries.`
> `prd.md:76` — `FR-003: Moderator can add, edit, and delete absence entries for all employees.`

There is no occurrence of `bulk`, `masowo`, `zbiorczo` or `zaznaczanie wielu` anywhere in the PRD.
Note, though, that the multi-day **create** feature (S-21) has no dedicated FR either — the roadmap
maps it to FR-001 + FR-004 — so a bulk-delete counterpart sits in exactly the same position, not in
a novel gap.

In `roadmap.md`, deletion appears only as shipped per-entry CRUD (`:43`, `:121`) and as employee
soft-delete (`:46`, `:157`, `:164`). S-21 `grid-multicheck` (`:63`, `:374-388`) is the only
multi-select slice and is scoped purely to writes, with no delete counterpart raised in its
Unknowns. `## Parked` (`:442-448`), `## Backlog Handoff` (`:427-436`) and `## Open Roadmap
Questions` (`:438-441`, "Brak.") were checked and contain nothing about bulk or deletion.
**Bulk delete is not a planned roadmap item** — it is net-new scope, the natural S-21 follow-up.

## Related Research

- `context/archive/2026-08-12-grid-multicheck/research.md` — the drag-selection exploration this
  change extends; documents the prototype's delete loop
- `context/archive/2026-08-18-absence-write-hardening/plan.md` — the `is_system` guard and the
  route-level test layer for `bulk.ts`
- `context/archive/2026-06-03-crud-integrity/research.md` — the original per-route error-code map
- `context/archive/2026-08-31-priority-absence-flag/research.md` — most recent research touching
  the same four write paths

## Open Questions

These are decisions for `/10x-plan` or `/10x-frame`, not gaps in the research:

1. **Gesture.** Does a delete reuse the same drag (adding a second action to the range dialog), or
   need its own affordance? The dialog is currently titled "Dodaj nieobecność na zakres dni" and
   its whole form is a create form; a delete action inside it is a different verb sharing a shell.
2. **Body shape.** `{ absence_ids: [...] }` (ids are already in `occupiedDays`) or
   `{ employee_id, dates: [...] }` (mirrors `AbsenceBulkCreateCommand`, and resolves the target
   through the same lookup so the `is_system` check falls out for free). The second composes with
   `resolveAbsenceWriteTarget`'s existing shape; the first does not.
3. **Partial-match semantics.** All-or-nothing, or best-effort with a `deleted_ids` report? The
   single-row convention (404 on no match) does not extend cleanly, and F1 says the report is what
   catches staleness.
4. **The `is_system` gap.** Close it on `DELETE /api/absences/:id` as part of this change, or scope
   the new route only and leave the old one? Leaving it means two delete paths with different
   guards.
5. **Route-level DELETE tests.** The existing single-row DELETE has none. Adding bulk delete
   without covering the ownership ternary leaves the whole delete surface untested.
6. **Empty-run behaviour.** A drag over entirely free days offers nothing to delete — hide the
   action, disable it, or answer "0 usuniętych"?
7. **Confirmation.** F1 argues for naming days rather than counting them, and the single-row delete
   has *no* confirmation at all today — an inconsistency a bulk delete will make visible.
