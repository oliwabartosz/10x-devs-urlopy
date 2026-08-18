---
date: 2026-08-12T15:25:56+02:00
researcher: Bartosz Oliwa
git_commit: 347fce029bab4bf848b3d0981f88d84c4cf5f824
branch: main
repository: 10x-devs-urlopy
topic: "Drag-to-select a day range in the absence grid, skipping non-clickable weekends"
tags: [research, codebase, absence-grid, drag-select, bulk-write, dnd-kit, weekends]
status: complete
last_updated: 2026-08-12
last_updated_by: Bartosz Oliwa
---

# Research: Drag-to-select a day range in the absence grid

**Date**: 2026-08-12T15:25:56+02:00
**Researcher**: Bartosz Oliwa
**Git Commit**: `347fce0` (pushed to `origin/main`)
**Branch**: `main`
**Repository**: `10x-devs-urlopy`

> **Line numbers in this document refer to the WORKING TREE, not to commit `347fce0`.**
> The tree is dirty: `src/components/absence/AbsenceGrid.tsx` carries 11 uncommitted insertions
> and 4 deletions from the `huge-ui-ux-improvement` review-fix batch. GitHub permalinks to the
> commit would silently resolve to shifted lines in exactly the file this change touches most,
> so they are deliberately omitted.

## Research Question

Today a moderator must click each grid cell separately. A `urlop` is often 10 working days
(14 calendar days including weekends, which must stay non-clickable). Make range entry possible
by dragging the mouse across grid cells. The target design is the prototype in `new-design/`.

Scope agreed before research: **the drag interaction *and* the write path it commits to** —
the range dialog, whether N absences need a bulk API, overlap and balance rules, transaction
semantics. Input modality: **mouse drag only** (touch and keyboard explicitly out of scope).

## Summary

The gesture itself is the easy half. The prototype's model is ~40 lines of state
(`new-design/10xUrlopy.dc.html:693-738`), and the app's grid is structurally ready for it:
the existing `@dnd-kit` column-reorder drag binds its listeners to the header grip handle only
(`AbsenceGrid.tsx:71`), so a cell-level pointer gesture does **not** compete for events. That
was the single biggest unknown going in, and it resolves in this change's favour.

The hard half is everything downstream of the mouse release. Five findings dominate:

1. **There is no multi-day write path at any layer.** `POST /api/absences` inserts exactly one
   row (`src/pages/api/absences/index.ts:252-267`), `AbsenceFormDialog` is structurally
   single-date (`day: Date`, `AbsenceFormDialog.tsx:72`), and no bulk create exists for any
   entity. The only array-bodied endpoint in the repo is `PATCH /api/employees/order`, an
   UPDATE with **no per-item error reporting** (`src/pages/api/employees/order.ts:67-85`).

2. **`UNIQUE (employee_id, date)` turns one occupied day into a whole-range failure.**
   The constraint is discovered reactively as PG `23505` → HTTP 409 with a fixed message
   (`index.ts:279`) that cannot say *which* date collided. Dragging across a month will
   routinely cross an existing entry, so an overlap policy — skip / overwrite / reject —
   is not an edge case, it is the main path. **This policy has never been decided**
   (`huge-ui-ux-improvement/research.md:191`, `:296`).

3. **Weekend exclusion is a UI-only rule with no server enforcement.** `isWeekend` is computed
   at `AbsenceGrid.tsx:275` and folded into `clickable` at `:300`; a direct POST of a Saturday
   is accepted and stored. The prototype handles this correctly in two independent places —
   weekend cells get no handlers (`:839-841`) *and* the save loop skips them (`:1370`) — and
   the app will need the same belt-and-braces, because a drag from the 5th to the 19th
   necessarily passes over weekends.

4. **Holiday balance is derived, not mutated.** `computeUsedDays` aggregates absence rows on
   read (`src/lib/services/holiday-balance.ts:15-59`). Writing N `urlop` rows requires no
   balance write, no cross-table consistency, and therefore no transaction spanning two tables.
   This removes the largest consistency risk a bulk write would normally carry. Relevant given
   that **`db.transaction(` appears zero times in the repo** — a single multi-row `INSERT` is
   atomic on its own and needs no new pattern.

5. **Verification is genuinely constrained.** There is no component-test infrastructure
   (vitest is `environment: "node"`, `include` is `.ts` only — `vitest.config.ts:12-13`),
   no `data-testid` anywhere in the repo (0 occurrences), E2E never runs in CI, and
   `tests/e2e/e2e-rules.md:71-73` documents a standing bias *against* pixel-geometry pointer
   drags. The repo's own escape hatch is the `radial-timepicker-ux` precedent: extract the
   geometry into a pure module (`src/lib/time-dial.ts`) and unit-test that
   (`src/tests/lib/time-dial.test.ts`), leaving only a thin untested shell in the component.

One more thing the plan must absorb: **this feature was already researched and deliberately
deferred.** `huge-ui-ux-improvement` analysed drag-to-select, ruled it out of scope, and
required that it come back "with its product question answered first" (`frame.md:125`). It
also stripped the prototype's own hint text for exactly this reason (`plan.md:498`).

## Detailed Findings

### 1. The prototype's drag model (`new-design/`)

`new-design/` holds a claude.ai/design export: the prototype (`10xUrlopy.dc.html`), a generated
runtime (`support.js` — "GENERATED from dc-runtime/src/*.ts — do not edit", not design intent),
and a README stating the folder should be deleted after implementation.

The complete gesture is four pieces:

- **State** — `drag: null` (`10xUrlopy.dc.html:693`), shaped `{ person, from, to }`.
- **Start** — `onMouseDown` on a cell sets `{ person: pi, from: d, to: d }` (`:728`).
- **Extend** — `onMouseEnter` widens it, but only within the same column, and early-returns if
  the day is unchanged (`:729-733`):
  ```js
  enter: () => {
    const dr = this.state.drag;
    if (!dr || dr.person !== pi || dr.to === d) return;
    this.setState({ drag: { person: pi, from: dr.from, to: d } });
  },
  ```
- **Commit** — a **window-level** `mouseup` listener, registered in `componentDidMount` and torn
  down in `componentWillUnmount` (`:700-710`). It normalises direction and only opens the range
  modal when the drag actually spanned more than one day:
  ```js
  const a = Math.min(d.from, d.to), b = Math.max(d.from, d.to);
  this.setState({ drag: null });
  if (b > a) this.openModal(d.person, a, b);
  ```
  A single-cell press falls through to the ordinary `onClick` (`:734`), so click-to-add is
  preserved unchanged. Binding on `window` rather than the cell is what makes a release
  outside the grid still commit rather than stranding the drag.

Supporting details worth porting:

- **Drags are anchored to one employee.** `dr.person !== pi` (`:731`) blocks horizontal spread.
  Two-dimensional selection is not part of the design.
- **Weekends are excluded twice.** Handlers are withheld entirely rather than no-op'd
  (`:839-841`, `down/enter/click: weekend ? undefined : hs.*`), and the save loop re-checks:
  `if (this.dowIndex(d) >= 5) continue;` (`:1370`). The delete loop does *not* re-check
  (`:1360`) — harmless there only because weekends can never hold an entry.
- **Selection feedback** is a fill plus an inset ring: `background: inDrag ? '#d5ebf5' : bg`
  and `boxShadow: inDrag ? 'inset 0 0 0 2px #072143' : 'none'` (`:816-817`). `#072143` is the
  app's `--primary` navy; `#d5ebf5` is a new value, close to but not identical to the app's
  existing `#eef3f8` hover tint.
- **`userSelect: 'none'`** on every cell (`:818`) — without it a mousedown-drag selects the day
  numbers and weekday labels as text. The app's table has no such suppression today.
- **One draft writes the whole range.** The dialog is seeded from the entry at `dayFrom` only
  (`:715`), and save applies the same draft — type, hours, comment, substitute — to every
  non-weekend day (`:1369-1372`). The modal title switches to a range label,
  `dayFrom + '–' + dayTo + ' ' + MONTHS[...]` (`:1389-1391`).
- **The prototype silently overwrites.** `e[m.person + '-' + d] = {...draft}` (`:1371`)
  clobbers any existing entry in the range with no warning. That is a plausible product answer,
  but it is the prototype's *implicit* answer, not a decision the project has taken — and it is
  the one behaviour a real DB with a unique constraint will not give you for free.

The prototype also carries features the app has deliberately rejected — a priority flag
(`:546-551`) and its 🅿️ badge. Those are out of scope here
(`huge-ui-ux-improvement/plan.md:517`).

### 2. Current grid anatomy (`src/components/absence/AbsenceGrid.tsx`)

**Orientation matches the prototype**: days are `<tr>` rows (`:279`), employees are `<td>`
columns (`:308`). A range is therefore a *vertical* run of cells at a fixed column index.
It is a real `<table>` (`:248`), not flex or CSS grid, inside the sole horizontal scroll owner
`<div className="overflow-x-auto">` (`:247`), itself inside an `overflow-hidden` card (`:225`).

**Cell interaction today is a single `onClick` on the `<td>`** (`:316-322`), set to `undefined`
rather than a no-op when the cell is not actionable:

```ts
const clickable = (isOwn || isModerator) && !isWeekend && !isInactive;   // :300
onClick={ clickable ? () => { setDialogState({ day: date, absence: absence ?? null, targetEmployee: emp }); } : undefined }
```

The comment at `:310-311` states the governing intent — "Hover only where a click does
something — weekends are excluded by `clickable`, so they never gain an affordance they cannot
honour." A drag implementation must preserve that: no selection feedback on cells that cannot
be written.

Facts that shape the implementation:

- **Identity is not on the DOM.** Employee identity exists only inside the inner
  `orderedEmployees.map` closure (`:295`), day only in the outer `days.map` (`:274`). No `<td>`
  carries `data-*`, `role`, `aria-*`, `tabIndex`, or an accessible name. The E2E suite locates
  a cell by the literal `+` text (`tests/e2e/absence-form-dialog.spec.ts:33`).
- **Nothing is memoized.** No `React.memo`/`useMemo`/`useCallback` anywhere in the file. Every
  render rebuilds `absenceMap` (`:114-117`), `absenceTypeMap` (`:119-122`), `employeeNameMap`
  (`:126-129`) and constructs two `Intl.DateTimeFormat` instances (`:131-132`). A naive
  `useState` drag value at grid level re-runs all of that **on every `mouseenter`** — the one
  concrete performance constraint this change has to bound.
- **Post-write refresh is a full page reload** — `window.location.reload()` on save and delete
  (`AbsenceFormDialog.tsx:222`, `:240`). Acceptable for one cell; prior research already called
  it "a visibly poor interaction" for a range (`huge-ui-ux-improvement/research.md:272`).
- **Cell styling to match**: `"border-line-strong h-[34px] border-r border-b p-[3px]"` plus
  `clickable ? "cursor-pointer hover:bg-[#eef3f8]" : "cursor-default"` (`:312-315`). Row
  background is `isWeekend ? "bg-surface" : "bg-white"` (`:279`). The nearest existing
  "selected" vocabulary is the dialog's chip — `"border-primary ring-primary bg-[#f4f7fa] ring-1"`
  (`AbsenceFormDialog.tsx:291`).
- **Pre-existing, adjacent**: `orderedEmployees` is seeded once from props (`:94`) with no
  effect resyncing it when `employees` changes. Not caused by this change; worth not tripping over.

### 3. Gesture collision with column drag-and-drop — resolved favourably

Prior research flagged this as needing an explicit decision
(`huge-ui-ux-improvement/research.md:220`: "Decide explicitly whether column reordering
survives"). Direct inspection answers it:

`DndContext` wraps the whole table (`:218-224`) and a `PointerSensor` with
`activationConstraint: { distance: 5 }` is mounted at grid level (`:110`) — but `useSortable`'s
`listeners` are spread **only onto the `GripVertical` handle span in the header** (`:71`),
never onto the `<th>` and never onto a body `<td>`. dnd-kit sensors activate from the element
carrying the listeners, so a mousedown on a `<td>` is not seen by the sortable system at all.

The load-bearing comment at `:59-60` explains why the handle-only binding exists (a CSS
`transform` on a `<th>` detaches it in a table layout — the S-07 lesson from
`employee-grid-order/plan.md:16`). That constraint must survive: **do not move dnd-kit listeners
onto `<th>` or `<td>` to "unify" the two gestures.**

So both gestures can coexist. The residual risks are ordinary rather than architectural: the
`distance: 5` threshold means a slow 5px drift starting on a *header handle* still belongs to
reorder, and a cell drag must call `preventDefault` on the native dragstart / suppress text
selection so the browser's own selection does not fight the range highlight.

### 4. The write path — single-row everywhere

**`POST /api/absences`** (`src/pages/api/absences/index.ts:167-283`) accepts one date:

```ts
date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),      // :149
```

Note this is a raw regex, not the calendar-validating `DateSchema` (`src/lib/validators.ts:3-9`)
used by GET and PATCH — `2026-02-31` passes zod and is rejected only by Postgres. A range
expander generating dates client-side sidesteps this, but a bulk endpoint accepting an explicit
date array would inherit the weakness.

Authorization: `employee_id` is honoured **only** for moderators (`:204`), with the target
verified to exist and be non-deleted (`:207-219`). RLS exists on the table
(`supabase/migrations/20260526000001_schema.sql:139-146`) but is **bypassed in production** —
the connection uses the service-role key, so "all row-level authorization must be enforced
explicitly in handler code" (`AGENTS.md:62`). Any bulk route must repeat the moderator check
itself; the database will not backstop it.

Constraints a multi-row insert meets:

| Constraint | Location | Effect on a range write |
|---|---|---|
| `UNIQUE (employee_id, date)` | `schema.sql:51`, `src/db/schema.ts:65` | **One colliding day aborts the entire statement** |
| `absences_time_check` | `20260605000001_absence_start_end_time.sql:25-30` | Shared time window is fine — validated per row |
| FKs (type, substitute) | `schema.sql:42-48` | `23503` → 422 |

Error mapping (`index.ts:271-281`) maps `23505` → 409 `"Masz już wpis nieobecności na ten dzień."`
— singular, and unable to name the offending date.

**Transactions**: `db.transaction(` appears **zero times** in the repo. The driver supports it
(`drizzle-orm/postgres-js`, `src/db/index.ts:9-13`) and the pooler is Transaction Mode with
`prepare: false`, so transactions would work — but a **single multi-row `INSERT ... VALUES (...), (...)`
is already atomic**, so the feature needs no new transaction pattern. Postgres offers
`ON CONFLICT DO NOTHING` for a skip policy; precedent for `onConflict*` exists at
`src/pages/api/holiday-balances/index.ts:182-200`.

**Client call site**: there is no shared hook or fetch helper. The POST is inline in
`AbsenceFormDialog.handleSave` (`:198-232`), sending `{ employee_id, ...sharedFields }` and
calling `window.location.reload()` on success (`:222`); failures surface as a single
`toast.error` (`:224-226`) with no inline field errors.

**The client-loop alternative** (N sequential POSTs, no new endpoint) is worth stating plainly
because it looks cheap: 10 round trips, no atomicity, a partially-written range on any failure,
and a reload that must be deferred until the last one. It also multiplies the 409 problem
rather than solving it. The bulk-endpoint path is more work but is the only one that can report
"days 8 and 9 already had entries" coherently.

### 5. Weekends

- **Client**: `const isWeekend = date.getDay() === 0 || date.getDay() === 6;` (`:275`) — the
  only weekday check in the grid; the repo's only other `getDay()` is
  `AbsenceDetailsSubcards.tsx:28`.
- **Server**: nothing. A sweep for `weekend|getDay|dayOfWeek|sobot|niedziel` across `src/pages/api/`,
  `src/lib/`, and `supabase/` returns hits only in React components. Confirmed independently in a
  prior review: "no server-side weekend rule exists anywhere in `src/pages/api/absences/` or
  `src/lib/`" (`huge-ui-ux-improvement/reviews/impl-review.md:165`).
- **Product basis**: `context/foundation/prd.md:52` — work runs Monday to Friday.
- **Public holidays do not exist at any layer** — no table, migration, service, or constant, and
  no prior decision anywhere in `context/`. A 10-working-day `urlop` spanning a public holiday
  will therefore write an absence row on that holiday. Out of scope here, but it is the natural
  next question a user will ask after weekends are skipped.

### 6. Holiday balance — a genuine simplifier

`computeUsedDays` (`src/lib/services/holiday-balance.ts:15-59`) derives usage by aggregating
absence rows at read time:

```ts
fullDays:     sql`count(*) filter (where ${absences.is_full_day})`,
partialHours: sql`coalesce(sum(extract(epoch from (${absences.end_time} - ${absences.start_time})) / 3600) filter (where not ${absences.is_full_day}), 0)`
```

Only the type named exactly `urlop` counts (`:24-28`) — `urlop planowany` is deliberately
excluded. `left = current_entitlement + carryover − used` (`:66-89`). The stored
`holiday_balances` row holds only entitlement, carryover, and the moderator-only adjustment.

Consequences: writing N `urlop` rows needs **no** balance write and no multi-table consistency.
There is also **no entitlement check on create** — an employee can already book past their
entitlement and `left_days` simply goes negative (`:77`). A 10-day drag will not be blocked by
balance, and making it blocking would be a new rule, not a preserved one.

### 7. Verification reality

| Layer | State | Reference |
|---|---|---|
| Component tests | **Do not exist and cannot without new deps** — `environment: "node"`, `include: ["src/tests/**/*.test.ts"]` (`.ts` only) | `vitest.config.ts:12-13` |
| Pure-function unit tests | Established, 9 suites | `src/tests/lib/*.test.ts` |
| E2E | Exists but **never runs in CI**; runs against deployed Workers, no `webServer` | `playwright.config.ts:24`, `.github/workflows/ci.yml` |
| Cell locators | Only `getByText("+").first()` — a *specific* (employee, day) cell is not addressable | `tests/e2e/absence-form-dialog.spec.ts:33` |
| `data-testid` | **0 occurrences repo-wide**; testids are a documented fallback only | `tests/e2e/e2e-rules.md:6` |
| Pointer drags in tests | **0 uses**, and explicitly argued against | `e2e-rules.md:71-73`, `absence-form-dialog.spec.ts:129-130` |

The E2E suite is additionally **red at the setup project** right now, a known blocker
(`radial-timepicker-ux/change.md:29`).

The repo's own answer to "how do you test a pointer gesture" is the `radial-timepicker-ux`
precedent: the dial's geometry lives in a pure module `src/lib/time-dial.ts` with a unit suite
`src/tests/lib/time-dial.test.ts`, and the E2E test drives the *keyboard* path because "a
synthesized drag would depend on pixel geometry" (`absence-form-dialog.spec.ts:129-130`).
Applied here, the testable core is range arithmetic — normalise direction, clamp to one
employee column, expand to dates, drop weekends, partition against existing entries — which is
pure and belongs in `src/lib/`, leaving the mouse plumbing thin.

Note also `AGENTS.md:9` is **stale**: it claims "There is no Playwright/E2E setup — do not
invent commands beyond these", contradicted by `playwright.config.ts`, `tests/e2e/`, and
`package.json:25-27`.

### 8. In-flight work and sequencing risk

Three changes are open against this exact file. This is the largest practical risk to the change.

- **`huge-ui-ux-improvement`** — status `impl_reviewed`, 80/80 plan rows done, but the 10
  review fixes from 2026-08-11 are **uncommitted**. `AbsenceGrid.tsx` currently carries
  +11/−4 from that batch: a grip-icon token swap, `sticky left-0 z-20` on the `Dzień` `<th>`,
  and `sticky left-0 z-10` plus per-row background on the day `<td>`.
  (`huge-ui-ux-improvement/reviews/impl-review-2.md:8`)
- **`grid-adjustment-offsite-training`** — status `planned`, **zero code written**, entire folder
  untracked. Its plan rewrites `AbsenceGrid.tsx` at seven sites (`plan.md:225, 264, 277, 290,
  331, 347, 358`), including a switch to `table-fixed` with `w-[120px]` columns and extraction
  of `cellTimeRange` into a new `src/lib/absence-grid-cell.ts`. Sites `:277`/`:290` overlap the
  `<td>` render region a drag implementation must touch. Its own step 0.1 sequences it *after*
  committing the `huge-ui-ux-improvement` fixes (`plan.md:456`).
  Two of its acceptance rows become harder to hold once a second drag gesture lands on `<td>`:
  `:514` ("Drag-to-reorder still works") and `:515` ("weekend shading, the pale `+`, and the
  hover highlight are unchanged").
- **`radial-timepicker-ux`** — status `implementing`, Phase 4 E2E rows 4.3–4.5 open, blocked on
  the red E2E setup project.

Cleanest ordering: commit the pending `huge-ui-ux-improvement` fixes, then land
`grid-adjustment-offsite-training` (which restructures the `<td>` region), then build
drag-select on the settled structure. Going first means rebasing a gesture onto a
`table-fixed` rewrite.

## Code References

**Prototype**
- `new-design/10xUrlopy.dc.html:693-738` — complete drag model: state, mousedown, mouseenter, window mouseup
- `new-design/10xUrlopy.dc.html:816-818` — selection styling (`#d5ebf5` fill, `inset 0 0 0 2px #072143` ring) and `userSelect:'none'`
- `new-design/10xUrlopy.dc.html:839-841` — weekend cells receive no handlers at all
- `new-design/10xUrlopy.dc.html:1364-1375` — range save loop; `:1370` skips weekends; `:1371` silently overwrites
- `new-design/10xUrlopy.dc.html:1389-1391` — range title label
- `new-design/10xUrlopy.dc.html:101` — prototype hint copy, both halves

**Grid**
- `src/components/absence/AbsenceGrid.tsx:275` — weekend detection
- `src/components/absence/AbsenceGrid.tsx:295-305` — per-cell derivation, `clickable` rule
- `src/components/absence/AbsenceGrid.tsx:308-323` — the `<td>`: classes, `onClick`, no `data-*`/ARIA
- `src/components/absence/AbsenceGrid.tsx:310-311` — "no affordance a cell cannot honour"
- `src/components/absence/AbsenceGrid.tsx:59-60`, `:71` — dnd-kit listeners on the grip handle only
- `src/components/absence/AbsenceGrid.tsx:110`, `:218-224` — `PointerSensor` and `DndContext` scope
- `src/components/absence/AbsenceGrid.tsx:112-132` — unmemoized per-render map construction
- `src/components/absence/AbsenceGrid.tsx:247` — sole horizontal scroll container

**Dialog**
- `src/components/absence/AbsenceFormDialog.tsx:69-78` — props; `day: Date` singular
- `src/components/absence/AbsenceFormDialog.tsx:198-232` — inline POST/PATCH, reload on success
- `src/components/absence/AbsenceFormDialog.tsx:291` — existing "selected" visual vocabulary

**API / schema**
- `src/pages/api/absences/index.ts:145-165` — `AbsenceCreateSchema`
- `src/pages/api/absences/index.ts:204-219` — moderator-on-behalf-of check
- `src/pages/api/absences/index.ts:252-267` — single-row insert
- `src/pages/api/absences/index.ts:271-281` — PG error → HTTP mapping, `23505` → 409
- `src/pages/api/employees/order.ts:17-27`, `:67-85` — the only array-bodied endpoint; no per-item errors
- `src/db/schema.ts:44-66` — `absences` table; `:65` the unique constraint
- `src/db/index.ts:9-13` — driver config (`prepare: false`, Transaction Mode pooler)
- `src/lib/services/holiday-balance.ts:15-59` — derived usage
- `supabase/migrations/20260526000001_schema.sql:139-146` — `absences_insert` RLS (bypassed in practice)

**Testing**
- `vitest.config.ts:12-13` — node env, `.ts`-only include
- `tests/e2e/e2e-rules.md:6`, `:71-73` — testid fallback rule; anti-pixel-drag rule
- `tests/e2e/absence-form-dialog.spec.ts:33` — the only grid-cell locator
- `src/lib/time-dial.ts` + `src/tests/lib/time-dial.test.ts` — the pure-module test precedent

## Architecture Insights

- **Withhold handlers, don't disable them.** Both the prototype (`:839-841`) and the app
  (`onClick: undefined`, `:316-322`) express non-interactivity by *absence* of a handler. The
  drag implementation should follow suit — weekend cells get no `onMouseDown`/`onMouseEnter`,
  rather than handlers that check and bail.
- **Guard the same rule at both ends.** The prototype withholds weekend handlers *and* re-checks
  in the save loop. Given the server has no weekday rule at all, the write path should not trust
  the gesture to have filtered correctly.
- **Pure core, thin shell.** The repo has no way to test a React pointer gesture, but a strong
  habit of extracting arithmetic into `src/lib/` and testing it hard. Range normalisation,
  weekend filtering, and collision partitioning are pure functions.
- **Atomicity is available without new patterns.** A single multi-row `INSERT` is atomic; the
  repo needs no `db.transaction()` to make a range all-or-nothing. Conversely, a client-side
  loop cannot be made atomic at all.
- **The unique constraint is a feature, not an obstacle.** It is what makes the grid's
  one-cell-one-day model true (`data-schema-and-rls/plan.md:101`). Drag-to-select does **not**
  overturn S-09's "no multi-day absence ranges" ruling (`absence-hours-range/plan.md:41`) —
  that ruling is about the *data model* (one row per day, times on a single date), and it
  survives intact. What changes is only how many rows one gesture creates.
- **Authorization lives in handlers, never in the DB.** Service-role connections bypass RLS
  (`AGENTS.md:62`), so a bulk route inherits no protection from the policies.

## Historical Context (from prior changes)

- `context/changes/monthly-grid-own-absence/plan.md:18`, `:311` — established one click = one
  cell = one day, and weekends "visible but dimmed, non-clickable" (`plan-brief.md:29`).
- `context/changes/moderator-absence-management/plan.md:126` — widened clickability to
  `(isOwn || isModerator)`.
- `context/changes/absence-hours-range/plan.md:41` — "No multi-day absence ranges — the UNIQUE
  `(employee_id, date)` constraint stays; start and end time are on the same date." A data-model
  ruling, not a gesture ruling.
- `context/changes/huge-ui-ux-improvement/research.md:31`, `:191`, `:220`, `:272`, `:296` —
  the prior analysis of this exact feature: N rows not a range row; overlap policy undefined;
  gesture collision to be decided; reload-after-range called out as poor UX.
- `context/changes/huge-ui-ux-improvement/frame.md:93`, `:125` — drag-to-select is one of three
  capabilities "blocked on product questions", each to become "a separate change, **each opening
  with its product question answered first**". This change is that separate change.
- `context/changes/huge-ui-ux-improvement/plan.md:498` — the prototype's
  "Przeciągnij, aby zaznaczyć zakres dni." hint was deliberately *not* ported; restoring it is
  part of this change's surface.
- `context/changes/employee-grid-order/plan.md:16`, `:51`, `:259` — S-07: no CSS transform on a
  `<th>`, listeners on the handle only. Must survive.
- `context/changes/crud-integrity/research.md:32-34` and
  `reviews/impl-review-phase-2.md:50` — the `23505` → 409 path and `extractPgErrorCode`.
- `context/foundation/test-plan.md:50`, `:61` — the grid is Risk #5; `:223` explicitly defers UI
  snapshot tests for it as high-churn / low-signal.
- `context/foundation/roadmap.md:111` — the monthly grid is called the project's main UX risk.
- `context/foundation/lessons.md` — one entry, unrelated (prop threading in `Topbar.astro`).

## Related Research

- `context/changes/huge-ui-ux-improvement/research.md` — the direct predecessor; sections 5.2/5.3
  and open question 3 are this change's inheritance.
- `context/changes/huge-ui-ux-improvement/frame.md` — why this was split out.
- `context/changes/grid-adjustment-offsite-training/plan.md` — concurrent, unstarted, rewrites
  the same `<td>` region.
- `context/changes/absence-hours-range/research.md` — the single-date time-window model.

## Open Questions

These are product decisions, not research gaps — the framing skill's requirement that this
change "open with its product question answered first" points squarely at the first one.

1. **Overlap policy — the blocking question.** A drag across a month will cross existing
   entries. Options: (a) **skip** occupied days and report what was skipped; (b) **overwrite**
   them, as the prototype does silently (`:1371`); (c) **reject the whole range** and ask the
   user to adjust. Each implies a different endpoint contract — `ON CONFLICT DO NOTHING`,
   an upsert, or a plain insert that 409s. Never decided
   (`huge-ui-ux-improvement/research.md:191`, `:296`).

2. **Bulk endpoint or client loop?** Research favours a bulk route on atomicity and error
   reporting, but it is a new API surface with a moderator check that RLS will not backstop.
   The only precedent (`employees/order`) reports no per-item results, which is precisely what
   an overlap report needs — so the precedent is a shape to *extend*, not copy.

3. **What does the range dialog show and write?** The prototype seeds from the first day and
   applies one draft to all (`:715`, `:1369-1372`). Confirm that a shared time window across
   many days is desirable — it is only reachable for the two training types
   (`src/lib/absence-types.ts:7-11`) — and how the title should read.

4. **Does the reload survive?** `window.location.reload()` after a 10-row write was already
   called "a visibly poor interaction" (`research.md:272`). Optimistic update is out of scope
   in every prior plan; if it stays a reload, that is a conscious acceptance.

5. **Sequencing.** Land after `grid-adjustment-offsite-training`, or accept rebasing the gesture
   onto its `table-fixed` rewrite?

6. **Is a `data-testid` scheme introduced now?** A specific (employee, day) cell is not
   addressable today. `e2e-rules.md:6` permits testids where no accessible name exists — true
   here — but this would be the repo's first, and would need documenting in the rules file.

7. **Minimum drag distance / accidental drags.** The prototype commits any drag where `to > from`
   (`:706`). No threshold, so a 1px jitter across a row boundary opens a 2-day dialog. dnd-kit
   uses `distance: 5` for the neighbouring gesture (`:110`) — worth matching.

8. **Public holidays** remain unhandled at every layer. A 10-working-day `urlop` will still
   write a row on a public holiday. Out of scope, but the obvious follow-up.
