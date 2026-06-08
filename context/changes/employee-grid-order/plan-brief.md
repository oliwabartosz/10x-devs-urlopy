# Employee Grid Order — Plan Brief

> Full plan: `context/changes/employee-grid-order/plan.md`

## What & Why

Moderators currently can't control the order of employee columns in the monthly grid — columns are always alphabetical. S-07 adds a drag-and-drop interface so moderators can set a persistent `display_order` that all users see. An extra UX rule was decided during planning: every user (employee and moderator alike) always sees themselves as the first column.

## Starting Point

The `employees` table has no `display_order` column; ordering is hardcoded to `last_name ASC, first_name ASC` in both `dashboard.astro` and `GET /api/employees`. `AbsenceGrid` iterates the `employees` prop directly with no client-side reordering. `@dnd-kit` is not installed.

## Desired End State

Moderator opens the monthly grid, sees drag handles (≡) on every non-self active column, and drags them into a preferred order. That order persists across reloads and is visible to all users in the Grid, Details, and Stats tabs — each user still sees themselves first. Inactive (deactivated) columns float to the end and can be reordered among themselves. New employees are added at the end of the active section.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Self-first override | All users (employee + moderator) | Consistent UX — everyone sees their own column first regardless of role. | Plan (conversation) |
| Inactive employee position | Always float to end of list | Cleaner moderator view: active staff appears before greyed-out inactive columns. | Plan |
| New employee placement | `MAX(display_order) + 1` on INSERT | Non-disruptive — existing order unchanged, new hire appears at the end until reordered. | Plan |
| DnD approach | In-grid drag with DragOverlay only | Matches roadmap spec; table `<th>` elements don't support CSS transform, so overlay-only is the correct pattern. | Plan |
| Save failure UX | `toast.error` + revert to pre-drag order | Matches existing toast pattern in `EmployeeManagementSheet`; prevents silent data loss. | Plan |
| Scope | Grid + Details + Stats (all tabs) | Same `gridEmployees` array is passed to all three — zero extra cost to cover all tabs. | Plan |
| Inactive drag | Draggable within inactive section | Moderator can pre-set restoration order; cross-group drops silently rejected. | Plan |

## Scope

**In scope:**
- `display_order` column on `employees` table + seeded migration
- `PATCH /api/employees/order` endpoint (moderator-only)
- Dashboard query ordering (active-first for moderator, `display_order` sort for employees)
- `AbsenceGrid` DnD with `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

**Out of scope:**
- Reorder UI in `EmployeeManagementSheet`
- Any changes to `GET /api/employees` ordering (sheet doesn't need it)
- RLS changes
- E2E tests (separate phase)

## Architecture / Approach

`display_order` is stored in the `employees` table and delivered pre-sorted from the server. The client applies one additional override: current user is moved to index 0 (`selfFirst` helper). For moderators, `AbsenceGrid` wraps header cells in two `SortableContext`s (active group / inactive group) inside one `DndContext`. Drag feedback is provided via `DragOverlay` only (table layout blocks CSS `transform` on `<th>`). On drop, state updates optimistically and a `PATCH` fires; failure triggers `toast.error` + revert.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Schema + Migration | `display_order` column seeded from alphabetical rank; new employees land at end | Migration seeding UPDATE must be manually appended after `db:generate` |
| 2. API endpoint | `PATCH /api/employees/order` — moderator-only bulk update | Low — follows existing `[id].ts` pattern exactly |
| 3. Dashboard query | Server delivers employees in correct order to all components | Requires `sql` helper import for active-first CASE expression |
| 4. Grid DnD | Full drag-and-drop in the grid with DragOverlay, two SortableContexts, toast revert | `transform` must NOT be applied to `<th>`; closure capture for revert state |

**Prerequisites:** Phase 1 must complete (DB column exists) before Phases 2–4 are verifiable end-to-end. Phases 2, 3, 4 are otherwise independent and could be worked in parallel.

**Estimated effort:** ~1 session (4 focused phases, each verifiable independently).

## Open Risks & Assumptions

- `TOCTOU` on `MAX(display_order)` in POST — two simultaneous employee creations could collide on `display_order`. Acceptable for a ~10-person team; `display_order` is a sort hint, not a uniqueness constraint.
- `@dnd-kit` adds ~30 KB gzipped to the client bundle. The grid is already a React island (`client:load`) so this is additive but constrained to users who load the dashboard.
- Drag UX on mobile (touch events) is untested — `PointerSensor` handles touch but the narrow column headers may be hard to grab on small screens.

## Success Criteria (Summary)

- Moderator drags a column in the grid → order persists on reload and is visible to all users.
- Every user sees themselves first; inactive columns float to end.
- Offline drag shows `toast.error` and reverts — no silent data loss.
