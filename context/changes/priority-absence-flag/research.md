---
date: 2026-08-31T11:35:46+02:00
researcher: bartorelli-omarchy
git_commit: 09dccd383cec206abec6de6b297e1e575962c378
branch: main
repository: 10x-devs-urlopy
topic: "Priority-absence flag ([P] marker) for urlop and urlop planowany"
tags: [research, codebase, absences, absence-types, drizzle-migration, absence-grid, xlsx-export, fr-008]
status: complete
last_updated: 2026-08-31
last_updated_by: bartorelli-omarchy
permalink_base: https://github.com/oliwabartosz/10x-devs-urlopy/blob/09dccd383cec206abec6de6b297e1e575962c378/
---

# Research: Priority-absence flag ([P] marker) for urlop and urlop planowany

**Date**: 2026-08-31T11:35:46+02:00
**Researcher**: bartorelli-omarchy
**Git Commit**: `09dccd383cec206abec6de6b297e1e575962c378`
**Branch**: `main`
**Repository**: 10x-devs-urlopy

> File references below are local `path:line` (clickable in the editor). `HEAD` is pushed to
> `origin/main`, so any of them can be turned into a permalink by prefixing `permalink_base`
> from the frontmatter and appending `#L<line>`.

## Research Question

> Brakuje opcji do zaznaczenia urlop priorytetowy (+emoji). Powinno być tylko dla urlopu i urlopu
> planowanego. Emoji: [P].

**Scope agreed with the requester before research:**

- **In scope:** core write + read path (schema/migration, POST + PATCH + bulk, form dialog, grid
  cell) **and** the XLSX export.
- **Out of scope:** detailed statistics, holiday-balance effects. The flag is *"just additional
  information"* for moderators, visible on the grid and in the XLSX.
- **Permissions:** anyone who can already edit the absence can set it — no new role guard.

## Summary

Five findings decide the shape of this change.

1. **This is PRD FR-008, and it has been deliberately parked three times.** The column, the
   name-keyed gate, and even the badge were specced in
   `context/archive/2026-08-07-huge-ui-ux-improvement/research.md:183-187`, then explicitly
   rejected for that change: *"Do not port the 🅿️ badge; the column does not exist"*
   (`plan.md:517`). Two later changes cite that rejection as settled. Building it de-parks
   FR-008, which means `context/foundation/prd.md:89-90` and
   `context/foundation/roadmap.md:444` need amending — that is a product decision, not a
   drive-by edit.
2. **The type-gating rule has an exact, twice-proven template.** `typeAllowsPartialDay()` in
   `src/lib/absence-types.ts:14` is a dependency-free name-keyed helper shared by the React
   island and — via `src/lib/services/absence-partial-day.ts:20` — by all three write routes.
   The priority rule is structurally identical and should clone it verbatim: a
   `PRIORITY_TYPE_NAMES` constant + `typeAllowsPriority()` next to the existing pair, plus an
   `isPriorityViolation()` service twin. The request body carries `absence_type_id` (a number),
   never the name, so this **cannot** be a zod `.refine()` — it must be a handler-level guard
   that resolves the name from the DB. That constraint is on record from 2026-06-22.
3. **The absence column list is hand-written in six places, and one of them is a silent trap.**
   `bulk.ts:222-233`'s `onConflictDoUpdate.set` is an explicit list: a new field added to the
   zod schema will write correctly on insert and then **keep its stale value on the overwrite
   path**, with no type error. Verified directly. The five other lists are the shared select
   fragment, three `.returning()` blocks, and — critically — an inline select in
   `dashboard.astro:141-153` that is what actually feeds the grid.
4. **Both of the grid chip's badge anchors are already occupied** — `🔁` + substitute initials at
   `left-1`, `💬` at `right-1`, both vertically centred (`AbsenceGrid.tsx:510-520`). The chip is
   `h-[34px]` in a fixed 120px column with `overflow-hidden`, and the archive records that
   adding *inline* `nowrap` content to it widens the column rather than clipping
   (`grid-adjustment-offsite-training/research.md:480-486`) — the exact bug that change existed
   to fix. A `[P]` marker must be absolutely positioned, and because the chip is `role="img"`,
   it must also be appended to `chipLabel` or it will not exist for screen readers.
5. **The XLSX export builds in the browser and today writes no emoji at all.** Cells carry text
   (`"cały dzień"` or a time range, plus the comment on a wrapped second line) and a fill
   colour; `type.icon` is never read. Literal ASCII `[P]` is therefore the low-risk choice —
   nothing in the `hucre` pipeline has ever round-tripped an emoji into Excel.

**On the "+emoji" in the request:** the prototype uses `🅿️` (U+1F17F U+FE0F) at
`new-design/10xUrlopy.dc.html:125,549,812`, and every archived document calls it that. The
request says `[P]`. The archive gives a strong reason to prefer the literal bracket form — see
Open Question 2.

**Verified absent:** `grep -rniE "priorit|priorytet|is_priority" src/` returns **zero** hits.
There is no priority concept anywhere in the application code today.

## Detailed Findings

### A. Prior art — this is FR-008, parked three times

| Where | What it says |
|---|---|
| `context/foundation/prd.md:89-90` | "FR-008: Pracownik can enter leave plans with a priority marker. Priority: nice-to-have" — listed as a non-goal |
| `context/foundation/roadmap.md:444` | "**FR-008: plan urlopów z oznaczeniem priorytetu** — Why parked: PRD §Non-Goals: nice-to-have, poza głównym MVP flow." |
| `context/archive/2026-08-07-huge-ui-ux-improvement/research.md:183-187` | A near-complete spec: migration `BOOLEAN NOT NULL DEFAULT false`, the field in `AbsenceCreateSchema` and the PATCH partial schema, plus the UI gate — "a **third** name-keyed type rule alongside S-14's partial-day gate and S-15's balance exclusion" |
| `.../huge-ui-ux-improvement/frame.md:93-98` | Why it was cut: it "would put a new column on the live `absences` table inside the same change that can only be eyeballed in production" |
| `.../huge-ui-ux-improvement/plan.md:84,517` | "**The priority flag** (`absences.priority`, 🅿️ badge, modal checkbox). Separate change" / "Do not port the 🅿️ badge; the column does not exist." |
| `context/archive/2026-08-12-grid-multicheck/plan.md:110-111` | Cites the above as settled: "already rejected" |

**The unresolved product question, on record since 2026-08-07**
(`huge-ui-ux-improvement/research.md:183-187`):

> The prototype's copy says *"urlop nadrzędny przy kolizji terminów"* — but nothing in the
> prototype actually resolves a collision. `UNIQUE (employee_id, date)` already makes per-person
> collisions impossible, so the flag is currently **decorative**. What "kolizja terminów" means
> across employees is undefined and is the first thing to nail down.

The requester's scoping answer resolves this: the flag is **informational only**, a marker
moderators read on the grid and in the export. No collision logic. That should be stated
explicitly in the plan — three prior changes stalled on exactly this question.

The prototype's own gate is byte-identical to what was requested
(`new-design/10xUrlopy.dc.html:1470`):

```js
showPriority: draft.type === 'urlop' || draft.type === 'urlop_plan',
```

rendered as a checkbox row at `:545-551` that mirrors the `showAllDay` row directly beneath it —
i.e. the prototype already treats "priority" and "cały dzień" as the same kind of
type-conditional control.

### B. Data layer — schema and migration

`src/db/schema.ts:84-113` defines `absences`. `drizzle/0000_baseline.sql:27-47` is the only
migration on disk (`drizzle/meta/_journal.json` has a single entry, `idx: 0`), and its
`CREATE TABLE` carries a **hand-written** constraint Drizzle cannot express:

```sql
CONSTRAINT `absences_time_check` CHECK (
  (`is_full_day` AND `start_time` IS NULL AND `end_time` IS NULL)
  OR
  (NOT `is_full_day` AND `start_time` IS NOT NULL AND `end_time` IS NOT NULL AND `end_time` > `start_time`)
)
```

`drizzle/meta/0000_snapshot.json`'s `absences` entry has **no `checkConstraints` key** — drizzle-kit
does not know the CHECK exists, which is precisely why a regenerated table definition drops it.

`AGENTS.md` § *Migration discipline*, and the baseline's own header (`drizzle/0000_baseline.sql:1-16`):

> **Always review a generated diff before applying it.** SQLite has no
> `ALTER TABLE ADD CONSTRAINT`, so the DB-level CHECK constraints and the `COLLATE NOCASE` on
> `users.email` must sit inside `CREATE TABLE` and are hand-added. A regenerated table definition
> drops them silently. Re-add after any `db:generate` diff.

**Procedure for column N+1:** edit `src/db/schema.ts` → `npm run db:generate` → review
`drizzle/0001_*.sql` → `meta/` updates itself. A defaulted boolean *should* emit a plain
`ALTER TABLE absences ADD ...`, which leaves `absences_time_check` and the unique index intact.
If drizzle-kit instead picks its 12-step table-recreate path, **both are dropped silently**. This
must be verified by eye on the generated diff — see Open Question 3.

Migrations are applied at boot by `src/db/migrate.ts:20-46` (`migrateAndSeed`), in one
transaction, followed by `seedAbsenceTypes`. `scripts/build-artifact.mjs` copies `drizzle/` into
`dist/`.

**No DB-level CHECK should tie `is_priority` to `absence_type_id`.** SQLite cannot add one via
`ALTER`, and the precedent is explicit — `hours-onsite-training-only/plan.md`, *What We're NOT
Doing*: "No DB CHECK constraint tying `absence_type_id` to `is_full_day`." Enforcement is
application-layer.

**Type flow:** `Absence`, `AbsenceInsert` and `AbsenceUpdate` (`src/types.ts:19-22`) are all
`$inferSelect`/`$inferInsert`-derived and pick the column up for free.
`AbsenceBulkCreateCommand` (`src/types.ts:27-42`) is a **hand-written interface** and must be
edited — it is used with `satisfies` at `AbsenceFormDialog.tsx:395`, so that becomes a compile
error the moment the client sends the field.

### C. The type-gating rule — the precedent to clone

`src/lib/absence-types.ts` (16 lines, dependency-free on purpose):

```ts
export const PARTIAL_DAY_TYPE_NAMES: readonly string[] = [ONSITE_TRAINING_TYPE_NAME, OFFSITE_TRAINING_TYPE_NAME];  // :11
export function typeAllowsPartialDay(typeName: string | null | undefined): boolean {                                // :14
  return typeName != null && PARTIAL_DAY_TYPE_NAMES.includes(typeName);
}
```

Its header states the contract: keyed off exact seed names because `absence_types` has no
code/slug column; single source of truth shared by form (UX) and API (enforcement); *"a rename of
a seed row must be mirrored here"*; dependency-free so both React islands and server routes can
import it.

The two target names, verbatim from `src/db/seed.ts:19` and `:31`:

```ts
{ name: "urlop",           color: "#cceeff", text_color: "#0b5a72", icon: "🌴", display_order: 1 },
{ name: "urlop planowany", color: "#99ccff", text_color: "#0b3f6b", icon: "📅", display_order: 7 },
```

`absence_types.name` is `UNIQUE` on this branch (`src/db/schema.ts:70-72`,
`drizzle/0000_baseline.sql:30`) — added by `sqlite-install` specifically because
`absence-types.ts` gates on exact strings. **This materially de-risks a third name-keyed rule**;
the "a partial rename silently yields two rows" trap recorded at
`grid-adjustment-offsite-training/research.md:154-155` is closed.

**Server twin:** `src/lib/services/absence-partial-day.ts:20-30` —
`isPartialDayViolation(db, absenceTypeId, isFullDay)` resolves the name by id and short-circuits
`if (isFullDay) return false`. Its header explains the split: DB-aware logic lives here so
`@/lib/absence-types` stays dependency-free. This is the module to clone as
`isPriorityViolation(db, absenceTypeId, isPriority)`.

**Rejection shape, identical in all three routes** (e.g. `src/pages/api/absences/index.ts:203-211`):

```ts
let partialDayViolation: boolean;
try {
  partialDayViolation = await isPartialDayViolation(db, absenceData.absence_type_id, absenceData.is_full_day);
} catch (err) {
  reportError(err, { tags: { route: "POST /api/absences" } });
  return json({ error: "Błąd bazy danych." }, 503);
}
if (partialDayViolation) {
  return json({ error: `Godziny są dostępne tylko dla typów: ${PARTIAL_DAY_TYPE_NAMES.join(", ")}` }, 400);
}
```

DB error → 503, rule violation → 400. **Ordering matters:** `assertAbsenceTypeExists`
(`src/lib/absence-write-target.ts:190-215`, 422) must run *first* — its doc comment at `:180-184`
explains that a nonexistent id yields an `undefined` name, which the guard's fallback would
report as the wrong problem.

### D. Write paths — three routes, verified by grep

`grep -rn "insert(absences)|update(absences)|delete(absences)"` over `src/`, `scripts/` and
`*.mjs` (excluding `node_modules`, `dist`, `src/tests`) returns exactly three route files.
`src/pages/api/absences/stats.ts` exports only `GET`; `src/lib/services/holiday-balance.ts:50`
only reads.

**In all three routes the zod schema *is* the whitelist** — the parsed body is spread into the
Drizzle call, so a field added to the schema flows into the write automatically. The explicit
lists are what break.

| Route | Zod schema | Write | Explicit lists to edit |
|---|---|---|---|
| `POST /api/absences` (`index.ts`) | `AbsenceCreateSchema` `:113-136` | `.values({ employee_id, ...absenceData })` `:230` | `.returning({...})` `:231-243` |
| `PATCH /api/absences/:id` (`[id].ts`) | `AbsenceUpdateSchemaRefined` `:34-46` | `.set({ ...parsed.data, updated_at: new Date() })` `:217` | `.returning({...})` `:219-231`, `omitted` map `:144-149`, CAS pins `:199-207` |
| `POST /api/absences/bulk` (`bulk.ts`) | `AbsenceBulkCreateSchema` `:43-78` | `.values(dates.map(...))` `:221` | **`onConflictDoUpdate.set` `:222-233`**, `RETURNED_COLUMNS` `:80-92` |

**⚠ The bulk overwrite trap (verified by reading the file):**

```ts
.onConflictDoUpdate({
  target: [absences.employee_id, absences.date],
  set: {
    absence_type_id: sharedFields.absence_type_id,
    is_full_day:     sharedFields.is_full_day,
    start_time:      sharedFields.start_time,
    end_time:        sharedFields.end_time,
    comment:         sharedFields.comment,
    substitute_employee_id: sharedFields.substitute_employee_id,
    updated_at: new Date(),
  },
})
```

A new column omitted here writes on insert and goes **stale on overwrite** — no type error, no
test failure unless one is written for it. `MAX_BULK_DATES = 31` (`bulk.ts:41`), and the range
flow is create-only, so the overwrite path is reachable whenever a drag crosses an existing entry.

**PATCH is the subtle one.** `[id].ts:151-154` computes *effective* values as `body ?? stored
row`, and the partial-day guard runs against those. The priority guard needs the same treatment,
plus an answer to: a PATCH that changes only `absence_type_id` from `urlop` to `choroba`, leaving
a stored `is_priority = true` untouched — reject, or silently clear? The client already resolves
the analogous case by *clearing* (`AbsenceFormDialog.tsx:260-264`), so the server would only see
it from a hand-rolled request. See Open Question 4.

`absence-write-hardening` set the testing bar for this class of change
(`plan-brief.md`, Success Criteria): *"Every rejection path in `bulk.ts` is covered by a test
that fails when its guard is removed."*

**Not affected:** `src/lib/absence-write-target.ts` and its two assert helpers deal in *identity
references* (employee, substitute, type id), not row payload, and take a narrow explicit object
rather than the body spread. No change needed.

### E. Read paths — six hand-written column lists

| # | Location | Feeds |
|---|---|---|
| 1 | `src/lib/absence-list.ts:24-36` (`absenceListColumns`) | `GET /api/absences` (`index.ts:90`) **and** `GET /api/absences/stats` (`stats.ts:70`) |
| 2 | `src/pages/dashboard.astro:141-153` (inline select) | **the monthly grid** |
| 3 | `src/pages/api/absences/index.ts:231-243` | POST 201 body |
| 4 | `src/pages/api/absences/[id].ts:219-231` | PATCH 200 body |
| 5 | `src/pages/api/absences/bulk.ts:80-92` (`RETURNED_COLUMNS`) | bulk 201 body |
| 6 | `src/lib/export-workbook.ts` read site `:244-257` | XLSX cell content |

The doc comment above `absenceListColumns` reads *"The row shape both list routes return. Kept
identical so consumers parse one contract."* — but **it is not what feeds the grid**. The grid is
server-rendered: `dashboard.astro:140-156` runs its own windowed select
(`gte(date, firstDay) && lt(date, firstDayNextMonth)`) and passes the rows to
`<AbsenceGrid client:load absences={absences} … />` at `:296-304`. Adding the column to
`absence-list.ts` alone would light up the export and the details views but leave the grid blank.

The XLSX export goes through list #1: `AbsenceExportDialog` fetches `GET /api/absences?year=…`
(`AbsenceExportDialog.tsx:55`). So #1 and #2 are both required for the requested scope.

### F. Form dialog — `AbsenceFormDialog.tsx` (820 lines)

Plain `useState`, no react-hook-form, no client-side zod. State is seeded once at mount
(`:172-199`); both call sites force a remount per selection via `key`, which is why there is no
reset `useEffect`. Submit funnels through one `sharedFields` object (`:376-383`) feeding all
three arms — bulk `:388-395`, edit `:398-402`, create `:403-407` — then
`window.location.reload()` on success.

**The gating precedent, in three places, and the answer to "hide or reset?" is both:**

1. **Mount-time defensive seeding** `:166-179` — an existing row whose type is not eligible opens
   as if the flag were off, *"so the form can never resubmit a combination the API rejects."*
2. **Render gate** `:230-231` + `:582` — `{canBePartialDay && (…)}`. The block is **unmounted**,
   not hidden: out of the accessibility tree and out of the tab order. (Contrast `:537`, where
   the form/confirm step uses `hidden` deliberately to preserve roving tab indices.)
3. **Reset on type switch** `:254-265` — the important one:

```ts
// Shared by the click and the keyboard path so arrow-key selection cannot bypass the
// partial-day reset below.
const selectType = (index: number) => {
  const type = absenceTypes[index];
  setAbsenceTypeId(type.id);
  if (!typeAllowsPartialDay(type.name)) {
    setIsFullDay(true);
    setStartTime("");
    setEndTime("");
  }
};
```

`selectType` is the single mutation point — passed to `useRovingRadioGroup` (`:338-342`) *and*
wired to `onClick` (`:555-557`), which is what stops keyboard selection bypassing the reset. A
priority reset belongs in the same `if`.

**The type name is available at selection time** — `selectType` receives the full row and already
reads `type.name`. `absenceTypes: AbsenceType[]` arrives as a prop, server-rendered from
`dashboard.astro:160,186` down through `AbsenceGrid.tsx:35` / `AbsenceDetailsSubcards.tsx:13`.
No fetch.

**No shadcn `Checkbox` or `Switch` is installed.** `src/components/ui/` holds `button, dialog,
input, label, popover, select, sheet, sonner, tooltip` (+ an unused `LibBadge.astro` scaffold).
The existing checkbox is a **native input, and the comment says why** (`:596-599`):

```tsx
// `accent-color` on the native control rather than a Radix Checkbox: it paints
// the tick navy instead of the browser's blue while keeping a real
// `<input type="checkbox">`, which the E2E suite drives with check()/uncheck().
className="accent-primary focus-visible:ring-ring/50 h-4 w-4 cursor-pointer rounded-[4px] focus-visible:ring-[3px] focus-visible:outline-none"
```

Clone that markup with a new `id`; do not run `npx shadcn add checkbox`. Keep the
`<Label htmlFor>` pairing — `tests/e2e/absence-form-dialog.spec.ts:52` locates the existing one
as `getByRole("checkbox", { name: "Cały dzień" })`.

**Three call sites, one component — no duplicate form surface:** `AbsenceGrid.tsx:551`
(single, create+edit), `AbsenceGrid.tsx:566` (range, create-only), and
`AbsenceDetailsSubcards.tsx:349` (single, edit-only). The drag/range flow is the same component
with `mode="range"`, so the checkbox is added once.

**Accessibility:** commit `80052f5` gave every dialog a real `DialogDescription`; this one's is at
`:485-487`. If the checkbox changes what the dialog does, extend that sentence.

### G. Grid rendering — `AbsenceGrid.tsx`

`src/lib/absence-grid-cell.ts` has **no view-model type** — three pure string helpers
(`formatTime :23`, `rawTimeRange :37`, `cellTimeRange :48`) over
`Pick<Absence, "is_full_day" | "start_time" | "end_time">`. `is_priority` needs no change there;
the cell view-model is assembled inline at `AbsenceGrid.tsx:386-419`.

The filled chip, `:492-521` — note both absolute anchors are taken:

```tsx
<div
  role="img"
  aria-label={chipLabel}
  className="relative flex h-full w-full items-center justify-center gap-[5px] overflow-hidden rounded-[7px] px-1.5 text-[11px] font-bold whitespace-nowrap"
  style={{ backgroundColor: absenceType.color, color: absenceType.text_color }}
  title={buildTooltip(emp, date, absenceType, absence)}
>
  {absenceType.icon && <span className="shrink-0 text-[12px] leading-none">{absenceType.icon}</span>}
  {range && <span className="truncate">{range}</span>}
  {substituteInitials && (
    <span className="text-primary absolute top-1/2 left-1 flex -translate-y-1/2 items-center gap-[2px] rounded-full bg-white/75 px-[5px] py-px text-[9px] leading-[1.4] font-bold">
      <span className="text-[8px] leading-none">🔁</span><span>{substituteInitials}</span>
    </span>
  )}
  {absence.comment && (
    <span className="absolute top-1/2 right-1 -translate-y-1/2 text-[10px] leading-none opacity-85">💬</span>
  )}
</div>
```

Cell geometry: `<td>` `:422-491` is `h-[34px] border-r border-b p-[3px]`; columns are pinned at
120px (`table-fixed`, `w-[120px]` headers, `:342-346`, `:62`).

**Two hard constraints:**

- **Layout.** `grid-adjustment-offsite-training/research.md:480-486` records that
  `overflow:hidden` on a flex item resolves `min-width:auto` to 0 — *a floor, not a cap* — so a
  `nowrap` inline label contributes its full width and **widens the column instead of clipping**.
  That bug is what the offsite-training change existed to fix. `[P]` must be an
  absolutely-positioned overlay, not an inline flex child. Free anchors: `top-0 right-0`,
  `bottom-0 left-0`, `bottom-0 right-0`. The prototype's own answer was to stack `🅿️` and `💬`
  together in one right-hand group (`huge-ui-ux-improvement/research.md:69`).
- **Accessibility.** The chip is `role="img"`, so children are presentational. `chipLabel`
  (`:401-413`, currently type name + range + "zastępstwo: …" + "komentarz") is the *only* thing a
  screen reader gets. A `[P]` marker must add a term there. `change.md` impl-review F2 of
  `grid-adjustment-offsite-training` records exactly this fix being applied to the other two
  badges. `buildTooltip` (`:210-218`) is the sighted equivalent and should get a matching line —
  the prototype has one (`10xUrlopy.dc.html:812`: `'Priorytet: ' + (e.priority ? 'tak 🅿️' : 'nie')`).

**Legend.** No separate component — it is inline at `AbsenceGrid.tsx:297-321`, one pill per type
at `:303-312`, gated on `absenceTypes.length > 0` (`:297`). A `[P] = priorytetowy` entry goes in
that `flex flex-wrap items-center gap-2` container at `:299-313`, after the `absenceTypes.map`.

**Details views.** `AbsenceDetailsTable.tsx` renders per-absence fields in a 6-column grid; the
`flex flex-col items-start gap-[5px]` type-chip stack at `:229-242` is the natural home for an
inline pill with no layout change. A *sortable* Priorytet column would be much wider — it touches
`SortColumn :19`, `GRID_TEMPLATE :23`, `SORT_COLUMNS :25-32` and the `sorted` switch `:94-128`.
`AbsenceDetailsSubcards.tsx` renders no absence fields itself; it delegates every row to
`AbsenceDetailsTable` (`:68-80`).

**No `Badge` component exists.** The closest in-repo pill precedent is the local `RoleBadge` at
`src/components/employee/EmployeeManagementSheet.tsx:25-37`
(`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase`). No bracketed-text badge exists
anywhere; the two existing grid markers are emoji.

### H. XLSX export

**There is no export API route — the workbook is built in the browser.**

| Step | File |
|---|---|
| Trigger (moderator-only, `dashboard.astro:242`) | `dashboard.astro:250-255` |
| Dialog: fetch → build → write → download | `AbsenceExportDialog.tsx:42-104` (fetch `:55`, refuses on `X-Result-Truncated` `:64`, dynamic `import("@/lib/export-xlsx")` `:83`) |
| Data | `GET /api/absences?year=…` → `absenceListColumns` |
| Content model (pure, unit-tested) | `src/lib/export-workbook.ts:166-273` |
| hucre adapter (the only module that knows hucre exists) | `src/lib/export-xlsx.ts:35-102` |

The cell rule, `export-workbook.ts:244-257`:

```ts
const timeText = cellTimeRange(absence, type.name) || FULL_DAY_LABEL;
row.push({
  text: absence.comment ? `${timeText}\n${absence.comment}` : timeText,
  fill: type.color,
  textColor: type.text_color,
  border: true,
  wrap: absence.comment ? true : undefined,
  note: absenceNote({ absence, typeName: type.name, substituteName }),
});
```

**No emoji is written to any cell today** — `type.icon` is never read by the export. Type identity
is fill colour only, decoded via a legend row. Non-ASCII *text* is proven fine (Polish month
names, `"cały dzień"`, and U+2013 EN DASH pinned by codepoint in
`export-workbook.test.ts:433-437`).

**The archived design decision this change reverses** (`export-grid-to-xlsx/plan.md:47`):

> **No emoji or type name in the cell.** Type identity is carried by fill colour, decoded via the
> legend. (Icons remain available to a later revision; the catalogue already supplies them.)

That change also recorded, at `plan.md:41`, that the export was designed assuming no priority
concept exists: *"`UNIQUE (employee_id, date)` makes overlap structurally impossible: one cell, at
most one absence. **No split-cell or priority rule to port.**"* — which is convenient here: a cell
never has to choose between two absences' markers.

But Deviation D2 (`plan.md:495-499`) already put text in the cell against the original spec, so
prefixing `[P]` to `text` is mechanically trivial and precedented.

**Where it belongs:** in `buildExportWorkbook`, **not** in `toCell`. The archive is explicit
(`plan.md:~75-80`) — vitest runs `environment: "node"`, React islands are untestable, so every
content rule lives in the pure model and is unit-tested there. Do not reach for hucre-specific
features (`richText`, per-run fonts) from the model layer; if a bold `[P]` run is wanted it needs
a new writer-agnostic `ExportCell` field mapped in `toCell`, following the `border`/`wrap` pattern.

**Legend row.** Not a sheet — row 2 of each of the twelve month sheets (`export-workbook.ts:192-203`,
layout at `:189-219`). `FREEZE_ROWS = 0` (`:26`), so an extra cell costs no vertical budget. Note
`export-workbook.test.ts:268-279` asserts `expect(legend).toHaveLength(types.length)` — adding a
legend cell **breaks that assertion** and it must be updated deliberately.

**`absenceNote()`** (`:150-160`) builds the hover note (`Typ:` / `Godziny:` / `Komentarz:` /
`Zastępstwo:`). `export-grid-to-xlsx/plan.md:536` says "**Omit the priority line**" — an
instruction now due for reversal. Note the archive's own reasoning that a note is invisible until
hovered, so anything that matters on a *printed* sheet must be in the cell text.

### I. Tests

**Harness.** `vitest.config.ts:33` aliases `astro:env/server` → `src/tests/helpers/astro-env.ts`,
which mints `os.tmpdir()/urlopy-vitest/<uuid>.db` — one throwaway DB per test file.
`src/tests/helpers/setup.ts:13-16` closes and removes it (`.db`, `-wal`, `-shm`).
`src/tests/helpers/db.ts:16-19` memoises `migrateAndSeed(...)`, which seeds the real seven-row
catalogue. Fixtures: `src/tests/helpers/fixtures.ts:42-72`. Context:
`src/tests/helpers/http.ts:65-82` (`makeApiContext`).

**Type ids are resolved by name, never hard-coded** — `partial-day-guard.test.ts:36-40` is the
idiom, and its failure message (*"constant drifted from the seed migration?"*) is the pattern to
copy for the priority constants.

| File under `src/tests/api/absences/` | Covers |
|---|---|
| `partial-day-guard.test.ts` | **The template.** Route-level HTTP contract for the name-keyed rule on POST + PATCH, incl. a TOCTOU test that mocks the guard. Its header explains why it is separate from `crud.test.ts`: it fails if a route stops *calling* the guard, even though the service still works |
| `bulk.test.ts` | Weekend rejection, duplicate dates, over-cap, employee vs moderator targeting, `created_dates`/`overwritten_dates` |
| `crud.test.ts` | Direct-Drizzle round-trips, DB CHECK rejection, UNIQUE duplicate, plus `isPartialDayViolation` as a service |
| `error-contract.test.ts` | Status codes at the boundary: 409 / 422 / 400 across all three routes |
| `hours-clamp.test.ts`, `is-system-guard.test.ts`, `stats-scope.test.ts` | Clamp, protected-admin invariant, stats scoping |

`src/tests/lib/export-workbook.test.ts` (532 lines) is the only export test and asserts exact cell
`text`/`fill`/`textColor`/`border`/`wrap`/`note`. Its `absence()` factory at `:54-65` needs
`is_priority: false` added. **`src/lib/export-xlsx.ts` has no test** and no test opens a generated
`.xlsx` — binary verification is manual via `npm run sample:xlsx` (`scripts/export-sample.ts`).

**No visual-regression net exists and none is planned** — snapshot tests were explicitly ruled out
as high-churn (`context/foundation/test-plan.md:98,119,223`). The grid marker is verifiable only
by eye or by a Playwright assertion.

**E2E caveat.** `AGENTS.md`: `npm run e2e` still targets the deployed Workers app, so a run writes
to the **production** database and must clean up after itself. Read `tests/e2e/e2e-rules.md`
first.

## Code References

**Data layer**
- `src/db/schema.ts:84-113` — `absences` table; add the column here
- `src/db/schema.ts:70-72` — `absence_types.name` UNIQUE, the guarantee the name-keyed rule leans on
- `drizzle/0000_baseline.sql:27-47` — `CREATE TABLE absences` incl. hand-written `absences_time_check`
- `drizzle/meta/_journal.json` — single entry `idx: 0`; `db:generate` will emit `0001_*`
- `src/db/seed.ts:19,31` — the two target type names, verbatim
- `src/db/migrate.ts:20-46` — boot-time migrate + seed

**Rule**
- `src/lib/absence-types.ts:11,14` — `PARTIAL_DAY_TYPE_NAMES` / `typeAllowsPartialDay`; add the priority pair here
- `src/lib/services/absence-partial-day.ts:20-30` — the service twin to clone
- `src/lib/absence-write-target.ts:190-215` — `assertAbsenceTypeExists`, must run before the guard

**Write**
- `src/pages/api/absences/index.ts:113-136` (schema), `:203-211` (guard shape), `:230` (values), `:231-243` (returning)
- `src/pages/api/absences/[id].ts:34-46` (schema), `:144-149` (omitted), `:151-154` (effective), `:199-207` (CAS), `:217` (set), `:219-231` (returning)
- `src/pages/api/absences/bulk.ts:41` (`MAX_BULK_DATES = 31`), `:43-78` (schema), `:80-92` (`RETURNED_COLUMNS`), `:221` (values), **`:222-233` (onConflictDoUpdate.set — the trap)**

**Read**
- `src/lib/absence-list.ts:24-36` — `absenceListColumns` (API + export)
- `src/pages/dashboard.astro:141-153` — inline select that feeds the grid
- `src/types.ts:27-42` — `AbsenceBulkCreateCommand`, hand-written

**UI**
- `src/components/absence/AbsenceFormDialog.tsx:166-179` (mount seeding), `:230-231` + `:582` (render gate), `:254-265` (reset on type switch), `:376-383` (sharedFields), `:584-604` (native checkbox markup), `:485-487` (DialogDescription)
- `src/components/absence/AbsenceGrid.tsx:297-321` (legend), `:401-413` (`chipLabel`), `:210-218` (`buildTooltip`), `:492-521` (chip + both taken anchors)
- `src/components/absence/AbsenceDetailsTable.tsx:229-242` — type-chip stack, natural home for an inline pill

**Export**
- `src/lib/export-workbook.ts:192-203` (legend row), `:150-160` (`absenceNote`), `:244-257` (cell rule)
- `src/lib/export-xlsx.ts:35-60` (`toCell`)
- `src/components/absence/AbsenceExportDialog.tsx:42-104`

**Tests**
- `src/tests/api/absences/partial-day-guard.test.ts` — the template, esp. `:36-40` (name→id) and `:87-105` (assert status + body + no row written)
- `src/tests/lib/export-workbook.test.ts:54-65` (fixture factory), `:268-279` (legend length assertion)

**Prototype**
- `new-design/10xUrlopy.dc.html:1470` (`showPriority` gate), `:545-551` (checkbox row), `:125` (grid badge), `:812` (tooltip line)

## Architecture Insights

1. **"Types are data, never a code map" — and this change bends it.** `urlop-planowany-category`
   established that adding an absence type is a pure seed row with zero code change, because
   nothing hardcodes the type list. A name-keyed rule is the sanctioned exception, but it is now
   the **third** one (partial-day gate, holiday-balance exclusion, priority). The
   `huge-ui-ux-improvement` research called `name` *"dangerously overloaded"* and proposed a
   `code`/`slug` column; it has been proposed and declined three times. Not this change's job to
   fix — but worth one line in the plan acknowledging the debt is now larger.
2. **The reverse failure mode is the likely one.** `grid-adjustment-offsite-training/research.md:508-512`
   names it: *"a new type that should allow hours being added without touching
   `absence-types.ts:11` — which is exactly how `urlop planowany` behaves today."* An eighth
   absence type that ought to be priority-eligible would silently not be.
3. **Put both names behind one helper from day one.** `hours-onsite-training-only` shipped
   believing the rule admitted one type, then discovered in manual testing it admitted two —
   *"because both the form and the API guard already went through that one helper, no call site
   changed shape."* The requested rule is two names from the start; the same insulation applies.
4. **A name-keyed rule cannot be a zod refine.** The body carries `absence_type_id`, not the name.
   On record since 2026-06-22: it must be a handler-level guard resolving the name from the DB.
5. **Explicit column lists are the repo's recurring failure surface.** Six of them, all
   hand-maintained, none type-checked against each other. `absence-write-hardening` exists
   because a guard block was copy-pasted between routes; the same shape of bug is available here
   via `onConflictDoUpdate.set`.
6. **Correctness must live in a pure `src/lib/` module to be testable at all.** vitest is
   `environment: "node"`; React islands have no test seam. Every rule that can be wrong — the
   name gate, the export cell text — belongs in `src/lib/` and is unit-tested there.

## Historical Context (from prior changes)

- `context/archive/2026-08-07-huge-ui-ux-improvement/research.md:183-187,218,271` — the original
  spec for this exact column, the "decorative flag / undefined kolizja terminów" objection, and
  the `name`-overloading warning
- `.../huge-ui-ux-improvement/frame.md:93-98`, `plan.md:84,504-517` — why it was carved out, and
  the explicit "do not port the 🅿️ badge"
- `context/archive/2026-08-12-grid-multicheck/plan.md:110-111`, `research.md:144-146` — cites that
  rejection as settled
- `context/archive/2026-06-22-hours-onsite-training-only/plan-brief.md`, `plan.md`, `change.md` —
  the name-keyed-rule decision, its recorded risk, the "cannot be a zod refine" constraint, and
  the two-names-not-one deviation
- `context/archive/2026-06-22-urlop-planowany-category/plan.md`, `plan-brief.md:11-13` — types are
  100% data-driven; adding one is a seed row
- `context/archive/2026-08-11-grid-adjustment-offsite-training/research.md:154-155,206-209,480-486,495-512`,
  `plan.md:49-50` — the missing-slug regret, the cell content contract, the `min-width:auto`
  column-widening trap, the prototype's slug-keyed priority rule
- `context/archive/2026-08-18-absence-write-hardening/plan.md:6-8,30`, `plan-brief.md` — every
  write path must re-assert its invariants; the shared-helper fix for copy-pasted guards; the
  "every rejection path covered by a test that fails when its guard is removed" bar
- `context/archive/2026-08-24-export-grid-to-xlsx/plan.md:41,47,495-499,536`, `plan-brief.md` —
  no emoji/type name in cells (the decision this change scopes an exception to), Deviation D2
  putting text in cells anyway, "omit the priority line" from the note
- `context/archive/2026-08-25-sqlite-install/plan.md:178-180` — added `UNIQUE(name)` to
  `absence_types`, closing the partial-rename trap
- `context/foundation/lessons.md` — "Repo-wide claims are load-bearing": every universal claim in
  this document was produced by running the falsifying search

## Related Research

- `context/archive/2026-08-07-huge-ui-ux-improvement/research.md` — §4.1 is the closest thing to a
  prior research doc for this feature
- `context/archive/2026-08-11-grid-adjustment-offsite-training/research.md` — the definitive
  treatment of name-keyed type rules and grid-cell layout limits
- `context/archive/2026-08-24-export-grid-to-xlsx/research.md` — export architecture and its
  cell-content decisions

## Open Questions

1. **Column name.** Every archived artifact says `absences.priority`; the request implies
   `is_priority`. The table's other boolean is `is_full_day`, and `employees.is_system` follows
   the same `is_` prefix, so `is_priority` is the more consistent choice — but it diverges from
   the archive. Pick one and say why.
2. **`[P]` literal vs `🅿️`.** The request says `[P]`; the prototype and the whole archive say
   `🅿️`. Evidence favours the literal: `grid-adjustment-offsite-training` spent an entire
   migration replacing an 8-codepoint ZWJ emoji because glyph decomposition became a correctness
   issue, and nothing has ever round-tripped an emoji through `hucre` into Excel. Recommendation:
   literal `[P]` in both surfaces. Needs a decision, since it is a visible product choice.
3. **What does `npm run db:generate` actually emit?** A defaulted boolean should produce
   `ALTER TABLE absences ADD …`, leaving `absences_time_check` and
   `absences_employee_id_date_unique` intact. If drizzle-kit picks the table-recreate path, both
   are dropped silently and must be hand-restored. **This must be checked by eye on the generated
   diff — it cannot be assumed.**
4. **PATCH semantics when the type changes away from an eligible one.** A request setting only
   `absence_type_id: <choroba>` on a row with `is_priority = true`: reject with 400, or silently
   clear the flag? The client already clears on type switch, so the server only sees this from a
   hand-rolled request — but the partial-day guard's precedent is to *reject*, and consistency
   argues for the same. Note this also determines whether `is_priority` joins the `omitted` map
   and CAS pins at `[id].ts:144-149,199-207`.
5. **Does the flag belong in the XLSX hover note as well as the cell text?**
   `export-grid-to-xlsx/plan.md:536` said "omit the priority line"; the prototype's tooltip has
   one. The archive's own reasoning (a note is invisible until hovered, so printed-sheet
   information must be in the cell) argues for both.
6. **Legend entries.** Adding `[P] = priorytetowy` to the grid legend
   (`AbsenceGrid.tsx:299-313`) and the XLSX legend row (`export-workbook.ts:192-203`) is cheap
   and consistent — but the XLSX one breaks `export-workbook.test.ts:268-279`. Confirm both are
   wanted.
7. **PRD / roadmap amendment.** Building this de-parks FR-008, currently a non-goal in
   `prd.md:89-90` and parked in `roadmap.md:444`. Precedent is that changing a PRD-pinned fact
   requires an explicit amendment. Confirm the plan should include it.
8. **Details views.** The agreed scope is "grid and xlsx". `AbsenceDetailsTable` shows every other
   absence field; leaving priority out of it is a defensible scope line but will read as an
   omission. Confirm it stays out.
