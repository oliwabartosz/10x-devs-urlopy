# Monthly Grid — Own Absence CRUD — Implementation Plan

## Overview

Implement the north star slice (S-01): a monthly absence grid where days are rows and employees are columns, colored by absence type. The logged-in employee can add, edit, and delete their own absence entries via a modal dialog. Data is loaded server-side (SSR) in the Astro page and passed as props to a React island; mutations go through Astro API routes.

## Current State Analysis

- F-01 is fully implemented: `employees`, `absences`, `absence_types` tables exist with RLS; `src/types.ts` has correct TypeScript types
- `/dashboard` is a placeholder page with no real content — it will be fully replaced
- `src/middleware.ts` protects `/dashboard` (auth redirect already works); attaches `user` to `context.locals`
- No browser-side Supabase client exists (and none is needed — we route all CRUD through API endpoints)
- Only `button.tsx` and `LibBadge.astro` are installed from shadcn/ui — Dialog, Select, Input, Label, Sonner must be added
- Supabase server client (`src/lib/supabase.ts`) uses server-only env vars; existing pattern is reused for all API routes and SSR data fetching

## Desired End State

A logged-in employee opens `/dashboard`, sees the current month's grid (days as rows, employees as columns). Clicking any cell in their own column opens a modal to add or edit their absence (type, full-day flag, optional hours, optional comment, optional substitute). Deleting is a single button in the edit modal. Month navigation uses Prev/Next buttons that update the `?month=` URL param and trigger an SSR re-render. Weekend rows are visible but dimmed and non-clickable. The employee's own column has a highlighted header. Toasts confirm success or surface server errors.

Verified by: the flow described in PRD US-01 works end-to-end (add → visible in grid).

### Key Discoveries

- `src/types.ts` — `Employee`, `AbsenceType`, `Absence` read-model interfaces are complete; `AbsenceInsert` and `AbsenceUpdate` DTO types must be added (see Phase 2 §0)
- `supabase/migrations/20260526000001_schema.sql:51` — `UNIQUE (employee_id, date)` enforces one absence per employee per day; the API must return a clear error when this is violated
- `supabase/migrations/20260527000001_fix_hours_check_and_moderator_select.sql:11` — `CHECK ((is_full_day AND hours IS NULL) OR (NOT is_full_day AND hours IS NOT NULL))` — biconditional: full-day rows MUST have `hours IS NULL`; partial-day rows MUST have hours set. The API must send `hours: null` explicitly when `is_full_day = true`.
- `src/pages/api/auth/signin.ts` — pattern for API routes: `export const POST: APIRoute`, `createClient(context.request.headers, context.cookies)`, redirect or Response on error
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]` already covers the route; no middleware change needed
- The grid must use `new Date(year, month - 1, day)` constructors (never parse ISO strings) to avoid UTC timezone shift bugs
- Column headers rotate 90° using CSS `writing-mode: vertical-rl; transform: rotate(180deg)` to allow narrow columns with full names

## What We're NOT Doing

- No moderator CRUD in this slice (S-03 handles that)
- No employee management (S-04)
- No details table or statistics view (S-02)
- No browser-side Supabase client — all DB access stays server-side through API routes or SSR
- No optimistic updates — page reloads after every successful mutation
- No toast for success — success is implicit from the modal closing and grid refreshing (toast only for errors)
- No delete confirmation dialog — single "Usuń" click in the edit modal is sufficient for a small team

## Implementation Approach

Four sequential phases: (1) install UI components, (2) build API routes, (3) rewrite the dashboard Astro page with SSR data fetching, (4) build the React grid and form dialog. This ordering means the React components in Phase 4 can import already-installed shadcn components and call already-built API routes.

## Critical Implementation Details

**Date construction** — always use `new Date(year, month - 1, day)` (month is 1-indexed in the UI, 0-indexed in JS). Never parse `"YYYY-MM-DD"` strings directly to a Date object for local-date logic — that creates a UTC Date which shifts by one day in timezones behind UTC.

**Absence map for O(1) cell lookup** — build `Map<string, Absence>` keyed by `"${employee_id}_${date}"` where `date` is the `"YYYY-MM-DD"` string from the DB. Cell render calls `absenceMap.get(key)` rather than iterating absences.

**Hours field conditional visibility** — `is_full_day` defaults to `true`; the hours `<Input>` is rendered only when `is_full_day = false`. The Save button is disabled until: absence type is selected AND (is_full_day is true OR hours > 0).

**API route auth pattern** — read `context.locals.user` (already resolved by middleware before the route runs) and return 401 if null. Do NOT call `supabase.auth.getUser()` again — it is a redundant extra round-trip. RLS in the DB is the enforcement layer; the locals check is a fast-fail guard.

**`prerender` exports not needed** — the project uses `output: "server"` globally; all routes are server-rendered by default.

---

## Phase 1: UI Component Setup

### Overview

Install the five shadcn/ui components needed by the form dialog and notification system. Add the Sonner `<Toaster />` to the global layout so toasts render on every page.

### Changes Required

#### 1. Install shadcn components

**File**: (CLI commands, no file to edit directly)

**Intent**: Add Dialog, Select, Input, Label, and Sonner to `src/components/ui/`. The `npx shadcn@latest add` command writes the component files, installs any required Radix/Sonner npm packages, and updates `package.json` automatically.

**Contract**: Run in project root:
```bash
npx shadcn@latest add dialog
npx shadcn@latest add select
npx shadcn@latest add input
npx shadcn@latest add label
npx shadcn@latest add sonner
```

All five components should appear in `src/components/ui/` after this step.

#### 2. Add Toaster to Layout

**File**: `src/layouts/Layout.astro`

**Intent**: Mount the Sonner `<Toaster />` React component at the layout level so toasts are available on every page, including the dashboard.

**Contract**: Import `Toaster` from `@/components/ui/sonner` and render it as a React island (`client:load`) just before `</body>`. The Toaster needs no props for default configuration (bottom-right position, auto-dismiss).

### Success Criteria

#### Automated Verification

- `npm run build` completes without TypeScript errors after install
- `npm run lint` passes
- All five component files exist in `src/components/ui/`

#### Manual Verification

- No console errors on `/dashboard` after adding `<Toaster />`

**Implementation Note**: Run `npm run build` after each `npx shadcn@latest add` call to catch any version incompatibility early. Sonner requires the `sonner` npm package — shadcn installs it automatically.

---

## Phase 2: API Routes for Absence CRUD

### Overview

Three API routes handle all absence mutations. The server Supabase client enforces auth; RLS in the DB enforces ownership. All routes use Zod for input validation and return JSON `{ error: string }` on failure.

### Prerequisites

Install Zod before writing any route code — it is not yet in `package.json`:

```bash
npm install zod
```

### Changes Required

#### 0. Add DTO types to src/types.ts

**File**: `src/types.ts`

**Intent**: Add insert and update DTO types alongside the existing read-model interfaces so API routes can use Supabase generics without implicit-any errors under strict mode.

**Contract**: Append two exported types after the existing `Absence` interface:
- `AbsenceInsert` — all required fields for INSERT (omit `id`, `created_at`, `updated_at`); `hours`, `comment`, `substitute_employee_id` nullable
- `AbsenceUpdate` — `Partial<AbsenceInsert>` — all fields optional for PATCH

#### 1. POST /api/absences — create absence

**File**: `src/pages/api/absences/index.ts`

**Intent**: Accept a JSON body, look up the authenticated user's employee record, and insert a new absence row. Return the inserted row on success or a JSON error on failure.

**Contract**:
- Export `POST: APIRoute`
- Auth guard: read `context.locals.user` → 401 JSON if null (middleware already resolved it; no second `supabase.auth.getUser()` call)
- Employee lookup: `SELECT id FROM employees WHERE user_id = context.locals.user.id AND deleted_at IS NULL` → 403 if not found
- Zod schema `AbsenceCreateSchema`: `{ absence_type_id: z.number().int().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), is_full_day: z.boolean(), hours: z.number().positive().nullable(), comment: z.string().nullable(), substitute_employee_id: z.string().uuid().nullable() }`
- On success: `return new Response(JSON.stringify(data), { status: 201, headers: { "Content-Type": "application/json" } })`
- On DB error: `return new Response(JSON.stringify({ error: error.message }), { status: 400, ... })`
- The `employee_id` is always taken from the server-side lookup, never from the request body

#### 2. PATCH /api/absences/[id] — update absence

**File**: `src/pages/api/absences/[id].ts`

**Intent**: Update an existing absence by ID. RLS blocks the update if the authenticated user is not the owner (or moderator).

**Contract**:
- Export `PATCH: APIRoute` and `DELETE: APIRoute` in the same file
- For PATCH: Zod schema `AbsenceUpdateSchema` — same fields as create but all optional (use `.partial()`)
- `.update(parsed.data).eq("id", context.params.id)` — distinguish two failure cases: `error.code === "42501"` (RLS violation) → 403; `data` empty + `error` null (row not found) → 404
- Return updated row on success, JSON error on failure

#### 3. DELETE /api/absences/[id] — delete absence

**File**: `src/pages/api/absences/[id].ts` (same file as PATCH)

**Intent**: Delete an absence by ID. RLS blocks deletion if not owner or moderator.

**Contract**:
- Export `DELETE: APIRoute` alongside `PATCH` in the same file
- `.delete().eq("id", context.params.id)` — RLS enforces ownership
- Return `204 No Content` on success, JSON error on failure

### Success Criteria

#### Automated Verification

- `npm run build` passes (TypeScript compiles all three exports)
- `npm run lint` passes

#### Manual Verification

- POST `/api/absences` with valid body as an authenticated employee → 201, row inserted
- POST `/api/absences` unauthenticated → 401
- PATCH `/api/absences/:id` as the owning employee → 200, row updated
- PATCH `/api/absences/:id` for another employee's absence (as non-moderator) → RLS blocks, 4xx returned
- DELETE `/api/absences/:id` as owner → 204
- POST with `is_full_day: false` and `hours: null` → 400 from DB constraint

**Implementation Note**: Test the RLS-blocked PATCH case manually using two different logged-in sessions. The DB will return a Supabase error with code `42501` (RLS violation) or an empty update result — map both to 403.

---

## Phase 3: Dashboard Astro Page — SSR Data Fetching

### Overview

Rewrite `src/pages/dashboard.astro` to fetch all data needed by the grid and render the React island as a server-side shell. The month is read from the `?month=YYYY-MM` URL param; missing param defaults to the current month.

### Changes Required

#### 1. Rewrite dashboard.astro

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the placeholder dashboard with an SSR page that fetches grid data and renders the `AbsenceGrid` React island.

**Contract**: The frontmatter (`---` block) must:

1. Import `createClient` from `@/lib/supabase`, `AbsenceGrid` from `@/components/absence/AbsenceGrid`, `Topbar` from `@/components/Topbar.astro`, and the types from `@/types`. Render `<Topbar />` at the top of the template (above the grid) so the user has a sign-out button and their email displayed.

2. Parse month param:
   ```ts
   const monthParam = Astro.url.searchParams.get("month"); // "YYYY-MM" or null
   const now = new Date();
   const year = monthParam ? parseInt(monthParam.split("-")[0]) : now.getFullYear();
   const month = monthParam ? parseInt(monthParam.split("-")[1]) : now.getMonth() + 1;
   // month is 1-indexed throughout (matches URL param and Postgres DATE month)
   ```

3. Supabase client: `const supabase = createClient(Astro.request.headers, Astro.cookies)` — guard with redirect if null

4. Fetch current employee record (the logged-in user's row):
   ```ts
   const { data: currentEmployee } = await supabase
     .from("employees")
     .select("*")
     .eq("user_id", Astro.locals.user!.id)
     .is("deleted_at", null)
     .single();
   ```
   If `currentEmployee` is null, render a friendly message ("Twoje konto nie jest jeszcze powiązane z kontem pracownika. Skontaktuj się z moderatorem.") and stop rendering the grid.

5. Build month range strings (used in the absences query):
   ```ts
   const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
   const nextMonthDate = new Date(year, month, 1); // JS month overflow handles Dec→Jan correctly
   const firstDayNextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
   ```

6. Three parallel fetches:
   - All active employees: `.from("employees").select("*").is("deleted_at", null).order("last_name").order("first_name")`
   - Absences for month: `.from("absences").select("*").gte("date", firstDay).lt("date", firstDayNextMonth)`
   - Absence types: `.from("absence_types").select("*").order("id")`

7. Template renders `<AbsenceGrid client:load ... />` with props: `employees`, `absences`, `absenceTypes`, `currentEmployee`, `year`, `month`

8. Prev/next month URLs are computed in Astro (not React) for `<AbsenceGrid>` prop:
   ```ts
   const prevMonth = new Date(year, month - 2, 1); // month-2 because month is 1-indexed
   const nextMonth = new Date(year, month, 1);
   const prevMonthUrl = `?month=${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
   const nextMonthUrl = `?month=${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
   ```
   Pass `prevMonthUrl` and `nextMonthUrl` as props to the React island.

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- `/dashboard` without a `?month=` param shows the current month
- `/dashboard?month=2026-03` shows March 2026
- A user with no employee record sees the friendly message instead of the grid
- All four data sets (employees, absences, types, current employee) are passed as non-null props to the grid

**Implementation Note**: The three parallel fetches can use `Promise.all()` for speed, but each must be `await`ed before the component renders. If Supabase returns an error on any fetch, log and render a graceful error state rather than crashing.

---

## Phase 4: React Components — Grid and Form Dialog

### Overview

Two React components make up the interactive layer: `AbsenceGrid` (the table) and `AbsenceFormDialog` (the modal form). Both live in `src/components/absence/`. The grid is the top-level React island; the dialog is a child rendered inside the grid.

### Changes Required

#### 1. AbsenceGrid component

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Render the monthly absence grid as a scrollable table with a sticky day column. Handle month navigation and open the form dialog on cell click.

**Contract**:

Props interface:
```ts
interface AbsenceGridProps {
  employees: Employee[];
  absences: Absence[];
  absenceTypes: AbsenceType[];
  currentEmployee: Employee;
  year: number;
  month: number; // 1-indexed
  prevMonthUrl: string;
  nextMonthUrl: string;
}
```

Key implementation points:
- Generate days array: `getDaysInMonth(year, month)` returns `Date[]` using the `new Date(year, month - 1, day)` constructor pattern (documented in Critical Implementation Details)
- Build absence lookup map: `Map<string, Absence>` keyed by `"${employee_id}_${dateStr}"` where `dateStr` is `date.toLocaleDateString("sv")` (ISO format, locale-safe alternative to string manipulation)
- Weekend detection: `date.getDay() === 0 || date.getDay() === 6`
- Table structure: `<div class="overflow-x-auto">` wrapping a `<table>`. Day column uses `sticky left-0 z-10 bg-white` (or the equivalent Tailwind classes). Column min-width: `min-w-[100px]` per employee column
- Column headers: employee full name rendered with Tailwind `[writing-mode:vertical-rl] rotate-180 py-2 whitespace-nowrap` on the `<th>` inner span. Own column header gets a distinct background (e.g., `bg-blue-50` vs `bg-gray-50`)
- Weekend row: entire `<tr>` gets `bg-gray-100 cursor-default`; cells are not clickable
- Absence cell: colored `<div>` with background set to `absenceType.color` if an absence exists; empty cell shows a faint "+" or empty state. Clickable cells for the employee's own column only — other employees' cells are not clickable (S-01 scope: own entries only)
- Month navigation header: `<button onClick={() => window.location.href = prevMonthUrl}>‹</button>` + month label + next button. The label format: Polish locale month name + year, e.g., "Maj 2026", derived with `new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(new Date(year, month - 1))`
- Dialog state: `useState<{ day: Date; absence: Absence | null } | null>(null)` — null = dialog closed; non-null = dialog open with that day and optional existing absence

#### 2. AbsenceFormDialog component

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: A controlled Dialog that provides the add/edit/delete form for a single absence entry. Uses the API routes for mutations. Shows Sonner toasts on error; reloads the page on success.

**Contract**:

Props interface:
```ts
interface AbsenceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date;
  existingAbsence: Absence | null; // null = add mode, non-null = edit mode
  absenceTypes: AbsenceType[];
  employees: Employee[]; // for substitute selector
  currentEmployee: Employee;
}
```

Form state (all controlled):
- `absenceTypeId: number | null` — initialized from `existingAbsence?.absence_type_id ?? null`
- `isFullDay: boolean` — initialized from `existingAbsence?.is_full_day ?? true`
- `hours: string` — string for the input, convert to number on submit; initialized from `existingAbsence?.hours?.toString() ?? ""`
- `comment: string` — initialized from `existingAbsence?.comment ?? ""`
- `substituteEmployeeId: string | null` — initialized from `existingAbsence?.substitute_employee_id ?? null`
- `isSubmitting: boolean` — true while fetch is in flight (disables buttons)

Save button disabled when: `absenceTypeId === null || isSubmitting || (!isFullDay && (!hours || parseFloat(hours) <= 0))`

Hours `<Input>` is rendered only when `!isFullDay` (conditional rendering, not just hidden).

**Add flow** (existingAbsence === null):
```ts
const dateStr = day.toLocaleDateString("sv"); // "YYYY-MM-DD" in local time
const res = await fetch("/api/absences", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ absence_type_id: absenceTypeId, date: dateStr, is_full_day: isFullDay, hours: isFullDay ? null : parseFloat(hours), comment: comment || null, substitute_employee_id: substituteEmployeeId }),
});
```

**Edit flow** (existingAbsence !== null): same fields, `PATCH /api/absences/${existingAbsence.id}`

**Delete flow**: `DELETE /api/absences/${existingAbsence.id}` — no body

On any 2xx response: `window.location.reload()`

On non-2xx response:
```ts
const body = await res.json();
toast.error(body.error ?? "Nie udało się zapisać. Spróbuj ponownie.");
```

Import `toast` from `sonner` (not from shadcn wrapper — call directly).

Dialog title: "Dodaj nieobecność" (add mode) or "Edytuj nieobecność" (edit mode).

The date heading inside the dialog shows: `day.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })` — e.g., "poniedziałek, 4 maja".

Usuń button: only rendered in edit mode; red/destructive variant; calls delete flow.

### Success Criteria

#### Automated Verification

- `npm run build` passes (no TypeScript errors in new components)
- `npm run lint` passes

#### Manual Verification

- Opening `/dashboard` shows the current month's grid with correct day count and correct weekday labels
- Weekend rows are visually distinct and cells are not clickable
- The logged-in employee's column header is visually highlighted
- Clicking an empty cell in own column opens "Dodaj nieobecność" dialog with correct date
- Filling the form (type = urlop, full day) and saving: dialog closes, page reloads, absence appears in the grid with the correct color
- Clicking an existing absence cell opens "Edytuj nieobecność" with pre-filled values
- Editing the type and saving: grid reflects the change after reload
- Clicking "Usuń" on an existing absence: it disappears from the grid
- Attempting to add a second absence on the same day: server returns unique-constraint error, toast shows
- Toggling "Cały dzień" off shows the hours input; re-toggling on hides it
- Prev/next navigation buttons change the month and the grid re-renders with correct days
- Clicking another employee's cell does nothing (non-clickable)
- Toast error appears when the server returns a 4xx

**Implementation Note**: After Phase 4 is implemented but before marking done, run `npm run dev` and manually walk through the full US-01 flow: log in → see grid → add absence → see it in grid. This is the north star verification and is the most important manual test in this change.

---

## Testing Strategy

### Manual Testing Steps

1. `npx supabase start` (local DB running)
2. `npm run build && npm run dev`
3. Sign in as a test user who has an employee record
4. Open `/dashboard` — confirm current month grid renders with all employees as columns
5. Click empty cell in own column → add form appears with correct date → fill type "urlop" + full day → save → grid shows green cell
6. Click the green cell → edit form appears pre-filled → change type → save → grid updates
7. Click the cell again → click "Usuń" → cell clears
8. Toggle "Cały dzień" off → hours field appears → enter 4 → save → confirm DB row has `is_full_day=false, hours=4`
9. Navigate to previous month → grid shows correct days
10. Sign in as a second employee → confirm their column is highlighted → confirm they cannot interact with first employee's cells

### Automated Verification

- `npm run build` — TypeScript compilation gate for all four phases
- `npm run lint` — ESLint + Prettier gate

## Performance Considerations

~10 employees × ~31 days = ~310 cells per render. No virtualization needed. The absence lookup map ensures O(1) cell resolution. The page reload after save adds ~300–500ms — acceptable for a small team app where saves are infrequent.

## Migration Notes

No new migrations in this slice — F-01 provided all schema. No data migration needed.

## References

- PRD: `context/foundation/prd.md` — FR-001, FR-002, FR-004, US-01
- Roadmap: `context/foundation/roadmap.md` — S-01, Risk note on grid layout
- Foundation schema: `supabase/migrations/20260526000001_schema.sql`
- Types: `src/types.ts`
- Supabase client (server): `src/lib/supabase.ts`
- Existing API route pattern: `src/pages/api/auth/signin.ts`
- Existing layout: `src/layouts/Layout.astro`
- CLAUDE.md — `npm run dev` requires `npm run build` first; `wrangler dev` for local

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: UI Component Setup

#### Automated

- [x] 1.1 `npm run build` passes after all shadcn installs — 48312f7
- [x] 1.2 `npm run lint` passes — 48312f7
- [x] 1.3 All five component files exist in `src/components/ui/` — 48312f7

#### Manual

- [x] 1.4 No console errors on `/dashboard` after adding `<Toaster />` — 48312f7

### Phase 2: API Routes for Absence CRUD

#### Automated

- [x] 2.1 `npm run build` passes (TypeScript compiles all three route exports)
- [x] 2.2 `npm run lint` passes

#### Manual

- [x] 2.3 POST `/api/absences` with valid body as authenticated employee → 201
- [x] 2.4 POST unauthenticated → 401
- [x] 2.5 PATCH as owner → 200
- [x] 2.6 PATCH for another employee's absence → 4xx (RLS blocked)
- [x] 2.7 DELETE as owner → 204
- [x] 2.8 POST with `is_full_day: false` and `hours: null` → 400

### Phase 3: Dashboard Astro Page — SSR Data Fetching

#### Automated

- [ ] 3.1 `npm run build` passes
- [ ] 3.2 `npm run lint` passes

#### Manual

- [ ] 3.3 `/dashboard` without param shows current month
- [ ] 3.4 `/dashboard?month=2026-03` shows March 2026
- [ ] 3.5 User with no employee record sees friendly message

### Phase 4: React Components — Grid and Form Dialog

#### Automated

- [ ] 4.1 `npm run build` passes
- [ ] 4.2 `npm run lint` passes

#### Manual

- [ ] 4.3 Grid renders correct day count and weekday labels for current month
- [ ] 4.4 Weekend rows are dimmed and non-clickable
- [ ] 4.5 Own column header is visually highlighted
- [ ] 4.6 Clicking empty cell in own column opens "Dodaj nieobecność" with correct date
- [ ] 4.7 Save absence → dialog closes, page reloads, colored cell appears in grid
- [ ] 4.8 Click existing absence → edit form opens with pre-filled values
- [ ] 4.9 Edit and save → grid reflects change
- [ ] 4.10 Delete absence → cell clears
- [ ] 4.11 Duplicate absence on same day → toast error appears
- [ ] 4.12 Hours input visible only when "Cały dzień" is unchecked
- [ ] 4.13 Prev/next month navigation works correctly
- [ ] 4.14 Other employees' cells are non-clickable
- [ ] 4.15 End-to-end US-01 flow: log in → add absence → visible in grid
