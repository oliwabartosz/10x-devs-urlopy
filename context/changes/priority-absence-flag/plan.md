# Priority-Absence Flag (`[P]`) Implementation Plan

## Overview

Add an **informational** priority marker to absences: a boolean column `absences.is_priority`,
settable only for the two leave types `urlop` and `urlop planowany`, surfaced as a literal `[P]`
on the monthly grid chip, in the absence details view, and in the XLSX export.

The flag carries **no behaviour**. It does not resolve collisions, does not affect the holiday
balance, and does not appear in statistics. It is a marker moderators read. Stating this
explicitly is load-bearing: this feature (PRD **FR-008**) has been parked three times, and every
time the blocker was the unanswered question *"what does priority actually do when two absences
collide?"* (`context/archive/2026-08-07-huge-ui-ux-improvement/research.md:183-187`). The scope
agreed with the requester answers it: nothing. There is no collision logic in this change and
none is deferred to a later one.

## Current State Analysis

`grep -rniE "priorit|priorytet|is_priority" src/` returns **zero** hits — there is no priority
concept anywhere in the application code today.

What exists that this change builds on:

- **A twice-proven template for a name-keyed type rule.** `src/lib/absence-types.ts` is a
  16-line, deliberately dependency-free module holding `PARTIAL_DAY_TYPE_NAMES` and
  `typeAllowsPartialDay()`, shared verbatim by the React form (UX) and — through
  `src/lib/services/absence-partial-day.ts` — by all three write routes (enforcement).
- **`absence_types.name` is UNIQUE** on this branch (`src/db/schema.ts:70-72`), added by
  `sqlite-install` precisely because `absence-types.ts` gates on exact strings. This closes the
  "a partial rename silently yields two rows" trap recorded at
  `context/archive/2026-08-11-grid-adjustment-offsite-training/research.md:154-155`.
- **One migration on disk.** `drizzle/0000_baseline.sql` is the only entry in
  `drizzle/meta/_journal.json` (`idx: 0`). Its `CREATE TABLE absences` carries a hand-written
  `absences_time_check` CHECK that drizzle-kit does not know about — `meta/0000_snapshot.json`
  has no `checkConstraints` key for the table.
- **Six hand-written absence column lists**, none type-checked against each other, and one of
  them (`bulk.ts`'s `onConflictDoUpdate.set`) fails silently.
- **A form dialog with a three-part gating precedent** — defensive mount seeding, an *unmounted*
  render gate, and a reset funnelled through the single `selectType` mutation point.
- **A grid chip with both absolute badge anchors already occupied** and a hard layout constraint
  against inline content.
- **An XLSX export that writes no emoji at all** and never reads `type.icon`.

## Desired End State

A moderator opens the absence dialog on a cell, picks `urlop` or `urlop planowany`, and sees a
**"Priorytet"** checkbox below the type picker. Picking any other type makes the checkbox
disappear and clears any value it held. The saved absence renders on the grid with a small `[P]`
badge in the chip's right-hand corner alongside the comment marker; the grid legend explains what
`[P]` means; the cell's hover tooltip carries a `Priorytet: tak` line; the details view shows a
`[P]` pill next to the type chip; and the exported XLSX cell text is prefixed `[P]`, with a
`Priorytet: tak` line in the cell note and a `[P] = priorytetowy` entry in the legend row.

An API request that tries to set the flag on any other type is rejected with **400** — on POST,
on PATCH (judged against *effective* values), and on bulk.

**How to verify:** `npm run lint`, `npm run test` and `npm run build` all pass; the new route
tests fail when their guard call is deleted; and the grid + export are confirmed by eye per the
Manual Verification blocks below.

### Key Discoveries

- **The rule cannot be a zod `.refine()`.** Every request body carries `absence_type_id` (a
  number), never the type name. Resolving the name requires the DB, so this must be a
  handler-level guard. On record since 2026-06-22
  (`context/archive/2026-06-22-hours-onsite-training-only/`).
- **`assertAbsenceTypeExists` must run before the guard.** `src/lib/absence-write-target.ts:180-215`
  — a nonexistent type id resolves to an `undefined` name, which the guard's fallback would
  report as a rule violation (400) instead of the truth (422).
- **`src/pages/dashboard.astro:141-153` is what actually feeds the grid**, not
  `absenceListColumns`. The dashboard runs its own windowed select and passes the rows to
  `<AbsenceGrid client:load absences={absences} …>`. Adding the column to `absence-list.ts` alone
  lights up the export and details views but leaves the grid blank.
- **`bulk.ts:222-233`'s `onConflictDoUpdate.set` is an explicit list.** A new column omitted there
  writes correctly on insert and keeps its **stale value on the overwrite path** — no type error,
  no test failure unless one is written for it. The overwrite path is reachable whenever a drag
  crosses an existing entry.
- **The grid chip cannot take inline content.**
  `context/archive/2026-08-11-grid-adjustment-offsite-training/research.md:480-486` records that
  `overflow:hidden` on a flex item resolves `min-width:auto` to `0` — *a floor, not a cap* — so a
  `whitespace-nowrap` inline label contributes its full width and **widens the 120px column
  instead of clipping**. That bug is what the offsite-training change existed to fix.
- **The chip is `role="img"`,** which makes its children presentational. `chipLabel`
  (`AbsenceGrid.tsx:401-413`) is the only thing a screen reader gets; a marker not named there
  does not exist for assistive technology.
- **The export writes no emoji today.** Cells carry text plus a fill colour; `type.icon` is never
  read. Non-ASCII *text* is proven fine (Polish month names, `"cały dzień"`, a codepoint-pinned
  U+2013). Literal ASCII `[P]` is the low-risk choice.
- **Correctness must live in `src/lib/` to be testable.** vitest runs `environment: "node"`;
  React islands have no test seam.
- **`AbsenceBulkCreateCommand` (`src/types.ts:27-42`) is hand-written** and used with `satisfies`
  at `AbsenceFormDialog.tsx:395` — it becomes a compile error the moment the client sends the new
  field. `Absence` / `AbsenceInsert` / `AbsenceUpdate` are `$infer`-derived and pick the column up
  for free.

## What We're NOT Doing

- **No collision resolution.** The flag is informational. `UNIQUE (employee_id, date)` already
  makes per-person collisions impossible; what "kolizja terminów" means across employees stays
  undefined, deliberately.
- **No effect on the holiday balance or statistics.** `src/lib/services/holiday-balance.ts` and
  `src/pages/api/absences/stats.ts` are untouched. (`stats.ts` reads through `absenceListColumns`,
  so it *receives* the field; nothing aggregates on it.)
- **No DB-level CHECK tying `is_priority` to `absence_type_id`.** SQLite cannot add one via
  `ALTER`, and the precedent is explicit — `hours-onsite-training-only/plan.md`, *What We're NOT
  Doing*: "No DB CHECK constraint tying `absence_type_id` to `is_full_day`." Enforcement is
  application-layer.
- **No new role guard.** Anyone who can already edit the absence can set the flag.
- **No sortable "Priorytet" column** in `AbsenceDetailsTable`. That would touch `SortColumn:19`,
  `GRID_TEMPLATE:23`, `SORT_COLUMNS:25-32` and the `sorted` switch `:94-128` — a larger change
  than the flag itself, for a flag scoped as informational. An inline pill only.
- **No `code`/`slug` column on `absence_types`.** Proposed and declined three times; see *Known
  debt* below.
- **No `🅿️` emoji.** See *Naming and marker decisions*.
- **No shadcn `Checkbox` install.** Clone the existing native input; see Phase 3.
- **No new E2E spec.** `npm run e2e` still targets the deployed Workers app and writes to the
  production database (`AGENTS.md`), so a new spec is not a cheap addition. Grid and export are
  verified by eye.

## Implementation Approach

The change is wide but shallow. Every piece has an in-repo template, so the risk is **coverage**
— missing one of the six column lists, or the bulk overwrite trap — not novel design. The plan
therefore front-loads the mechanical surface (Phase 1–2) so the column round-trips end-to-end and
is enforced everywhere before any pixel is touched, then does the three presentation surfaces in
dependency order (form → grid/details → export), and closes with the document amendment.

### Naming and marker decisions

Two visible choices, decided here rather than left open:

**Column name: `is_priority`.** Every archived artifact says `absences.priority`. The table's
other boolean is `is_full_day` and `employees.is_system` follows the same prefix, so `is_priority`
is the consistent choice; the archived name was written before any of those existed as a settled
convention. Consistency inside the table wins over fidelity to a parked spec.

**Marker: literal ASCII `[P]`, not `🅿️`.** The request says `[P]`. Two independent pieces of
evidence agree: `grid-adjustment-offsite-training` spent an entire migration replacing an
8-codepoint ZWJ emoji because glyph decomposition became a correctness issue, and nothing has
ever round-tripped an emoji through `hucre` into Excel. `[P]` is the same three characters in
every surface, which also means the grid legend and the XLSX legend read identically.

### Known debt this change enlarges

`urlop-planowany-category` established that absence types are pure data — adding an eighth type is
a seed row with zero code change. A name-keyed rule is the sanctioned exception, and this makes it
the **third** (partial-day gate, holiday-balance exclusion, priority). The `huge-ui-ux-improvement`
research called `absence_types.name` *"dangerously overloaded"* and proposed a `code`/`slug`
column; it has been proposed and declined three times. Not this change's job to fix — but the
reverse failure mode is now more likely: an eighth type that *ought* to be priority-eligible
would silently not be, because nothing forces `absence-types.ts` to be revisited when the
catalogue grows. The doc comment added in Phase 1 is the only mitigation in scope.

## Critical Implementation Details

**Migration path is not assumable.** A defaulted boolean *should* make drizzle-kit emit a plain
`ALTER TABLE absences ADD ...`, leaving `absences_time_check` and
`absences_employee_id_date_unique` intact. If it instead picks the 12-step table-recreate path,
**both are dropped silently** — `meta/0000_snapshot.json` has no `checkConstraints` entry, so
drizzle-kit does not know the CHECK exists and will not reproduce it. The generated diff must be
read by eye before it is committed, and the CHECK hand-restored if the recreate path was taken.
This is the one step in the plan that cannot be verified by a passing test.

**Guard ordering inside each route.** `assertAbsenceTypeExists` (422) → priority guard (400). Its
doc comment at `absence-write-target.ts:180-184` explains why: an unknown id yields an `undefined`
name, and the guard's own fallback treats `undefined` as ineligible, so reversing the order
reports the wrong problem with the wrong status.

**PATCH judges effective values, then pins them.** `[id].ts:138-207` captures an `omitted` map
*before* the hours clamp mutates `parsed.data`, resolves `effective* = body ?? existing`, runs the
guard on those, then adds a CAS condition to the UPDATE's `WHERE` for every field the body omitted
— so a concurrent write that moves one of them matches zero rows (409) instead of landing on stale
premises. `is_priority` must join all three: the `omitted` map, the effective resolution, and the
CAS pins. Skipping the CAS pin leaves the exact race the block exists to close: another PATCH
flips the type to `choroba` after this handler reads it, and this UPDATE then writes
`is_priority = true` onto it.

**`selectType` is the single mutation point in the form.** `AbsenceFormDialog.tsx:254-265` is
passed to `useRovingRadioGroup` (`:338-342`) *and* wired to `onClick` (`:555-557`) specifically so
arrow-key selection cannot bypass the reset. The priority reset must go inside that function, not
in the click handler.

## Phase 1: Foundation — column, migration, rule module

### Overview

Add the column and the migration, extend the hand-written DTO, and create the name-keyed rule pair
plus its DB-aware server twin. Nothing in this phase is reachable from an HTTP route yet.

### Changes Required

#### 1. Schema column

**File**: `src/db/schema.ts`

**Intent**: Add the priority column to the `absences` table, next to the other domain booleans.
A short comment states that it is informational only and that eligibility is enforced in
application code, not by a DB constraint — matching how `is_full_day`'s CHECK note is written
directly above.

**Contract**: `is_priority: integer("is_priority", { mode: "boolean" }).notNull().default(false)`
on `absences`. `NOT NULL DEFAULT false` so existing rows need no backfill and every read path can
treat it as a plain boolean.

#### 2. Migration

**File**: `drizzle/0001_*.sql` (generated), `drizzle/meta/`

**Intent**: Generate the migration with `npm run db:generate` and **review the diff by eye**
before committing. Confirm it is a plain `ALTER TABLE absences ADD ...`. If drizzle-kit chose the
table-recreate path instead, hand-restore `absences_time_check` and the
`(employee_id, date)` unique index into the regenerated `CREATE TABLE`, exactly as
`drizzle/0000_baseline.sql:1-16` instructs.

**Contract**: `drizzle/meta/_journal.json` gains an `idx: 1` entry. `migrateAndSeed`
(`src/db/migrate.ts:20-46`) applies it at boot; `scripts/build-artifact.mjs` already copies
`drizzle/` into `dist/`, so nothing in the build needs changing.

#### 3. Hand-written bulk DTO

**File**: `src/types.ts`

**Intent**: Add the field to `AbsenceBulkCreateCommand`. `Absence`, `AbsenceInsert` and
`AbsenceUpdate` are `$infer`-derived and need no edit.

**Contract**: `is_priority: boolean;` on `AbsenceBulkCreateCommand` (`:27-42`). This is what makes
`AbsenceFormDialog.tsx:395`'s `satisfies` a compile error until Phase 3 sends the field — a
deliberate ordering signal, not a bug.

#### 4. The name-keyed rule

**File**: `src/lib/absence-types.ts`

**Intent**: Add the third name-keyed rule alongside the partial-day pair, in the same shape and
with the same dependency-free constraint (this module is imported by React islands *and* server
routes). The two type names come verbatim from `src/db/seed.ts:19,31`. Extend the module header to
note that the file now carries two independent rules and that a rename of either seed row must be
mirrored here.

**Contract**: two exported name constants, plus
`export const PRIORITY_TYPE_NAMES: readonly string[]` and
`export function typeAllowsPriority(typeName: string | null | undefined): boolean` — signature
identical to `typeAllowsPartialDay` at `:14`. The names are `"urlop"` and `"urlop planowany"`.

#### 5. The server guard

**File**: `src/lib/services/absence-priority.ts` (new)

**Intent**: Clone `absence-partial-day.ts` as the DB-aware twin: resolve the type name by id and
decide whether the combination is a violation. Keeping it here rather than in `absence-types.ts`
is what lets that module stay importable from React. The doc comment must state the
short-circuit, the `undefined`-name fallback, and that callers pass *effective* values (matching
`absence-partial-day.ts:9-19`).

**Contract**:
`export async function isPriorityViolation(db: Db, absenceTypeId: number, isPriority: boolean): Promise<boolean>`
— returns `false` immediately when `isPriority` is false (an unflagged absence of any type is
always allowed); otherwise resolves the name and returns `!typeAllowsPriority(name)`. A
nonexistent id resolves to `undefined` → ineligible → violation.

#### 6. Unit tests for the rule

**File**: `src/tests/api/absences/crud.test.ts` (extend) or a new `src/tests/lib/absence-types.test.ts`

**Intent**: Cover `typeAllowsPriority` directly (both eligible names, a sample of ineligible ones,
`null`/`undefined`) and `isPriorityViolation` as a service against a real seeded DB. Resolve type
ids **by name**, never hard-coded — `partial-day-guard.test.ts:36-40` is the idiom, and its failure
message ("constant drifted from the seed migration?") is the pattern to copy so a seed rename
fails loudly here rather than silently disabling the feature.

**Contract**: assertions that `isPriorityViolation(db, <urlop id>, true) === false`,
`isPriorityViolation(db, <choroba id>, true) === true`, and
`isPriorityViolation(db, <choroba id>, false) === false`.

### Success Criteria

#### Automated Verification

- `npm run db:generate` produces exactly one new migration and `git diff` on `drizzle/` shows no
  dropped CHECK or unique index
- Unit tests pass: `npm run test`
- Type checking and linting pass: `npm run lint`

#### Manual Verification

- The generated `drizzle/0001_*.sql` was read line by line and is a plain `ALTER TABLE … ADD`; if
  not, `absences_time_check` and `absences_employee_id_date_unique` were hand-restored
- A fresh `npm run db:bootstrap` against an empty file produces a schema whose `absences` table
  still carries `absences_time_check` (verify with `.schema absences` in `sqlite3`)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 2: API — three write routes and all six column lists

### Overview

Wire the field through every write and read path, and enforce the rule at every entry point. This
is the phase where the repo's recurring failure mode lives: six hand-maintained column lists,
none type-checked against each other.

### Changes Required

#### 1. POST /api/absences

**File**: `src/pages/api/absences/index.ts`

**Intent**: Add the field to `AbsenceCreateSchema` (the schema *is* the write whitelist — the
parsed body is spread into `.values()` at `:230`, so nothing else is needed for the insert), add
the guard after `assertAbsenceTypeExists`, and add the column to the `.returning()` block.

**Contract**: `is_priority: z.boolean().optional().default(false)` in the schema at `:113-136`;
the guard block mirrors `:203-211` exactly — DB error → 503 via `reportError`, violation → 400
with `Priorytet jest dostępny tylko dla typów: ${PRIORITY_TYPE_NAMES.join(", ")}`; and
`is_priority: absences.is_priority` in `.returning()` at `:231-243`.

#### 2. PATCH /api/absences/:id

**File**: `src/pages/api/absences/[id].ts`

**Intent**: Add the field to the partial update schema, and thread it through all four places the
partial-day rule is threaded: the `omitted` map, the effective-value resolution, the guard call,
and the CAS pins. Then add it to `.returning()`.

**Contract**: `is_priority: z.boolean()` in `AbsenceUpdateSchema` (`:22-31`, `.partial()` at
`:32` makes it optional); `omitted.is_priority` at `:144-149`;
`const effectiveIsPriority = parsed.data.is_priority ?? existing.is_priority` at `:151-154`;
a guard call on `(effectiveTypeId, effectiveIsPriority)` placed immediately after the existing
partial-day guard, same 503/400 shape; `omitted.is_priority ? eq(absences.is_priority, existing.is_priority) : undefined`
in `casConditions` at `:199-207`; and `is_priority: absences.is_priority` in `.returning()` at
`:219-231`.

#### 3. POST /api/absences/bulk — including the overwrite trap

**File**: `src/pages/api/absences/bulk.ts`

**Intent**: Add the field to the schema, to `RETURNED_COLUMNS`, to the guard chain, **and to
`onConflictDoUpdate.set`**. The last one is the silent failure: the field would write correctly on
insert and keep its stale value on every overwritten day.

**Contract**: `is_priority: z.boolean()` in `AbsenceBulkCreateSchema` at `:43-78`;
`is_priority: absences.is_priority` in `RETURNED_COLUMNS` at `:80-92`;
`is_priority: sharedFields.is_priority` added to the `set` object at `:222-233`; guard call
placed to match the other two routes.

#### 4. Shared list columns

**File**: `src/lib/absence-list.ts`

**Intent**: Add the column to `absenceListColumns`, the row shape `GET /api/absences` and
`GET /api/absences/stats` both return. This is what feeds the XLSX export
(`AbsenceExportDialog.tsx:55`) and the details views.

**Contract**: `is_priority: absences.is_priority` in `absenceListColumns` (`:24-36`).

#### 5. The select that actually feeds the grid

**File**: `src/pages/dashboard.astro`

**Intent**: Add the column to the inline windowed select. This is separate from
`absenceListColumns` despite that module's "the row shape both list routes return" comment — the
grid is server-rendered from this select, not from a fetch. Omitting this leaves the grid blank
regardless of everything else in this phase.

**Contract**: `is_priority: absencesTable.is_priority` in the select object at `:141-153`.

#### 6. Route tests

**File**: `src/tests/api/absences/priority-guard.test.ts` (new), plus edits to
`src/tests/api/absences/bulk.test.ts`

**Intent**: Clone `partial-day-guard.test.ts` — its header explains why it is a separate file
from `crud.test.ts`: it fails if a route stops *calling* the guard, even when the service still
works. Cover the rejection on POST, PATCH and bulk, and assert no row was written. Add a
**bulk-overwrite test** that inserts a flagged day, then bulk-writes over it unflagged, and asserts
the stored row is unflagged — the test that fails today if `onConflictDoUpdate.set` is missed. Add
a PATCH test for the decided semantics: a body carrying only an ineligible `absence_type_id` on a
flagged row is **rejected with 400**, not silently cleared.

**Contract**: the bar set by `absence-write-hardening` — every rejection path is covered by a test
that fails when its guard is removed. Type ids resolved by name.

### Success Criteria

#### Automated Verification

- Unit and route tests pass: `npm run test`
- The new guard tests fail when the guard call is deleted from each of the three routes (verify by
  temporarily removing one, then restoring)
- The bulk-overwrite test fails when `is_priority` is removed from `onConflictDoUpdate.set`
- Type checking and linting pass: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification

- `curl` POST with `is_priority: true` and an ineligible type returns 400 with the Polish message
  naming both eligible types
- `curl` POST with an unknown `absence_type_id` and `is_priority: true` returns **422**, not 400 —
  confirming `assertAbsenceTypeExists` still runs first
- `GET /api/absences?year=…` returns `is_priority` on every row

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 3: Form dialog

### Overview

Add the checkbox to `AbsenceFormDialog`, gated on type, following the three-part precedent the
partial-day control already establishes: defensive mount seeding, an unmounted render gate, and a
reset inside the single selection mutation point.

### Changes Required

#### 1. The gated checkbox

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Mirror the `canBePartialDay` control end to end. Four edits:

1. **Mount-time defensive seeding** (`:166-179`) — compute `existingAllowsPriority` the same way
   `existingAllowsPartialDay` is computed, and seed `isPriority` from the stored row only when the
   stored type is eligible, "so the form can never resubmit a combination the API rejects."
2. **Derived gate** (`:230-231`) — `const canBePriority = typeAllowsPriority(selectedType?.name)`
   alongside `canBePartialDay`.
3. **Reset on type switch** (`:254-265`) — inside `selectType`, add
   `if (!typeAllowsPriority(type.name)) setIsPriority(false);`. It must be in this function, not
   in `onClick`: `selectType` is also passed to `useRovingRadioGroup` (`:338-342`), which is what
   stops arrow-key selection bypassing the reset.
4. **Render gate + markup** — a `{canBePriority && (…)}` block. **Unmount, do not hide** (contrast
   `:537`, where `hidden` is used deliberately to preserve roving tab indices): out of the
   accessibility tree and out of the tab order when ineligible.

**Contract**: the checkbox markup is a **verbatim clone of the "Cały dzień" input at `:584-604`**
with `id="is-priority"` and label `Priorytet` — a native `<input type="checkbox">` with the
`accent-primary focus-visible:ring-ring/50 h-4 w-4 cursor-pointer rounded-[4px] focus-visible:ring-[3px] focus-visible:outline-none`
class string, paired with `<Label htmlFor="is-priority">`. Do **not** run `npx shadcn add checkbox`:
the comment at `:596-599` records that the native control is deliberate, because the E2E suite
drives it with `check()`/`uncheck()` and `accent-color` paints the tick navy. The `<Label htmlFor>`
pairing is what makes `getByRole("checkbox", { name: "Priorytet" })` work.

Placement: after the type picker and after the `canBePartialDay` block, so the two conditional
controls read as a group and neither can appear for the same type.

#### 2. Submit payload

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Add the field to the one `sharedFields` object that feeds all three submit arms (bulk,
edit, create). Send `false` rather than the raw state when the current type is ineligible, so a
stale `true` can never leave the client even if a future edit reorders the reset.

**Contract**: `is_priority: canBePriority && isPriority` in `sharedFields` (`:376-383`). This
resolves the `satisfies AbsenceBulkCreateCommand` compile error introduced in Phase 1.

#### 3. Dialog description

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: The `DialogDescription` at `:485-487` currently names the type and the hours rule.
Extend it with one clause covering the new control, since commit `80052f5` established that every
dialog's description describes what the dialog actually does.

**Contract**: one added clause in the existing sentence, mentioning that leave types may be marked
as priority.

### Success Criteria

#### Automated Verification

- Type checking and linting pass: `npm run lint` (the `satisfies AbsenceBulkCreateCommand` error
  from Phase 1 is now resolved)
- Existing tests still pass: `npm run test`
- Production build succeeds: `npm run build`

#### Manual Verification

- Selecting `urlop` or `urlop planowany` shows the "Priorytet" checkbox; every other type hides it
- Checking Priorytet, then switching to `choroba` with the **keyboard arrow keys**, then switching
  back to `urlop` — the checkbox is unchecked (the reset ran on the roving path, not just on click)
- Opening an existing flagged `urlop` for edit shows the checkbox already checked
- The checkbox is absent from the tab order entirely when an ineligible type is selected
- Saving from all three call sites persists the flag: single-day create (`AbsenceGrid.tsx:551`),
  drag-range create (`:566`), and edit from the details subcards (`AbsenceDetailsSubcards.tsx:349`)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 4: Grid chip, tooltip, legend, and details view

### Overview

Surface the marker everywhere a moderator reads absences on screen. The grid chip is the
constrained surface; the other three are straightforward.

### Changes Required

#### 1. The chip marker

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Render `[P]` in the chip's right-hand corner, grouped with the comment marker when
both are present — the prototype's own answer (`huge-ui-ux-improvement/research.md:69`). Restructure
the two current right-side children into one absolutely-positioned cluster rather than adding a
third independent anchor.

**Contract**: replace the standalone `{absence.comment && (<span className="absolute top-1/2 right-1 …">💬</span>)}`
at `:518-520` with a single `absolute top-1/2 right-1 -translate-y-1/2` flex container holding
`[P]` (when `absence.is_priority`) and `💬` (when `absence.comment`), rendered only when at least
one applies. The `[P]` span styles after the substitute badge's pill
(`text-primary … rounded-full bg-white/75 px-[5px] py-px text-[9px] leading-[1.4] font-bold`) so
it is legible against any type colour.

**The layout constraint is absolute, not stylistic.** The marker must live inside the
absolutely-positioned cluster. An inline flex child would contribute its full width to the chip's
intrinsic size — `overflow:hidden` resolves `min-width:auto` to `0`, which is a *floor, not a cap*
— and widen the 120px `table-fixed` column instead of clipping. That is precisely the bug
`grid-adjustment-offsite-training` existed to fix
(`research.md:480-486`). The left anchor at `left-1` stays reserved for substitute initials.

#### 2. Screen-reader label

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: The chip is `role="img"`, so its children are presentational and `chipLabel` is the
only thing assistive technology receives. Add a priority term. The impl-review of
`grid-adjustment-offsite-training` (recorded in its `change.md`, finding F2) applied exactly this
fix to the other two badges.

**Contract**: `absence.is_priority ? "priorytet" : ""` added to the `chipLabel` array at
`:401-413`, before the `"komentarz"` term so the reading order matches the visual cluster. The
array is already `.filter(Boolean).join(", ")`.

#### 3. Tooltip line

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: `buildTooltip` (`:196-219`) is the sighted equivalent of `chipLabel` and lists
`Pracownik` / `Data` / `Typ` / `Godziny` / `Komentarz` / `Zastępstwo`. Add a priority line. The
prototype has one (`new-design/10xUrlopy.dc.html:812`).

**Contract**: `if (absence.is_priority) lines.push("Priorytet: tak");` — pushed only when true,
matching how `Komentarz` and `Zastępstwo` are conditional rather than always-present.

#### 4. Grid legend

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: `[P]` is meaningless without a key. Add an entry to the inline legend after the
`absenceTypes.map` — there is no separate legend component.

**Contract**: a pill in the `flex flex-wrap items-center gap-2` container at `:299-313`, after the
type map, reading `[P] = priorytetowy`, styled to match the neighbouring
`border-line-strong … rounded-full border bg-white px-3 py-1.5 text-xs` pills. It sits inside the
existing `absenceTypes.length > 0` gate at `:297`, which is correct — an empty catalogue means an
empty grid.

#### 5. Details view pill

**File**: `src/components/absence/AbsenceDetailsTable.tsx`

**Intent**: Add a `[P]` pill to the existing type-chip stack, so the one screen that lists every
absence field does not silently omit this one. `AbsenceDetailsSubcards.tsx` needs no edit — it
delegates every row to this component (`:68-80`).

**Contract**: an inline pill inside the `flex flex-col items-start gap-[5px]` stack at `:229-242`,
rendered when `absence.is_priority`. The stack is a flex *column*, so this costs no layout change
and no new grid column. Style after the local `RoleBadge` precedent at
`EmployeeManagementSheet.tsx:25-37` (`rounded-full px-2.5 py-0.5 text-[11px] font-bold`) — there is
no shared `Badge` component in the repo.

### Success Criteria

#### Automated Verification

- Type checking and linting pass: `npm run lint`
- Existing tests still pass: `npm run test`
- Production build succeeds: `npm run build`

#### Manual Verification

- A flagged absence shows `[P]` in the chip's right corner; a flagged absence **with a comment**
  shows `[P]` and `💬` together, both legible, neither clipped
- **Column width is unchanged.** Compare a month with flagged absences against one without — the
  grid must still be 120px per column with no horizontal growth. This is the specific regression
  the layout constraint guards against
- A flagged absence with a substitute shows the left-hand `🔁` badge undisturbed
- Hovering a flagged cell shows the `Priorytet: tak` tooltip line
- The legend shows `[P] = priorytetowy`
- The details view shows the `[P]` pill next to the type chip
- A screen reader (or inspecting `aria-label` in devtools) announces "priorytet" as part of the
  chip label

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 5: XLSX export

### Overview

Carry the marker into the exported workbook: cell text, hover note, and legend row. All three
rules go in the pure `export-workbook.ts` model, which is where every content rule lives and the
only layer vitest can reach.

### Changes Required

#### 1. Cell text

**File**: `src/lib/export-workbook.ts`

**Intent**: Prefix `[P] ` to the cell text for a flagged absence. This reverses an explicit
archived decision — `export-grid-to-xlsx/plan.md:47`: *"No emoji or type name in the cell. Type
identity is carried by fill colour, decoded via the legend."* Deviation D2 of that same change
(`plan.md:495-499`) already put text in cells against the original spec, so the mechanism is
precedented; what is new is a *marker* rather than data. Note the reversal in a comment.

**Contract**: at the cell rule `:244-257`, the `text` field becomes the existing
`timeText` / `timeText\ncomment` composition with a `[P] ` prefix when `absence.is_priority`. The
prefix goes on the **first** line, before `timeText`, so it survives the `\n` split into a wrapped
second line. Nothing else in the cell object changes — `fill`, `textColor`, `border` and the
`wrap: absence.comment ? true : undefined` rule are untouched.

Do **not** reach for `hucre`'s `richText` or per-run fonts from this module: the model layer is
writer-agnostic by design, and a bold `[P]` run would require a new `ExportCell` field mapped in
`toCell` following the `border`/`wrap` pattern. Plain text is in scope; styled text is not.

#### 2. Hover note

**File**: `src/lib/export-workbook.ts`

**Intent**: Add a `Priorytet` line to `absenceNote()`, reversing
`export-grid-to-xlsx/plan.md:536`'s "omit the priority line". The note is the sighted analogue of
the grid tooltip and already lists `Typ` / `Godziny` / `Komentarz` / `Zastępstwo`; omitting
priority would read as an oversight.

**Contract**: `absenceNote()` (`:150-160`) takes `is_priority` in its `Pick<Absence, …>` input
type and pushes `Priorytet: tak` when true — conditional, matching how `Komentarz` and `Zastępstwo`
are pushed. The call site at `:257` passes the whole `absence`, so no argument change is needed.

#### 3. Legend cell

**File**: `src/lib/export-workbook.ts`

**Intent**: Add a `[P] = priorytetowy` cell to the legend row so a reader who never sees the grid
can decode the marker. `FREEZE_ROWS = 0` (`:26`), so an extra cell in row 2 costs no vertical
budget.

**Contract**: one `ExportCell` appended after the `absenceTypes.map` in the row-2 push at
`:192-203`, with `border: true` and `wrap: true` to match its neighbours but **no `fill`** — it
describes a marker, not a type colour.

#### 4. Export tests

**File**: `src/tests/lib/export-workbook.test.ts`

**Intent**: Add `is_priority: false` to the `absence()` fixture factory, add cases asserting the
`[P] ` prefix and the note line for a flagged absence (including the flagged-plus-comment
composition, where the prefix and the wrapped second line interact), and **deliberately update the
legend length assertion**.

**Contract**: the fixture at `:54-65` gains the field; `expect(legend).toHaveLength(types.length)`
at `:268-279` becomes `types.length + 1`, with the added cell asserted by content so the change is
recorded as intentional rather than a loosened bound.

### Success Criteria

#### Automated Verification

- Export tests pass, including the new priority cases: `npm run test`
- The updated legend assertion asserts the new cell's content, not just a longer array
- Type checking and linting pass: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification

- `npm run sample:xlsx` produces a workbook; opening it shows `[P] cały dzień` in flagged cells
  with the fill colour intact
- A flagged absence **with a comment** wraps correctly: `[P] cały dzień` on line one, the comment
  on line two
- Hovering a flagged cell in Excel/LibreOffice shows the `Priorytet: tak` note line
- Row 2 of each month sheet shows the `[P] = priorytetowy` legend cell after the seven type cells
- Exporting from the running app via the moderator's export dialog produces the same result as the
  sample script

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 6: PRD and roadmap amendment

### Overview

De-park FR-008. Building this feature makes two foundation documents factually wrong, and the
repo's precedent is that changing a PRD-pinned fact requires an explicit amendment rather than a
silent drift. Leaving them stale is what got this item re-litigated three times.

### Changes Required

#### 1. PRD

**File**: `context/foundation/prd.md`

**Intent**: FR-008 at `:89-90` currently reads as a nice-to-have non-goal. Move it to delivered
and record the scope boundary that made it shippable: the flag is **informational only**, with no
collision-resolution behaviour, no balance effect and no statistics effect.

**Contract**: the FR-008 entry moves out of the non-goals framing; the priority-marker requirement
is stated with its informational-only qualifier and a pointer to this change id.

#### 2. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: The parked entry at `:444` cites "PRD §Non-Goals: nice-to-have, poza głównym MVP flow"
as the reason. Unpark it and record the delivering change.

**Contract**: the entry is marked delivered, referencing `context/changes/priority-absence-flag/`.

### Success Criteria

#### Automated Verification

- Formatting passes: `npm run format` leaves both files unchanged (or its output is committed)
- Linting passes: `npm run lint`

#### Manual Verification

- `prd.md` no longer lists a shipped feature as a non-goal, and the informational-only scope is
  stated in prose a future planner will read before proposing collision logic
- `roadmap.md:444`'s parked entry names this change

---

## Testing Strategy

### Unit Tests

- `typeAllowsPriority` — both eligible names, a sample of ineligible ones, `null` and `undefined`
- `isPriorityViolation` — eligible + flagged (allowed), ineligible + flagged (violation),
  ineligible + unflagged (allowed), unknown type id (violation)
- Type ids resolved by name with a failure message naming seed drift, per
  `partial-day-guard.test.ts:36-40`
- `export-workbook` — cell text prefix, prefix + comment wrapping, note line, legend cell

### Integration Tests

- `priority-guard.test.ts` — the rejection contract on POST, PATCH and bulk; each test must fail
  when its route's guard call is deleted
- PATCH judging *effective* values: a body carrying only an ineligible `absence_type_id` on a
  flagged row is rejected 400
- Guard ordering: unknown type id + flag returns 422, not 400
- **Bulk overwrite**: insert a flagged day, bulk-write over it unflagged, assert the stored row is
  unflagged — the test that catches a missed `onConflictDoUpdate.set` entry
- Round-trip: `GET /api/absences?year=…` returns `is_priority` on every row

### Manual Testing Steps

1. Open the dialog on an empty cell, pick `urlop` → the Priorytet checkbox appears
2. Arrow-key across to `choroba` and back to `urlop` → the checkbox is unchecked
3. Save a flagged `urlop`; confirm `[P]` in the grid chip and the tooltip line
4. Add a comment to the same absence; confirm `[P]` and `💬` coexist and the column has not widened
5. Drag a range across an existing flagged day with the flag off; confirm the stored day is
   unflagged after reload (the overwrite path)
6. Open the details view; confirm the `[P]` pill
7. Export the year; confirm cell prefix, note line and legend cell in the opened workbook
8. Attempt a `curl` PATCH changing only the type to `choroba` on a flagged row; confirm 400

## Performance Considerations

None. The column is a single defaulted boolean on an existing table with no new index, no new
query, and no new round trip — the guard reuses the same one-row `absence_types` lookup shape the
partial-day guard already performs per write. The grid renders one extra conditional span per
flagged cell.

## Migration Notes

`drizzle/0001_*.sql` is applied at boot by `migrateAndSeed` (`src/db/migrate.ts:20-46`) in one
transaction, so an upgrade needs no manual step beyond the normal `install.sh` run. `NOT NULL
DEFAULT false` means existing rows need no backfill.

**Rollback:** a release rollback is a symlink swap and does **not** undo the migration
(`INSTALL.md`). An older release running against a schema that has the extra column is fine —
SQLite ignores unknown columns on read, and every write path in the older code omits it, so the
default applies. No data is lost either direction. Take the pre-upgrade backup anyway, per the
standard procedure.

## References

- Research: `context/changes/priority-absence-flag/research.md`
- The rule template: `src/lib/absence-types.ts:11,14` and `src/lib/services/absence-partial-day.ts:20-30`
- The guard shape and ordering: `src/pages/api/absences/index.ts:203-211`,
  `src/lib/absence-write-target.ts:180-215`
- The test template: `src/tests/api/absences/partial-day-guard.test.ts`
- The bulk trap: `src/pages/api/absences/bulk.ts:222-233`
- The grid layout constraint:
  `context/archive/2026-08-11-grid-adjustment-offsite-training/research.md:480-486`
- The export decisions being reversed: `context/archive/2026-08-24-export-grid-to-xlsx/plan.md:47,536`
- Why FR-008 was parked: `context/archive/2026-08-07-huge-ui-ux-improvement/frame.md:93-98`,
  `plan.md:84,517`
- `context/foundation/lessons.md` — "Repo-wide claims are load-bearing"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation — column, migration, rule module

#### Automated

- [x] 1.1 `npm run db:generate` produces exactly one new migration and `git diff` on `drizzle/` shows no dropped CHECK or unique index — ba0e0ca
- [x] 1.2 Unit tests pass: `npm run test` — ba0e0ca
- [x] 1.3 Type checking and linting pass: `npm run lint` — ba0e0ca

#### Manual

- [x] 1.4 The generated `drizzle/0001_*.sql` was read line by line and is a plain `ALTER TABLE … ADD`; constraints hand-restored if not — ba0e0ca
- [x] 1.5 A fresh `npm run db:bootstrap` produces an `absences` table that still carries `absences_time_check` — ba0e0ca

### Phase 2: API — three write routes and all six column lists

#### Automated

- [x] 2.1 Unit and route tests pass: `npm run test` — d6e16c9
- [x] 2.2 The new guard tests fail when the guard call is deleted from each of the three routes — d6e16c9
- [x] 2.3 The bulk-overwrite test fails when `is_priority` is removed from `onConflictDoUpdate.set` — d6e16c9
- [x] 2.4 Type checking and linting pass: `npm run lint` — d6e16c9
- [x] 2.5 Production build succeeds: `npm run build` — d6e16c9

#### Manual

- [x] 2.6 POST with `is_priority: true` and an ineligible type returns 400 with the Polish message naming both eligible types — d6e16c9
- [x] 2.7 POST with an unknown `absence_type_id` and `is_priority: true` returns 422, not 400 — d6e16c9
- [x] 2.8 `GET /api/absences?year=…` returns `is_priority` on every row — d6e16c9

### Phase 3: Form dialog

#### Automated

- [x] 3.1 Type checking and linting pass: `npm run lint`
- [x] 3.2 Existing tests still pass: `npm run test`
- [x] 3.3 Production build succeeds: `npm run build`

#### Manual

- [x] 3.4 Selecting `urlop` or `urlop planowany` shows the Priorytet checkbox; every other type hides it
- [x] 3.5 Keyboard arrow-key type switching clears the flag (the roving path, not just click)
- [x] 3.6 Opening an existing flagged `urlop` for edit shows the checkbox already checked
- [x] 3.7 The checkbox is absent from the tab order when an ineligible type is selected
- [x] 3.8 The flag persists from all three call sites: single create, drag-range create, details-subcard edit

### Phase 4: Grid chip, tooltip, legend, and details view

#### Automated

- [ ] 4.1 Type checking and linting pass: `npm run lint`
- [ ] 4.2 Existing tests still pass: `npm run test`
- [ ] 4.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 4.4 A flagged absence shows `[P]`; flagged plus commented shows `[P]` and `💬` together, neither clipped
- [ ] 4.5 Column width is unchanged versus a month with no flagged absences
- [ ] 4.6 A flagged absence with a substitute shows the left-hand `🔁` badge undisturbed
- [ ] 4.7 Hovering a flagged cell shows the `Priorytet: tak` tooltip line
- [ ] 4.8 The legend shows `[P] = priorytetowy`
- [ ] 4.9 The details view shows the `[P]` pill next to the type chip
- [ ] 4.10 The chip's `aria-label` includes "priorytet"

### Phase 5: XLSX export

#### Automated

- [ ] 5.1 Export tests pass, including the new priority cases: `npm run test`
- [ ] 5.2 The updated legend assertion asserts the new cell's content, not just a longer array
- [ ] 5.3 Type checking and linting pass: `npm run lint`
- [ ] 5.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 5.5 `npm run sample:xlsx` shows `[P] cały dzień` in flagged cells with the fill colour intact
- [ ] 5.6 A flagged absence with a comment wraps correctly across two lines
- [ ] 5.7 Hovering a flagged cell in Excel/LibreOffice shows the `Priorytet: tak` note line
- [ ] 5.8 Row 2 shows the `[P] = priorytetowy` legend cell after the type cells
- [ ] 5.9 Exporting from the running app matches the sample script's output

### Phase 6: PRD and roadmap amendment

#### Automated

- [ ] 6.1 Formatting passes: `npm run format`
- [ ] 6.2 Linting passes: `npm run lint`

#### Manual

- [ ] 6.3 `prd.md` no longer lists FR-008 as a non-goal and states the informational-only scope
- [ ] 6.4 `roadmap.md:444`'s parked entry names this change
