# Employee Management — Plan Brief

> Full plan: `context/changes/employee-management/plan.md`

## What & Why

Moderators need to add, edit, and remove employees directly in the app without going to the Supabase dashboard. FR-007 requires that removing an employee never destroys their historical absence records. This is the last remaining roadmap slice before the MVP is feature-complete.

## Starting Point

The `employees` table already has a `deleted_at` soft-delete column and RLS policies for moderator writes. No employee CRUD API routes exist yet. The dashboard's employee query is hard-filtered to `deleted_at IS NULL`, which means navigating to a past month erases deleted employees from historical grids.

## Desired End State

A moderator clicks "Pracownicy" in the dashboard header, sees all active and deactivated employees in a slide-over panel, can add new ones (creating their Supabase auth account in the same action), edit name and role, soft-delete with a confirmation dialog, and restore previously deactivated employees. Past month grids correctly show employees who were active then, even if they've since been removed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| UI location | Slide-over Sheet from dashboard header | Non-standard but user-preferred; avoids a new page route | Plan |
| Add employee flow | Moderator fills name, email, role, temp password → server creates auth user | Direct creation with `auth.admin.createUser` is simplest for a team of ~10 | Plan |
| Edit scope | First name, last name, role | Role change is the most useful post-creation edit; name edits needed for corrections | Plan |
| Soft-delete | Confirmation dialog → sets `deleted_at = NOW()` | Prevents accidental deactivation; message reinforces history preservation | Plan |
| Restore | Yes — panel shows active + deactivated with restore action | Corrects mistakes without needing Supabase dashboard access | Plan |
| Historical grid accuracy | Service-role client, `deleted_at >= firstDayOfMonth` filter | Non-moderator employees can't see deleted colleagues via RLS; service role bypasses this safely server-side | Plan |
| Service role key | `SUPABASE_SERVICE_KEY` added to env schema | Required for `auth.admin.createUser` and date-aware employee queries | Plan |

## Scope

**In scope:**
- `POST /api/employees` — create auth user + employee record
- `PATCH /api/employees/[id]` — update name/role
- `DELETE /api/employees/[id]` — soft-delete (sets `deleted_at`)
- `POST /api/employees/[id]/restore` — restore
- `EmployeeManagementSheet` + Add/Edit/Delete dialogs
- Dashboard employee query updated to date-aware service-role fetch
- `src/lib/supabase-admin.ts` admin client factory

**Out of scope:**
- Hard delete of employees or auth users
- Email invite flow
- Changing an employee's email
- Soft-deleted employees' absences resolving in Details/Stats tabs (known MVP limitation)
- Any changes to absence CRUD or existing RLS policies

## Architecture / Approach

The service-role Supabase client (`createAdminClient`) is a new server-side-only primitive. It's used in two places: `POST /api/employees` (to call `auth.admin.createUser`) and `dashboard.astro` (to fetch all employees including soft-deleted, bypassing the `deleted_at IS NULL` RLS constraint). All other API routes use the session-based client and rely on the existing `employees_update_moderator` RLS policy as the final enforcement gate. The `EmployeeManagementSheet` is a self-contained React island with `client:load` that manages its own dialog state and calls the API routes; mutations reload the page to refresh server-side data.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Infrastructure | `SUPABASE_SERVICE_KEY` env var + `createAdminClient()` factory | Misconfigured service key leaks admin access — must stay server-only |
| 2. API routes | Full CRUD: create, update, soft-delete, restore | `auth.admin.createUser` error handling (duplicate email edge case) |
| 3. Dashboard fetch | Date-aware employee list; historical grid accuracy | Service-role client nullability (fallback to anon client when key absent) |
| 4. UI | Sheet panel + 3 dialogs; all mutations wired end-to-end | Astro/React island boundary — Sheet trigger is a client island, Topbar stays Astro |

**Prerequisites:** `SUPABASE_SERVICE_KEY` value from Supabase dashboard (Project Settings → API → service_role)  
**Estimated effort:** ~2 sessions across 4 phases

## Open Risks & Assumptions

- Supabase's `auth.admin.createUser` error format must be inspected to correctly detect duplicate-email errors (exact error code or message text may vary by Supabase version)
- `@supabase/supabase-js` is already a direct dependency (`^2.99.1`) — no `npm install` needed for the admin client
- shadcn Sheet is not yet installed; `npx shadcn@latest add sheet` must run before Phase 4

## Success Criteria (Summary)

- Moderator can add a new employee and that person can immediately log in with the temp password
- Soft-deleting an employee removes their grid column from future months but historical months remain accurate
- All four CRUD actions are accessible from the panel without touching the Supabase dashboard
