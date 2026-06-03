# Deactivated Employee Grid — Plan Brief

> Full plan: `context/changes/deactivated-employee-grid/plan.md`

## What & Why

Fix a bug where historical absences of deactivated employees are invisible to moderators in the monthly grid, Details, and Stats tabs. The bug surface is a single over-broad `isNull(employees.deleted_at)` join predicate in two query sites — it silently strips all absence rows for any employee whose account has been deactivated, regardless of whether those absences predate the deactivation.

## Starting Point

The `gridEmployees` filter in `dashboard.astro:105–112` already correctly includes deactivated employees in the grid (showing their columns if they were active during the viewed month). The query that fetches the absence data, however, unconditionally excludes their rows via the join condition, leaving those columns empty.

## Desired End State

A moderator navigating to any historical month where a now-deactivated employee was active sees their absence cells colored as usual. Deactivated employee columns are visually distinct (gray header + "(nakt.)" suffix) and non-clickable — read-only display only. Regular employees see no change.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Role-conditional join predicate | Moderators skip `isNull`; regular employees keep it | Regular employees have no deactivated columns — including their absences would produce orphaned "—" rows in Details | Plan |
| Column visual indicator | Gray background + "(nakt.)" suffix | Prevents moderator confusion about why cells aren't clickable | Plan |
| Cell clickability | Deactivated cells block click | Prevents adding absences to a deactivated employee | Plan |
| Fix scope | All tabs (grid + details + stats) | Absences prop is shared; fixing the query is consistent across all views at no extra cost | Plan |
| Yearly subcard name resolution | Out of scope (known limitation) | gridEmployees is month-scoped; fixing yearly requires broader changes — separate follow-up | Plan |

## Scope

**In scope:**
- `dashboard.astro` absences query: role-conditional join predicate
- `/api/absences` GET handler: same fix (serves today/yearly subcards)
- `AbsenceGrid.tsx`: gray column header + "(nakt.)" suffix + non-clickable cells for deactivated employees

**Out of scope:**
- Yearly subcard employee name resolution (deactivated employees' names may show "—" in the yearly view)
- Adding/editing absences for deactivated employees
- Schema or RLS changes
- Any change to regular employee behavior

## Architecture / Approach

Two query sites use `innerJoin(employees, and(eq(absences.employee_id, employees.id), isNull(employees.deleted_at)))`. The fix computes the join predicate conditionally based on `currentEmployee.role` (dashboard) / `employeeRow.role` (API route) — moderators drop the `isNull` guard, regular employees keep it. The grid component then gets a truthiness check on `emp.deleted_at` (already in the `Employee` type via Drizzle `$inferSelect`) to drive the visual indicator and clickability guard.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Fix Absences Query | Absence data flows for deactivated employees (moderator role) | None — one-line predicate change in 2 files |
| 2. Grid Visual Indicator | Gray column header + "(nakt.)" + non-clickable cells | None — purely additive UI change |

**Prerequisites:** S-03 (moderator grid), S-04 (employee deactivation logic) — both done.  
**Estimated effort:** ~1 session, 2 short phases.

## Open Risks & Assumptions

- Yearly subcard: deactivated employees' absences from other months will show "—" for the name until a follow-up fix. This is a cosmetic issue, not a data integrity one.
- `Employee.deleted_at` is serialized as an ISO string by Astro when passed to React islands — the check `!!emp.deleted_at` handles both `Date` and `string` correctly.

## Success Criteria (Summary)

- Moderator viewing a historical month sees filled absence cells for deactivated employees who were active that month.
- Deactivated columns are visually distinct (gray + "(nakt.)") and non-clickable.
- Regular employee view is unchanged.
