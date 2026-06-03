---
id: deactivated-employee-grid
title: "Bugfix: historyczne nieobecności zdezaktywowanych pracowników w siatce"
status: implemented
created: 2026-06-03
updated: 2026-06-03
roadmap_id: S-08
change_type: bugfix
---

## Summary

Moderator does not see historical absences of deactivated employees in the monthly grid because the absences query unconditionally filters on `isNull(employees.deleted_at)`. The employee columns are already correctly displayed (existing `gridEmployees` filter) but the absence data is silently stripped.

## Scope

- Fix the absences JOIN condition in `dashboard.astro` and `/api/absences` to be role-conditional: moderators fetch all absences including deactivated employees'; regular employees retain the current `isNull` filter.
- Add a visual inactive indicator to deactivated employee column headers in `AbsenceGrid`.
- Make deactivated employee cells non-clickable (read-only) in the moderator grid.

## Known Limitations

- In the Yearly subcard of AbsenceDetailsSubcards, deactivated employees' absences from months outside the currently viewed month may show "—" for the employee name (gridEmployees is month-scoped). This is a separate issue to be addressed in a follow-up.
