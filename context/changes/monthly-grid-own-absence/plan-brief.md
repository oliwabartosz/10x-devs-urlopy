# Monthly Grid — Own Absence CRUD — Plan Brief

> Full plan: `context/changes/monthly-grid-own-absence/plan.md`

## What & Why

Implement the north star slice (S-01): the monthly absence grid that replaces the placeholder `/dashboard`. An employee logs in, sees the current month's grid (days × employees, colored by absence type), and can add, edit, or delete their own absence entries. This flow is the primary success criterion of the PRD — if it works end-to-end, the core product hypothesis is proven.

## Starting Point

F-01 is complete: `employees`, `absences`, `absence_types` tables exist with RLS, and `src/types.ts` has correct TypeScript interfaces. The `/dashboard` route is a placeholder page with no real content. Auth, middleware, and the server Supabase client pattern are already in place.

## Desired End State

A logged-in employee opens `/dashboard` and sees a colored monthly grid. They click any cell in their own column to open a modal form, fill in absence type (+ optional hours, comment, substitute), and save. The page reloads and the cell appears colored. Month navigation works via Prev/Next buttons. Weekend rows are visible but dimmed. The employee's own column has a highlighted header. Errors surface as Sonner toasts.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Route | Replace `/dashboard` | The grid IS the app; dashboard is a placeholder | Plan |
| CRUD | Astro API routes (`/api/absences/*`) | Keeps anon key server-side; consistent with existing auth pattern | Plan |
| Data load | SSR → props to React island | No spinner on first paint; month change = URL param + SSR re-render | Plan |
| Cell interaction | Click → modal dialog | Single interaction model for add and edit; works on desktop | Plan |
| Month navigation | Prev/Next buttons + label | Simple, no extra component; URL param makes link shareable | Plan |
| Delete | Single click "Usuń" in edit modal | No nested confirm dialog; small team, low stakes | Plan |
| Errors | Sonner toast | User explicitly chose toast over inline error | Interview |
| Updates | Wait for server + page reload | No optimistic state needed; ground truth stays on server | Plan |
| Weekends | Visible but dimmed, non-clickable | Matches PRD guardrail: workday assumption Mon–Fri | Plan |
| Column headers | Full name, rotated 90° | Keeps columns narrow while showing full names | Interview |
| Own column | Subtle header highlight | Essential UX in a 10-person grid | Interview |
| Validation | Client-side + server toast fallback | Instant feedback for obvious errors; RLS catches the rest | Plan |

## Scope

**In scope:**
- Monthly grid view (days × employees, colored by absence type)
- Add/edit/delete own absence entries (modal form)
- Month navigation via URL param
- Weekend row dimming
- Own column highlighting
- Sonner toast for server errors
- 5 shadcn components: Dialog, Select, Input, Label, Sonner

**Out of scope:**
- Moderator editing other employees' absences (S-03)
- Employee management (S-04)
- Details table and statistics (S-02)
- Browser-side Supabase client (all DB access is server-side)
- Optimistic updates

## Architecture / Approach

Astro SSR page fetches all data (employees, absences for month, absence types, current employee record) and passes it as props to a `<AbsenceGrid client:load />` React island. The React island handles all interactivity (cell clicks, dialog, month navigation). Mutations go through three Astro API routes (`POST /api/absences`, `PATCH /api/absences/[id]`, `DELETE /api/absences/[id]`); on success the island calls `window.location.reload()` to re-run SSR and get fresh data.

Grid cell lookup uses a `Map<string, Absence>` keyed by `"${employee_id}_${date}"` for O(1) resolution. Dates are always constructed with `new Date(year, month - 1, day)` (never from ISO string parsing) to avoid UTC timezone shift bugs.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. shadcn setup | Dialog, Select, Input, Label, Sonner installed; Toaster in Layout | Version compatibility with Tailwind 4 / React 19 |
| 2. API routes | POST/PATCH/DELETE `/api/absences` with Zod validation + auth guard | PATCH for another employee's row must return 4xx, not silently succeed |
| 3. Dashboard SSR | Data-fetching page with month param parsing; graceful no-employee-record state | Month boundary math (Dec → Jan rollover, leap years) |
| 4. React components | AbsenceGrid + AbsenceFormDialog; full US-01 flow working | Grid layout: sticky column + rotated headers + weekend dimming together |

**Prerequisites:** F-01 implemented (done); local Supabase running (`npx supabase start`); `npm run build` clean before starting
**Estimated effort:** ~2-3 focused sessions across 4 phases

## Open Risks & Assumptions

- If a logged-in user has no `employees` record, they see a friendly message — not an error crash. The moderator must create employee records (S-04) before employees can use the grid. For MVP testing, a seed/manual insert is needed.
- Sonner's Tailwind 4 compatibility should be confirmed after install (`npm run build`).
- The `toLocaleDateString("sv")` trick for ISO date formatting is a well-known workaround (Swedish locale = ISO format) — no date library needed.

## Success Criteria (Summary)

- Employee logs in, sees the current month's grid, clicks their cell, adds an absence, sees it appear colored in the grid after save (PRD US-01 end-to-end)
- Clicking another employee's cell does nothing
- Wrong month in URL param renders the correct month's days
