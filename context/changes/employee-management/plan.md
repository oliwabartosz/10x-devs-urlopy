# Employee Management Implementation Plan

## Overview

Moderator gets a slide-over panel (Sheet) accessible from the dashboard that lets them add new employees (creating a Supabase Auth account with a temporary password), edit name and role, soft-delete (preserving all historical absences), and restore previously soft-deleted employees. Historical monthly grids are updated to show employees who were active during the viewed month, not just currently active ones.

## Current State Analysis

- `employees` table has `deleted_at TIMESTAMPTZ NULL` — soft-delete is schema-ready; no migration needed
- Two RLS SELECT policies exist: `employees_select_authenticated` (active only, `deleted_at IS NULL`) and `employees_select_moderator_all` (all rows, for moderators). UPDATE policy `employees_update_moderator` allows moderators to update any row (including soft-deleted). No DELETE policy — hard deletes are blocked at DB level.
- `Employee` type in `src/types.ts:3` already includes `deleted_at: string | null`
- No employee CRUD API routes exist — only the absences API touches the employees table incidentally
- Dashboard employee query (`src/pages/dashboard.astro:52-58`) uses the anon client with `deleted_at IS NULL` filter — cannot show soft-deleted employees in historical months
- No admin (service role) Supabase client exists — needed for `auth.admin.createUser` (employee creation) and for date-aware historical employee queries that bypass the `deleted_at IS NULL` RLS constraint
- `@supabase/supabase-js ^2.99.1` is a direct dependency — `createClient` is available
- No shadcn Sheet component installed — needed for the slide-over panel

## Desired End State

A moderator opens a "Pracownicy" slide-over panel from the dashboard, sees all active and deactivated employees in two sections, can add a new employee with name/email/role/password, edit an existing employee's name and role, soft-delete with a confirmation dialog noting that absence history is preserved, and restore a previously deactivated employee. When navigating to a past month, the grid shows employees who were active during that month (not just currently active ones), so columns are not retroactively removed.

### Key Discoveries

- `src/pages/dashboard.astro:52-58` — employees query to replace with date-aware admin client fetch
- `src/lib/supabase.ts:3` — imports `SUPABASE_URL`, `SUPABASE_KEY` from `astro:env/server`; admin client follows same pattern with `SUPABASE_SERVICE_KEY`
- `src/pages/api/absences/index.ts:87-102` — moderator role-check pattern to replicate in employee endpoints
- `src/components/absence/AbsenceFormDialog.tsx` — full-cycle form dialog pattern (fetch, Zod, toast, reload) to follow
- `context/foundation/lessons.md` — Topbar reads `Astro.locals` directly; the Sheet trigger is a React island rendered separately from `Topbar.astro` to avoid Astro/React boundary complexity
- `astro.config.mjs:19-20` — env schema for `SUPABASE_URL` and `SUPABASE_KEY`; add `SUPABASE_SERVICE_KEY` alongside

## What We're NOT Doing

- No hard delete of employees or Supabase auth users
- No email invite flow (direct password creation only)
- No employee self-registration → moderator approval workflow
- No changes to the existing `/auth/signup` flow
- No changes to absence policies or other features
- No ability to change an employee's email after creation
- No displaying soft-deleted employees' absence entries in Details/Stats tabs (if the employee was deleted before the viewed month, their name won't resolve — known MVP limitation)

## Implementation Approach

Four sequential phases, each independently verifiable. The service role key is the critical prerequisite that unlocks all others. API routes are built before the UI so each route can be smoke-tested via curl before wiring the frontend. The dashboard query is updated as part of Phase 3 to enable historical grid accuracy; the UI panel (Phase 4) then passes data through from the already-correct server-side fetch.

## Critical Implementation Details

**Service role key scope**: The admin Supabase client (`createAdminClient`) bypasses all RLS. It must only be used server-side (Astro pages, API routes) and must never be passed as a prop or serialized into client-rendered HTML. The `allEmployees` array (data only) is safe to pass as a prop; the client instance is not.

**Date-aware employee filter**: An employee is "active during the viewed month" if `deleted_at IS NULL OR deleted_at >= firstDayOfViewedMonth`. This means employees deleted mid-month still appear for that month. The `firstDay` variable is already computed in `dashboard.astro:48`.

**Self-deletion guard**: `DELETE /api/employees/[id]` must reject requests where `params.id === callerEmployee.id` (moderator cannot delete themselves). This is enforced at the application layer, not RLS.

**Restore does not touch auth.users**: Soft-deleting only sets `deleted_at`; the auth user is never touched. Restoring clears `deleted_at`. The restored employee's login credentials are unchanged.

---

## Phase 1: Infrastructure — Service Role Key + Admin Client

### Overview

Add `SUPABASE_SERVICE_KEY` to the environment schema and create a server-side admin Supabase client factory. Nothing renders or changes in the app yet; this is a pure infrastructure step.

### Changes Required

#### 1. Document new secret

**File**: `.dev.vars.example`

**Intent**: Tell developers that `SUPABASE_SERVICE_KEY` is now required and where to find it (Supabase dashboard → Project Settings → API → service_role key).

**Contract**: Add one line: `SUPABASE_SERVICE_KEY=your-service-role-key-here`

---

#### 2. Register env var in Astro schema

**File**: `astro.config.mjs`

**Intent**: Declare `SUPABASE_SERVICE_KEY` as a server-only secret so it's typed and available via `astro:env/server`, matching the pattern used for `SUPABASE_URL` and `SUPABASE_KEY`.

**Contract**: Add inside `env.schema`: `SUPABASE_SERVICE_KEY: envField.string({ context: "server", access: "secret", optional: true })`

---

#### 3. Create admin Supabase client factory

**File**: `src/lib/supabase-admin.ts` (new)

**Intent**: Provide a factory function that returns a service-role Supabase client for admin operations (creating auth users, RLS-bypassing queries). Returns `null` if the key is not configured so callers can degrade gracefully.

**Contract**: Export `createAdminClient()` that imports `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from `astro:env/server`, then calls `createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })` from `@supabase/supabase-js`. The `auth` options prevent the service-role client from attempting token refresh or session storage.

### Success Criteria

#### Automated Verification

- `npm run build` passes (env var declared as optional, so build succeeds without the value set)
- `npm run lint` passes

#### Manual Verification

- Add `SUPABASE_SERVICE_KEY` value from Supabase dashboard to `.dev.vars` and confirm `npm run dev` starts without errors

**Implementation Note**: Pause here and confirm the admin client module builds cleanly before proceeding.

---

## Phase 2: Employee API Routes

### Overview

Four API endpoints that cover the full employee lifecycle: create (with auth user), update fields, soft-delete, and restore. All endpoints enforce moderator-only access at the application layer; PATCH and DELETE also rely on RLS as a second gate.

### Changes Required

#### 1. POST /api/employees — create employee

**File**: `src/pages/api/employees/index.ts` (new)

**Intent**: Create a new Supabase auth user with a moderator-supplied password, then insert the corresponding employee record. Moderator-only.

**Contract**:
- `export const prerender = false`
- Auth guard: `context.locals.user` must be present (401 otherwise)
- Role guard: fetch `{ id, role }` from `employees` table for `context.locals.user.id`; return 403 if no employee record or role is not `"moderator"`
- Zod body schema: `{ first_name: z.string().min(1).max(100), last_name: z.string().min(1).max(100), email: z.string().email(), role: z.enum(["employee", "moderator"]), password: z.string().min(8) }`
- Auth user creation: `adminClient.auth.admin.createUser({ email, password, email_confirm: true })`; if the Supabase Auth error message contains "already" or status 422, return 409 `{ error: "Konto z tym adresem email już istnieje." }`
- Employee record insert: `adminClient.from("employees").insert({ user_id: authUser.id, first_name, last_name, role })`
- Return 201 with the inserted employee row

---

#### 2. PATCH /api/employees/[id] — update name/role

**File**: `src/pages/api/employees/[id].ts` (new)

**Intent**: Allow a moderator to update an employee's first name, last name, or role. Cannot update soft-deleted employees.

**Contract**:
- Auth + moderator guard (same pattern as POST)
- Validate `params.id` is a valid UUID (Zod `z.uuid()`)
- Zod body schema: `{ first_name?: z.string().min(1).max(100), last_name?: z.string().min(1).max(100), role?: z.enum(["employee", "moderator"]) }` refined so at least one field is present
- Before updating, verify the target employee exists and `deleted_at IS NULL` (return 404 if not found, 409 if already deleted)
- Use the regular (session-based) Supabase client for the UPDATE; RLS `employees_update_moderator` enforces the gate at DB level. Catch code `42501` → return 403
- Return 200 with updated employee data

---

#### 3. DELETE /api/employees/[id] — soft-delete

**File**: `src/pages/api/employees/[id].ts` (same file as PATCH, add `DELETE` export)

**Intent**: Soft-delete an employee by setting `deleted_at = now()`. Preserves all absence records. Moderator cannot delete themselves.

**Contract**:
- Auth + moderator guard
- Self-deletion guard: if `params.id === callerEmployee.id` return 400 `{ error: "Nie możesz usunąć własnego konta." }`
- Verify target employee is currently active (`deleted_at IS NULL`); return 404 if not found or already deleted
- `supabase.from("employees").update({ deleted_at: new Date().toISOString() }).eq("id", params.id)`. Catch `42501` → 403
- Return 200

---

#### 4. POST /api/employees/[id]/restore — restore soft-deleted employee

**File**: `src/pages/api/employees/[id]/restore.ts` (new)

**Intent**: Restore a soft-deleted employee by setting `deleted_at = null`. The employee's Supabase auth account is unaffected (never deleted).

**Contract**:
- `export const prerender = false`
- Auth + moderator guard
- Verify target employee is currently soft-deleted: use regular client (moderator can see all via `employees_select_moderator_all` policy). Return 404 if not found, 409 if already active
- `supabase.from("employees").update({ deleted_at: null }).eq("id", params.id)`. Catch `42501` → 403
- Return 200 with updated employee row

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- `POST /api/employees` with valid body as moderator → 201, auth user created in Supabase dashboard, employee row appears in DB
- `POST /api/employees` with duplicate email → 409 with Polish error message
- `POST /api/employees` as non-moderator → 403
- `PATCH /api/employees/:id` with `{ role: "moderator" }` → 200, role updated in DB
- `DELETE /api/employees/:id` for a different employee → 200, `deleted_at` set in DB
- `DELETE /api/employees/:id` for own employee id → 400
- `POST /api/employees/:id/restore` → 200, `deleted_at` set back to null

**Implementation Note**: Verify all seven cases manually before proceeding to Phase 3.

---

## Phase 3: Dashboard — Date-Aware Employee Fetch

### Overview

Replace the dashboard's static `deleted_at IS NULL` employee query with an admin-client query that fetches all employees and then filters in JavaScript to show employees active during the viewed month. This enables historical grid accuracy without changing the grid component itself.

### Changes Required

#### 1. Update server-side employee fetch in dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Use the admin Supabase client (service role) to fetch all employees without RLS constraints, split into `gridEmployees` (active during the viewed month) and `allEmployees` (all, including soft-deleted — for the panel in Phase 4), and pass `gridEmployees` to the existing grid/details/stats components.

**Contract**:
- Import `createAdminClient` from `@/lib/supabase-admin`
- Instantiate `adminSupabase = createAdminClient()` before the data fetch block. If `adminSupabase` is null (env not configured), fall back to the existing `supabase` client with `deleted_at IS NULL` filter — this preserves current behaviour in environments without the service key
- In `Promise.all`, replace the employees query with: `adminSupabase.from("employees").select("*").order("last_name").order("first_name")` (no deleted_at filter)
- After Promise.all resolves, derive two arrays in the page script:
  - `gridEmployees`: employees where `e.deleted_at === null || new Date(e.deleted_at) >= new Date(firstDay)` (active at any point during or after the first day of the viewed month)
  - `allEmployees`: the full unfiltered result (for the panel in Phase 4; rename the existing `employees` var to `allEmployees` and pass `gridEmployees` wherever `employees` was passed)
- Update `employees` prop passed to `AbsenceGrid`, `AbsenceDetailsTable`, and `AbsenceStats` to use `gridEmployees`

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- Navigate to a past month in the grid; an employee who was soft-deleted after that month still appears as a column
- Navigate to the current month; that employee's column is absent
- Non-moderator user sees the same historically accurate grid for past months

**Implementation Note**: Confirm the historical column behaviour before writing UI in Phase 4.

---

## Phase 4: Employee Management UI

### Overview

Install the shadcn Sheet component, build the employee management slide-over panel with add/edit/delete/restore dialogs, and wire it into the dashboard for moderators. All mutations reload the page on success to refresh server-side data.

### Changes Required

#### 1. Install shadcn Sheet component

**File**: auto-generated `src/components/ui/sheet.tsx`

**Intent**: Add the Radix UI Sheet (slide-over) primitive that the panel will use.

**Contract**: Run `npx shadcn@latest add sheet`. This generates `src/components/ui/sheet.tsx` following the project's "new-york" style variant — no manual edits required.

---

#### 2. Add employee form dialog

**File**: `src/components/employee/AddEmployeeDialog.tsx` (new)

**Intent**: Dialog form for creating a new employee. Calls `POST /api/employees`, shows toast on success or displays server error inline, then reloads the page.

**Contract**:
- Props: `{ open: boolean, onOpenChange: (open: boolean) => void }`
- Fields: first name, last name, email, role (Select with "pracownik" / "moderator" options, default "employee"), password (type="password", min 8 chars)
- Uses shadcn Dialog, Input, Label, Select, Button, and `toast` from `sonner`
- Submit handler: POST body `{ first_name, last_name, email, role, password }`. On 201: `toast.success("Pracownik dodany")`, `onOpenChange(false)`, `window.location.reload()`. On error: display `error` field from response JSON below the form (do not reload)
- Loading state: disable button + show spinner during fetch

---

#### 3. Edit employee dialog

**File**: `src/components/employee/EditEmployeeDialog.tsx` (new)

**Intent**: Dialog form for updating first name, last name, and role of an existing employee.

**Contract**:
- Props: `{ open: boolean, onOpenChange: (open: boolean) => void, employee: Employee }`
- Pre-fills all fields from `employee`
- Submit: `PATCH /api/employees/${employee.id}` with only the changed fields (or all fields — simpler to send all). On 200: `toast.success("Zaktualizowano")`, close, reload. On error: display error inline.

---

#### 4. Delete confirmation dialog

**File**: `src/components/employee/DeleteConfirmDialog.tsx` (new)

**Intent**: Ask for confirmation before soft-deleting an employee. Makes it clear that absence history is preserved.

**Contract**:
- Props: `{ open: boolean, onOpenChange: (open: boolean) => void, employee: Employee }`
- Body text: `"Czy na pewno chcesz dezaktywować ${employee.first_name} ${employee.last_name}? Historyczne wpisy nieobecności zostaną zachowane."`
- Two buttons: "Anuluj" (cancel, variant outline) + "Dezaktywuj" (confirm, variant destructive)
- On confirm: `DELETE /api/employees/${employee.id}`. On 200: `toast.success("Pracownik dezaktywowany")`, close, reload. On error: display error inline.

---

#### 5. Employee management Sheet

**File**: `src/components/employee/EmployeeManagementSheet.tsx` (new)

**Intent**: Slide-over panel accessible from the dashboard showing active and deactivated employees with inline actions, and a button to add new employees. Self-contained: contains its own trigger button, sheet, and all three dialogs.

**Contract**:
- Props: `{ employees: Employee[], currentEmployee: Pick<Employee, "id" | "first_name" | "last_name" | "role"> }`
- State: `sheetOpen`, `addOpen`, `editTarget: Employee | null`, `deleteTarget: Employee | null`
- Derive: `activeEmployees = employees.filter(e => !e.deleted_at)`, `deactivatedEmployees = employees.filter(e => !!e.deleted_at)`
- Trigger button: visible when `sheetOpen` is false; label "Pracownicy" with a cog/users icon (from `lucide-react`). Styled to match the dashboard's dark header aesthetic (similar to Topbar: `bg-white/5 text-white/80 border border-white/10`)
- Sheet content:
  - Header: "Zarządzaj pracownikami" title + "Dodaj pracownika" button (opens `AddEmployeeDialog`)
  - Active employees table: columns Name, Role (badge), Actions (Edit button → opens `EditEmployeeDialog`, Dezaktywuj button → opens `DeleteConfirmDialog`)
  - Role badge: "Moderator" in purple (matching Topbar badge), "Pracownik" in gray
  - Deactivated section (shown only if `deactivatedEmployees.length > 0`): same table structure but actions column shows only "Przywróć" button
  - "Przywróć" handler: inline (no separate dialog) — calls `POST /api/employees/${id}/restore`, shows toast, reloads on 200
- Renders `AddEmployeeDialog`, `EditEmployeeDialog`, `DeleteConfirmDialog` as siblings within the Sheet, controlled by the state above

---

#### 6. Wire Sheet into dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Render the Sheet panel for moderators in the dashboard header area, passing the full employee list (including deactivated) so the panel can show both sections.

**Contract**:
- Import `EmployeeManagementSheet` from `@/components/employee/EmployeeManagementSheet`
- Pass `allEmployees` (the unfiltered array from Phase 3) and `currentEmployee` as props
- Render as a React island with `client:load` inside the existing `px-4 pt-4` wrapper div, after `<Topbar>`, conditional on `currentEmployee?.role === "moderator"`:

```astro
{currentEmployee?.role === "moderator" && (
  <EmployeeManagementSheet
    client:load
    employees={allEmployees}
    currentEmployee={currentEmployee}
  />
)}
```

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- As moderator: "Pracownicy" trigger button is visible in the header area; non-moderators do not see it
- Add employee form: fill all fields → submit → 201 → page reloads, new employee appears in grid
- Add employee with duplicate email → inline error "Konto z tym adresem email już istnieje." shown, no reload
- Edit employee: change name and role → submit → role badge updates in panel on reload
- Dezaktywuj: confirmation dialog appears with correct name and history-preservation note → confirm → employee removed from active list, appears in deactivated section
- Moderator cannot dezaktywuj themselves (button is disabled or absent for their own row)
- Przywróć: deactivated employee moves back to active section on reload
- As non-moderator: no "Pracownicy" button, no employee panel accessible

**Implementation Note**: Test each action type in sequence before marking the phase complete.

---

## Testing Strategy

### Manual Testing Steps

1. Log in as moderator, open "Pracownicy" panel — verify active vs. deactivated sections
2. Add new employee → verify they appear in current month grid column
3. Navigate to a past month → new employee's column should appear (they're active)
4. Dezaktywuj the new employee → navigate to current month → column absent; navigate to a month before deletion → column present
5. Restore the employee → re-navigate → column returns in current month
6. Try to add with duplicate email → 409 shown inline
7. Log in as the newly created employee with the temp password → confirm they can log in and see the dashboard
8. Log in as a non-moderator employee → confirm no panel trigger visible

## Migration Notes

No schema migration required. All schema prerequisites (soft-delete column, RLS policies) were implemented in F-01 migrations. Existing rows with `deleted_at IS NULL` continue to work without modification.

## References

- Related roadmap slice: `context/foundation/roadmap.md` (S-04)
- PRD: FR-007 — `context/foundation/prd.md`
- Absence form dialog pattern: `src/components/absence/AbsenceFormDialog.tsx`
- Absences API pattern: `src/pages/api/absences/index.ts`
- Dashboard page: `src/pages/dashboard.astro`
- Lessons: `context/foundation/lessons.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Infrastructure — Service Role Key + Admin Client

#### Automated

- [x] 1.1 `npm run build` passes with new env var declared
- [x] 1.2 `npm run lint` passes

#### Manual

- [x] 1.3 Dev server starts without errors after adding `SUPABASE_SERVICE_KEY` to `.dev.vars`

### Phase 2: Employee API Routes

#### Automated

- [ ] 2.1 `npm run build` passes
- [ ] 2.2 `npm run lint` passes

#### Manual

- [ ] 2.3 `POST /api/employees` (valid, moderator) → 201, auth user + employee created
- [ ] 2.4 `POST /api/employees` (duplicate email) → 409 with Polish error message
- [ ] 2.5 `POST /api/employees` (non-moderator) → 403
- [ ] 2.6 `PATCH /api/employees/:id` → 200, field updated
- [ ] 2.7 `DELETE /api/employees/:id` (other employee) → 200, `deleted_at` set
- [ ] 2.8 `DELETE /api/employees/:id` (own id) → 400
- [ ] 2.9 `POST /api/employees/:id/restore` → 200, `deleted_at` cleared

### Phase 3: Dashboard — Date-Aware Employee Fetch

#### Automated

- [ ] 3.1 `npm run build` passes
- [ ] 3.2 `npm run lint` passes

#### Manual

- [ ] 3.3 Past month grid shows deleted employee column; current month does not
- [ ] 3.4 Non-moderator sees same historically accurate past-month grid

### Phase 4: Employee Management UI

#### Automated

- [ ] 4.1 `npm run build` passes
- [ ] 4.2 `npm run lint` passes

#### Manual

- [ ] 4.3 "Pracownicy" trigger visible for moderator, absent for non-moderator
- [ ] 4.4 Add employee → page reloads, new employee in grid
- [ ] 4.5 Duplicate email → inline error, no reload
- [ ] 4.6 Edit name/role → updates on reload
- [ ] 4.7 Dezaktywuj → confirmation dialog shown, employee deactivated on confirm
- [ ] 4.8 Moderator's own row: dezaktywuj action absent or disabled
- [ ] 4.9 Przywróć → employee returns to active section
- [ ] 4.10 New employee can log in with the temp password
- [ ] 4.11 Non-moderator: no panel trigger visible
