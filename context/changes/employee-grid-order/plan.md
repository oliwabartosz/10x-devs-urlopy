# Employee Grid Order Implementation Plan

## Overview

Add a `display_order` column to the `employees` table and let moderators drag employee columns in the monthly grid to set a persistent canonical order. Every user (employee or moderator) always sees themselves as the first column; the remaining columns follow `display_order`. The canonical order also applies to the Details and Stats tabs (same `gridEmployees` prop).

## Current State Analysis

- Employees are ordered alphabetically (`last_name ASC, first_name ASC`) in both `dashboard.astro` and `GET /api/employees`.
- No `display_order` column exists on the `employees` table (`src/db/schema.ts:17-25`).
- `AbsenceGrid` renders columns by iterating the `employees` prop array directly — no client-side reordering.
- The `Employee` type is derived via `typeof employees.$inferSelect` (`src/types.ts:4`) — adding `display_order` to the schema propagates the type automatically.
- `empCols` in `dashboard.astro:66-74` is a manual column selection object; `display_order` must be added explicitly.
- `POST /api/employees/index.ts` inserts a new employee without a `display_order` value — the column default (0) would place every new hire at position 0, tied with all others.
- `@dnd-kit` is not installed.
- **Table DnD gotcha**: browsers ignore CSS `transform` on `<th>` elements (table layout context), so `@dnd-kit`'s default sortable `transform` style cannot animate column positions in-place. Correct pattern: don't apply transform to `<th>`; use a `DragOverlay` only. The dragged `<th>` fades to 50% opacity; a floating clone follows the cursor; columns snap to new position on drop.
- `src/pages/api/employees/order.ts` does not exist yet. A new static-segment file `/api/employees/order` will not collide with `[id].ts` — Astro resolves static segments before dynamic ones.

## Desired End State

- `employees.display_order` integer column exists in the DB; all existing rows are seeded with their current alphabetical rank.
- `PATCH /api/employees/order` accepts a full order snapshot `{ order: [{id, display_order}] }` and bulk-updates the column. Moderator-only.
- Grid, Details, and Stats tabs show employees in `display_order` order (active first, inactive floated to end).
- Every user sees themselves as column 0; the rest follows canonical order.
- Moderator sees drag handles (≡) on all non-self columns. Dragging active columns reorders active employees; dragging inactive columns reorders inactive employees. Cross-group drops are rejected.
- On successful drop, order is persisted immediately (optimistic update + PATCH). On failure, `toast.error` and revert to pre-drag order.
- New employees are added at the end (`MAX(display_order) + 1`).

### Key Discoveries

- `Employee` type is auto-derived from the Drizzle schema — schema change is the single source of truth; `src/types.ts` needs no edits.
- `EmployeeManagementSheet` (`src/components/employee/EmployeeManagementSheet.tsx`) uses `employees` prop from `dashboard.astro` which passes `allEmployees` (unfiltered). After this plan, `allEmployees` will include `display_order`; the sheet doesn't use it visually, so no changes needed in the sheet.
- `extractPgErrorCode` helper lives at `src/lib/db-errors.ts` — reuse in the new endpoint.
- The `sql` helper from `drizzle-orm` is not yet imported in `dashboard.astro`; required for the active-first ORDER BY expression.
- `sonner` toast library is already used in `EmployeeManagementSheet` — reuse the same pattern in `AbsenceGrid`.

## What We're NOT Doing

- No changes to `EmployeeManagementSheet` or any other non-grid UI.
- No reordering UI outside the grid (no sidebar panel, no explicit "order" field in edit dialogs).
- No RLS changes — `display_order` is managed via application-level authorization (moderator check in API handler).
- Not migrating `GET /api/employees` ordering — the sheet doesn't use display_order visually; leave alphabetical there.
- Not making inactive columns draggable to the active section or vice versa (cross-group drops silently rejected).

## Implementation Approach

Four sequential phases: DB schema → API → server query → React component. Each phase is independently buildable and verifiable. The grid component phase (4) is the most complex; it introduces the DnD library and the two-SortableContext structure (active / inactive groups within one DndContext).

## Critical Implementation Details

**Table DnD transform constraint** — `transform` styles from `useSortable` must NOT be applied to `<th>` elements. Apply `opacity: isDragging ? 0.5 : 1` only. Visual drag feedback comes exclusively from the `<DragOverlay>` rendered outside the table.

**Two SortableContexts, one DndContext** — active (non-self) employees go into one `SortableContext`; inactive employees into a second `SortableContext`. Both live inside one `DndContext`. In `onDragEnd`, check that `active.id` and `over.id` belong to the same group before applying `arrayMove`; cross-group drops return without state change.

**Revert closure** — capture `const prevOrder = orderedEmployees` before calling `setOrderedEmployees(next)`. Pass `prevOrder` into the fetch `.catch`/failure branch to call `setOrderedEmployees(prevOrder)`.

**Active-first ORDER BY** — the moderator branch in `dashboard.astro` currently uses `asc(last_name)`. The new sort must be `CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, display_order, last_name, first_name`. Import `sql` from `drizzle-orm` to write the CASE expression in Drizzle.

---

## Phase 1: Schema, Migration, and New Employee Placement

### Overview

Add `display_order` to the Drizzle schema and create a Supabase migration that adds the column and seeds it from the current alphabetical order. Update the `POST /api/employees` handler to assign `MAX(display_order) + 1` on insert so new hires land at the end.

### Changes Required

#### 1. Drizzle schema

**File**: `src/db/schema.ts`

**Intent**: Add `display_order` integer column to the `employees` table definition so it is included in `$inferSelect` types and query results.

**Contract**: Add `display_order: integer("display_order").notNull().default(0)` as the last field in the `pgTable` call for `employees` (before the closing `}`).

#### 2. Generate + author migration

**File**: `supabase/migrations/20260608000001_employee_display_order.sql` (generated by `npm run db:generate`, then reviewed and augmented)

**Intent**: Add the column to the live database and seed initial values from the current alphabetical order so no row has a stale default of 0.

**Contract**: After `npm run db:generate` produces the ALTER TABLE statement, manually append a seeding UPDATE before committing:

```sql
-- Seed initial display_order from current alphabetical position (0-indexed)
WITH ranked AS (
  SELECT id,
         (row_number() OVER (ORDER BY last_name, first_name) - 1)::integer AS rn
  FROM employees
)
UPDATE employees
SET display_order = ranked.rn
FROM ranked
WHERE employees.id = ranked.id;
```

#### 3. New employee display_order on INSERT

**File**: `src/pages/api/employees/index.ts`

**Intent**: Assign `display_order = MAX(existing) + 1` so every new hire is placed at the end of the canonical order instead of colliding at position 0.

**Contract**: Before the `db.insert(employees).values(...)` call, execute a `SELECT COALESCE(MAX(display_order), -1) + 1` query and use the result as `display_order` in the INSERT values. Wrap both queries in the existing try/catch block; no transaction needed (display_order is a best-effort sort hint, not a uniqueness constraint).

### Success Criteria

#### Automated Verification

- `npm run db:generate` produces a single migration that adds the column and includes the seeding UPDATE block.
- `npm run db:migrate` applies cleanly against the local Supabase instance.
- `npm run build` completes without type errors (Employee type now includes `display_order: number`).

#### Manual Verification

- Query `SELECT id, last_name, display_order FROM employees ORDER BY display_order` via Drizzle Studio — each row has a unique, ascending integer matching alphabetical rank.
- Create a new employee via `POST /api/employees` — their `display_order` is `MAX + 1`.

**Implementation Note**: Pause for manual DB verification before proceeding.

---

## Phase 2: PATCH /api/employees/order Endpoint

### Overview

New API endpoint that accepts a full order snapshot from the client and bulk-updates `display_order` for all employees listed. Moderator-only.

### Changes Required

#### 1. New order endpoint

**File**: `src/pages/api/employees/order.ts`

**Intent**: Provide a moderator-only endpoint for the grid component to persist the drag-and-drop canonical order. Accepts an array of `{id, display_order}` pairs and updates each row.

**Contract**:
- Export `prerender = false`.
- Local `json()` helper (same pattern as `[id].ts`).
- `export const PATCH: APIRoute = async (context) => { ... }`.
- Auth + moderator check: same two-step pattern as `[id].ts` (check `context.locals.user`, then look up caller by `user_id` + `isNull(deleted_at)`, reject if not moderator with 403).
- Zod body schema: `z.object({ order: z.array(z.object({ id: z.string().uuid(), display_order: z.number().int().min(0) })) })`. Reject empty `order` arrays with 400.
- Bulk update via `Promise.all(parsed.data.order.map(item => db.update(employees).set({ display_order: item.display_order }).where(eq(employees.id, item.id))))`.
- Return `json({ ok: true }, 200)` on success.
- Catch DB errors and return 500.

### Success Criteria

#### Automated Verification

- `npm run build` passes (new file type-checks cleanly).
- `npm run lint` passes.

#### Manual Verification

- `curl -X PATCH /api/employees/order` with a valid moderator session and `{ order: [{id: "<uuid>", display_order: 0}] }` returns `{ ok: true }` and the row is updated in the DB.
- Same request with an employee session returns 403.
- Request with invalid body (missing `order`, bad UUID) returns 400.

**Implementation Note**: Pause for manual API verification before proceeding.

---

## Phase 3: Dashboard Query Update

### Overview

Thread `display_order` through `empCols` and update both `orderBy` clauses so the server delivers employees in the correct canonical order: active employees sorted by `display_order` first, inactive employees after (moderator branch only).

### Changes Required

#### 1. Add display_order to empCols

**File**: `src/pages/dashboard.astro`

**Intent**: Include `display_order` in the column projection so the `Employee` objects passed to grid, details, and stats components carry the field.

**Contract**: Add `display_order: employeesTable.display_order` to the `empCols` object at line ~66.

#### 2. Update moderator branch orderBy

**File**: `src/pages/dashboard.astro`

**Intent**: Moderator sees all employees; inactive ones must float to the end of the list regardless of their `display_order` value.

**Contract**: Replace `asc(employeesTable.last_name), asc(employeesTable.first_name)` in the moderator branch with:

```ts
sql`CASE WHEN ${employeesTable.deleted_at} IS NULL THEN 0 ELSE 1 END`,
asc(employeesTable.display_order),
asc(employeesTable.last_name),
asc(employeesTable.first_name)
```

Import `sql` from `drizzle-orm` (add to existing import at line ~10).

#### 3. Update employee branch orderBy

**File**: `src/pages/dashboard.astro`

**Intent**: Non-moderator employees only see active employees; their list just needs `display_order` as the primary sort, with alphabetical tiebreaker.

**Contract**: Replace `asc(employeesTable.last_name), asc(employeesTable.first_name)` in the employee branch with `asc(employeesTable.display_order), asc(employeesTable.last_name), asc(employeesTable.first_name)`.

### Success Criteria

#### Automated Verification

- `npm run build` passes.
- `npm run lint` passes.

#### Manual Verification

- Load the dashboard as employee — columns appear in `display_order` sequence.
- Load the dashboard as moderator — active employees appear first in `display_order` sequence; inactive (greyed) columns appear after.

**Implementation Note**: Pause for visual grid verification before proceeding to the DnD phase.

---

## Phase 4: Grid Component — Self-First Sort + Drag-and-Drop

### Overview

Install `@dnd-kit`, replace the static `employees` iteration with a managed `orderedEmployees` state (self always first), add `SortableEmployeeHeader`, two `SortableContext`s (active / inactive) inside one `DndContext`, a `DragOverlay`, and `handleDragEnd` with optimistic update and toast-revert on failure.

### Changes Required

#### 1. Install DnD dependencies

**File**: `package.json` / `package-lock.json`

**Intent**: Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — the three packages needed for sortable list primitives, drag overlays, and the `arrayMove` helper.

**Contract**: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`.

#### 2. selfFirst helper + orderedEmployees state

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Client-side sort that always places the current user at index 0. Employees arrive pre-sorted from the server (active by `display_order`, then inactive), so `selfFirst` only moves the current user to the front; the relative order of others is preserved.

**Contract**: Module-level pure function `function selfFirst(emps: Employee[], currentId: string): Employee[]` — returns `[me, ...others]` where `me = emps.find(e => e.id === currentId)` and `others = emps.filter(e => e.id !== currentId)`. Use as the `useState` initializer: `const [orderedEmployees, setOrderedEmployees] = useState(() => selfFirst(employees, currentEmployee.id))`.

#### 3. Replace employees.map with orderedEmployees.map

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Both `<thead>` and `<tbody>` must iterate the same ordered array so column headers and cell data stay in sync after a drag.

**Contract**: Replace all occurrences of `employees.map(...)` in the JSX (there are two: one in `<thead>` at line ~77 and one in `<tbody>` at line ~110) with `orderedEmployees.map(...)`.

#### 4. SortableEmployeeHeader component

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Encapsulate the sortable `<th>` for each non-self employee so it can call `useSortable`, apply opacity during drag (NOT transform — table constraint), and render a grip icon drag handle visible only to the moderator.

**Contract**: Local function component `SortableEmployeeHeader` accepting `{ emp, isModerator, currentEmployeeId }`. Call `useSortable({ id: emp.id })`. Apply `ref={setNodeRef}` and `style={{ opacity: isDragging ? 0.5 : 1 }}` to the `<th>`. Render the grip handle (`<GripVertical>` from `lucide-react`) only when `isModerator` — attach `{...attributes} {...listeners}` to the handle div, NOT to the `<th>`, to allow text selection on the name. Do NOT apply `transform` from `useSortable` (table constraint).

Self column continues to render as a plain `<th>` (not sortable) with its existing `bg-blue-50` style.

#### 5. DnD infrastructure + DragOverlay

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Wire up DnD state tracking and the floating DragOverlay that provides visual drag feedback since in-place animation is blocked by the table layout.

**Contract**:
- Add `const [activeId, setActiveId] = useState<string | null>(null)` for overlay rendering.
- Derive `draggableActive` and `draggableInactive` arrays from `orderedEmployees` (active = `!deleted_at && id !== currentEmployee.id`; inactive = `!!deleted_at`).
- Wrap the component's return in `<DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={…} onDragEnd={…} onDragCancel={…}>`.
- Inside `<thead><tr>`: render "Dzień" sticky `<th>`, then self `<th>`, then `<SortableContext items={draggableActive.map(e=>e.id)} strategy={horizontalListSortingStrategy}>` with active headers, then `<SortableContext items={draggableInactive.map(e=>e.id)} strategy={horizontalListSortingStrategy}>` with inactive headers.
- After `</table>`, render `<DragOverlay>` — when `activeId` is set, render a small floating `<div>` with the employee's name (styled similarly to the header but as a block element).
- `sensors` = `useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))` to prevent accidental drags.

#### 6. handleDragEnd with optimistic update and toast revert

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: On drop, reorder the relevant group (active or inactive), persist via PATCH, and revert with a toast if the save fails.

**Contract**:
- Capture `const prevOrder = orderedEmployees` before state update.
- Compute new order: identify which group `active.id` belongs to (active or inactive). Reject cross-group drops silently (return early). Use `arrayMove` from `@dnd-kit/utilities` within the appropriate group. Merge back as `[self, ...newActive, ...newInactive]`.
- Call `setOrderedEmployees(next)`.
- Fire `fetch('/api/employees/order', { method: 'PATCH', ... })` with `{ order: next.map((e, i) => ({ id: e.id, display_order: i })) }`. On failure (non-ok status or network error), call `toast.error("Nie udało się zapisać kolejności")` and `setOrderedEmployees(prevOrder)`.
- Import `toast` from `sonner` (already a project dependency).

### Success Criteria

#### Automated Verification

- `npm run build` passes (new imports and types resolve).
- `npm run lint` passes.

#### Manual Verification

- Log in as **employee**: grid shows self first, then other employees in `display_order` order. No drag handle icons visible.
- Log in as **moderator**: self column is first (no drag handle). Other active columns have a grip icon (≡). Drag an active column left or right — DragOverlay follows cursor, column snaps to new position on drop, order persists on page reload.
- Drag an inactive (greyed) column — it can be reordered within the inactive section only. Attempting to drag an inactive column over an active one has no effect.
- Simulate network failure (DevTools → offline) and drag a column — optimistic reorder happens, then a toast "Nie udało się zapisać kolejności" appears and the columns snap back.
- Details and Stats tabs show employees in the same order as the grid.

**Implementation Note**: Pause for full manual browser verification before declaring the feature complete.

---

## Testing Strategy

### Manual Testing Steps

1. Seed the DB with at least 4 active employees and 1 deactivated employee.
2. Log in as employee — verify self-first order, no drag handles, alphabetical-ish order for others.
3. Log in as moderator — verify self-first, drag handles on non-self active columns, inactive floated to end.
4. Drag active column B before active column A — reload page — confirm order persisted.
5. Drag inactive column — confirm only reorders within inactive section.
6. Go offline (DevTools), drag — confirm toast error + revert.
7. Add a new employee via EmployeeManagementSheet — confirm they appear at the end of the active section.
8. Switch between Grid / Details / Stats tabs — confirm same column order across all.

## Migration Notes

Seeding UPDATE in the migration assigns deterministic initial `display_order` values from alphabetical rank. Production rows will be correctly ordered on first deploy; no manual intervention needed.

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-07
- Schema: `src/db/schema.ts:17-25`
- Grid component: `src/components/absence/AbsenceGrid.tsx`
- Employee API: `src/pages/api/employees/index.ts`, `[id].ts`
- Dashboard: `src/pages/dashboard.astro:66-89`
- Error helper: `src/lib/db-errors.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, Migration, and New Employee Placement

#### Automated

- [x] 1.1 `npm run db:generate` produces migration with column + seeding UPDATE — c484ac9
- [x] 1.2 `npm run db:migrate` applies cleanly — c484ac9
- [x] 1.3 `npm run build` passes with display_order in Employee type — c484ac9

#### Manual

- [x] 1.4 DB query shows unique ascending display_order seeded from alphabetical rank — c484ac9
- [x] 1.5 POST new employee returns display_order = MAX + 1 — c484ac9

### Phase 2: PATCH /api/employees/order Endpoint

#### Automated

- [x] 2.1 `npm run build` passes — a6c70c5
- [x] 2.2 `npm run lint` passes — a6c70c5

#### Manual

- [x] 2.3 PATCH with moderator session updates display_order in DB — a6c70c5
- [x] 2.4 PATCH with employee session returns 403 — a6c70c5
- [x] 2.5 PATCH with invalid body returns 400 — a6c70c5

### Phase 3: Dashboard Query Update

#### Automated

- [x] 3.1 `npm run build` passes — 1f2edbe
- [x] 3.2 `npm run lint` passes — 1f2edbe

#### Manual

- [x] 3.3 Employee view: columns in display_order sequence — 1f2edbe
- [x] 3.4 Moderator view: active columns first by display_order, inactive floated to end — 1f2edbe

### Phase 4: Grid Component — Self-First Sort + Drag-and-Drop

#### Automated

- [x] 4.1 `npm run build` passes — e2e421e
- [x] 4.2 `npm run lint` passes — e2e421e

#### Manual

- [x] 4.3 Employee: self first, no drag handles — e2e421e
- [x] 4.4 Moderator: self first, drag handles on non-self active columns — e2e421e
- [x] 4.5 Active column drag persists on reload — e2e421e
- [x] 4.6 Inactive column drag reorders only within inactive section — e2e421e
- [x] 4.7 Offline drag triggers toast error and reverts — e2e421e
- [x] 4.8 New employee appears at end of active section — e2e421e
- [x] 4.9 Details and Stats tabs reflect same order as grid — e2e421e
