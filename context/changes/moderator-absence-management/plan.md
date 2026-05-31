# Moderator Absence Management — Implementation Plan

## Overview

Unlock the existing absence CRUD flow so that moderators can add, edit, and delete absence entries for any employee — not just their own. The RLS policies in F-01 already allow moderators full `INSERT`/`UPDATE`/`DELETE` on `absences`; this slice wires that permission into the UI and API layer.

## Current State Analysis

- `employees.role` (`employee` | `moderator`) is already stored in the DB and fetched as part of `currentEmployee` in `dashboard.astro`
- RLS: `absences_insert`, `absences_update`, `absences_delete` policies already allow `get_user_role() = 'moderator'` — no new migration needed
- `AbsenceGrid` gates cell clicks with `isOwn && !isWeekend` — moderators are blocked by this UI check, not by the DB
- API POST `/api/absences` derives `employee_id` exclusively from the caller's own employee record — moderators have no way to create absences for others
- API `PATCH`/`DELETE` `/api/absences/[id]` are already correct — RLS handles ownership; no changes needed
- `AbsenceFormDialog` always POSTs without an `employee_id` in the body; the API infers it server-side
- `Topbar.astro` shows only the user's email and nav links — no role signal

## Desired End State

A logged-in moderator opens `/dashboard`, sees all employees' cells as clickable, and can open the form dialog for any non-weekend cell. The dialog header names the employee whose absence is being managed. The moderator can add, edit, and delete absences for any employee. A "Moderator" badge appears in the Topbar next to their email so the elevated role is visually communicated.

Employees' experience is unchanged: their cells remain clickable, others' cells remain non-clickable, no badge appears.

Verified by: a moderator user can click any non-weekend cell (including other employees'), save an absence, and see it reflected in the grid.

### Key Discoveries

- `src/types.ts:1` — `UserRole = "employee" | "moderator"` already exported; `Employee.role: UserRole` already typed
- `src/pages/dashboard.astro:37` — `currentEmployee` is fetched with `role` included in the `select("id, first_name, last_name, role")` — no dashboard change needed to expose role
- `src/components/absence/AbsenceGrid.tsx:97` — `const clickable = isOwn && !isWeekend` — the single line to change
- `supabase/migrations/20260526000001_schema.sql:89` — `get_user_role()` SECURITY DEFINER function already in place; moderator RLS policies already cover INSERT/UPDATE/DELETE
- `src/pages/api/absences/index.ts:89` — `employee_id: employeeResult.data.id` is hardcoded from the server-side caller lookup; the fix is to allow moderators to override this via request body
- `src/components/absence/AbsenceFormDialog.tsx:56` — `otherEmployees = employees.filter(e => e.id !== currentEmployee.id)` — for the substitute selector, the filter must use `targetEmployee.id` not `currentEmployee.id` when a moderator edits another's row

## What We're NOT Doing

- No new DB migration — RLS is already correct
- No changes to PATCH or DELETE routes — they already work for moderators via RLS
- No separate moderator-only route for POST — same endpoint, role-branching in handler
- No audit trail / created-by tracking — out of scope for this slice
- No visual diff between moderator-owned vs moderator-edited cells — grid appearance unchanged
- No employee management (S-04)

## Implementation Approach

Four sequential phases following backend → UI order: (1) widen the POST API to accept a moderator-provided `employee_id`, (2) unlock grid cells for moderators and thread the target employee through to the dialog, (3) update the dialog to surface the target employee and pass their ID to the API, (4) add the Topbar role badge.

Phases 2 and 3 are tightly coupled (grid passes `targetEmployee` prop to dialog), but they touch separate files and can have independent success criteria.

---

## Phase 1: API POST — moderator employee_id override

### Overview

Extend `POST /api/absences` so that moderators can specify an `employee_id` in the request body. Non-moderators still use the server-side caller lookup; any `employee_id` they send is ignored.

### Changes Required

#### 1. Extend `AbsenceCreateSchema` with optional employee_id

**File**: `src/pages/api/absences/index.ts`

**Intent**: Add `employee_id` as an optional UUID field to the Zod schema so the route can receive it for moderator requests.

**Contract**: Add `employee_id: z.string().uuid().optional()` to `AbsenceCreateSchema`. The field is optional so the schema continues to accept requests without it (employee flow unchanged).

#### 2. Add moderator branch to POST handler

**File**: `src/pages/api/absences/index.ts`

**Intent**: After the caller's employee lookup, branch on role: if moderator and `employee_id` provided in body, validate that employee exists and is active, then use their ID; otherwise use the caller's own ID.

**Contract**: After `employeeResult` is confirmed valid, destructure `{ employee_id: requestedEmployeeId, ...absenceData }` from `parsed.data`. Resolve `targetEmployeeId`:

```ts
let targetEmployeeId = employeeResult.data.id;

if (employeeResult.data.role === "moderator" && requestedEmployeeId) {
  const targetResult = await supabase
    .from("employees")
    .select("id")
    .eq("id", requestedEmployeeId)
    .is("deleted_at", null)
    .single();
  if (!targetResult.data) {
    return json({ error: "Pracownik nie został znaleziony." }, 404);
  }
  targetEmployeeId = requestedEmployeeId;
}
```

Insert with `{ employee_id: targetEmployeeId, ...absenceData }`. The `employeeResult` query must now also select `role` — change `.select("id")` to `.select("id, role")` and update the type assertion accordingly.

### Success Criteria

#### Automated Verification

- `npm run build` passes (TypeScript compiles updated POST handler)
- `npm run lint` passes

#### Manual Verification

- POST as moderator with a valid other-employee's `employee_id` → 201, inserted row has that employee's ID
- POST as moderator without `employee_id` → 201, inserted row uses moderator's own employee ID
- POST as moderator with a non-existent `employee_id` → 404
- POST as employee with another employee's `employee_id` in body → 201, inserted row uses the caller's own employee ID (body field ignored)

**Implementation Note**: The `employeeResult` type assertion must be updated to include `role` in the selected fields. The type cast covers `{ id: string; role: UserRole }`.

---

## Phase 2: AbsenceGrid — unlock cells for moderators

### Overview

Derive the caller's moderator status from `currentEmployee.role` and use it to make all non-weekend cells clickable. Store the target employee in dialog state so the dialog knows whose absence is being managed.

### Changes Required

#### 1. Derive isModerator and update clickable logic

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Allow moderators to click any non-weekend cell, not just their own column.

**Contract**: Before the days loop, derive `const isModerator = currentEmployee.role === "moderator"`. Change the clickable condition from `const clickable = isOwn && !isWeekend` to `const clickable = (isOwn || isModerator) && !isWeekend`.

#### 2. Add targetEmployee to dialogState and form dialog

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Thread the clicked cell's employee to the form dialog so it knows whose absence to create or edit.

**Contract**: Update `dialogState` type to `{ day: Date; absence: Absence | null; targetEmployee: Employee } | null`. When opening the dialog: `setDialogState({ day: date, absence: absence ?? null, targetEmployee: emp })`. Add `targetEmployee={dialogState.targetEmployee}` to the `<AbsenceFormDialog>` JSX.

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- As moderator: all non-weekend cells in all columns show pointer cursor and respond to click
- As employee: only own column cells are clickable (unchanged behavior)
- Clicking another employee's cell as moderator opens the dialog (dialog itself tested in Phase 3)

---

## Phase 3: AbsenceFormDialog — target employee UX + POST body

### Overview

Accept the target employee as a prop, show their name in the dialog header when a moderator is editing on their behalf, fix the substitute filter, and include the employee ID in the POST body.

### Changes Required

#### 1. Add targetEmployee prop

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Let the dialog know which employee's absence it is managing (may differ from `currentEmployee` when a moderator edits another's row).

**Contract**: Add `targetEmployee: Employee` to `AbsenceFormDialogProps`. The prop is required — callers always pass it (grid passes `dialogState.targetEmployee`; for the employee flow this will equal `currentEmployee`).

#### 2. Show employee name in header for moderator context

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: When a moderator edits another employee's absence, the dialog must name that employee to prevent accidental edits on the wrong row.

**Contract**: After `<p className="text-muted-foreground text-sm capitalize">{dateHeading}</p>`, add a conditional line:

```tsx
{targetEmployee.id !== currentEmployee.id && (
  <p className="text-sm font-medium text-blue-600">
    {targetEmployee.first_name} {targetEmployee.last_name}
  </p>
)}
```

#### 3. Fix substitute filter to use targetEmployee

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: The substitute selector should exclude the person who is absent (the target), not the moderator who is editing.

**Contract**: Change `employees.filter((e) => e.id !== currentEmployee.id)` to `employees.filter((e) => e.id !== targetEmployee.id)`.

#### 4. Include employee_id in POST body

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Pass the target employee's ID to the API so the Phase 1 moderator branch can use it.

**Contract**: In `handleSave`, add `employee_id: targetEmployee.id` to the POST body object. For PATCH, this field is not needed (existing absence already has the correct `employee_id`; PATCH only updates the fields sent).

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- Moderator clicks another employee's empty cell → dialog opens, employee's name is shown below the date
- Moderator clicks own cell → dialog opens, no employee name shown (own-row behavior unchanged)
- Moderator saves a new absence for another employee → 201, colored cell appears in that employee's column after reload
- Moderator edits an existing absence in another employee's column → updated cell reflects the change
- Moderator deletes an absence from another employee's column → cell clears
- Substitute selector excludes the target employee (not the moderator)
- As employee: dialog shows no employee name; substitute selector excludes self (unchanged)

---

## Phase 4: Topbar — moderator badge

### Overview

Add an optional `role` prop to `Topbar.astro` and render a "Moderator" chip next to the user's email. Pass the current employee's role from `dashboard.astro`.

### Changes Required

#### 1. Add role prop and badge to Topbar

**File**: `src/components/Topbar.astro`

**Intent**: Show a small "Moderator" badge when the current user has the moderator role, so elevated permissions are visually communicated.

**Contract**: Add `interface Props { role?: "employee" | "moderator" }` and `const { role } = Astro.props`. In the authenticated branch, render the badge between the email and the nav links:

```astro
{role === "moderator" && (
  <span class="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-300">
    Moderator
  </span>
)}
```

#### 2. Pass role from dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Thread the current employee's role to the Topbar.

**Contract**: Change `<Topbar />` to `<Topbar role={currentEmployee?.role} />`. This prop is only available after `currentEmployee` is resolved; the Topbar falls back gracefully when `role` is undefined (non-employee users see no badge).

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- Logged in as moderator → "Moderator" chip visible in Topbar next to email
- Logged in as employee → no chip visible in Topbar

---

## Testing Strategy

### Manual Testing Steps

1. `npx supabase start` (local DB running with seed data including at least one moderator and one employee)
2. `npm run build && npm run dev`
3. Sign in as **moderator**:
   - Topbar shows "Moderator" badge
   - All non-weekend cells in all employee columns are clickable
   - Click an empty cell in another employee's column → dialog opens with their name shown
   - Fill in type + full day → save → their cell fills with the correct color
   - Click that cell again → edit dialog opens with pre-filled values and employee name shown
   - Edit the type → save → cell updates
   - Click the cell → click "Usuń" → cell clears
   - Click own cell → dialog opens with no employee name (own-row behavior unchanged)
   - Substitute selector in another employee's dialog excludes that employee (not the moderator)
4. Sign in as **employee**:
   - No "Moderator" badge in Topbar
   - Only own column cells are clickable (unchanged)
   - Clicking another employee's cell does nothing

### Automated Verification

- `npm run build` — TypeScript compilation gate for all four phases
- `npm run lint` — ESLint + Prettier gate

## Performance Considerations

No performance implications — the changes are conditional renders and a single extra DB query (target employee validation) only on moderator POST requests.

## Migration Notes

No new migrations. All RLS policies are already in place from F-01.

## References

- PRD: `context/foundation/prd.md` — FR-003, Access Control section
- Roadmap: `context/foundation/roadmap.md` — S-03
- RLS policies: `supabase/migrations/20260526000001_schema.sql`
- Grid component: `src/components/absence/AbsenceGrid.tsx`
- Dialog component: `src/components/absence/AbsenceFormDialog.tsx`
- POST route: `src/pages/api/absences/index.ts`
- Dashboard: `src/pages/dashboard.astro`
- Topbar: `src/components/Topbar.astro`
- Types: `src/types.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: API POST — moderator employee_id override

#### Automated

- [x] 1.1 `npm run build` passes (updated POST handler) — f97020b
- [x] 1.2 `npm run lint` passes — f97020b

#### Manual

- [x] 1.3 POST as moderator with valid other-employee's ID → 201, correct employee_id in row — f97020b
- [x] 1.4 POST as moderator without employee_id → 201, uses moderator's own employee ID — f97020b
- [x] 1.5 POST as moderator with non-existent employee_id → 404 — f97020b
- [x] 1.6 POST as employee with another employee's ID in body → own employee_id used — f97020b

### Phase 2: AbsenceGrid — unlock cells for moderators

#### Automated

- [x] 2.1 `npm run build` passes — 3b2e784
- [x] 2.2 `npm run lint` passes — 3b2e784

#### Manual

- [x] 2.3 As moderator: all non-weekend cells in all columns are clickable — 3b2e784
- [x] 2.4 As employee: only own column cells are clickable (unchanged) — 3b2e784
- [x] 2.5 Clicking another employee's cell as moderator opens the dialog — 3b2e784

### Phase 3: AbsenceFormDialog — target employee UX + POST body

#### Automated

- [x] 3.1 `npm run build` passes
- [x] 3.2 `npm run lint` passes

#### Manual

- [x] 3.3 Moderator clicks another employee's cell → employee name shown in dialog
- [x] 3.4 Moderator clicks own cell → no employee name shown
- [x] 3.5 Moderator saves new absence for another employee → colored cell appears in their column
- [x] 3.6 Moderator edits absence in another employee's column → cell updates
- [x] 3.7 Moderator deletes absence from another employee's column → cell clears
- [x] 3.8 Substitute selector excludes the target employee (not the moderator)
- [x] 3.9 Employee flow unchanged: dialog shows no name, substitute excludes self

### Phase 4: Topbar — moderator badge

#### Automated

- [ ] 4.1 `npm run build` passes
- [ ] 4.2 `npm run lint` passes

#### Manual

- [ ] 4.3 Logged in as moderator → "Moderator" chip visible in Topbar
- [ ] 4.4 Logged in as employee → no chip in Topbar
