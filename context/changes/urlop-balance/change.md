---
change_id: urlop-balance
title: Per-employee annual vacation (urlop) day-balance tracker
status: impl_reviewed
created: 2026-06-22
updated: 2026-07-14
archived_at: null
---

## Notes

Track per-employee annual vacation (urlop) day balance. User enters entitlement from HR
(Bieżące = current-year statutory entitlement, Zaległe = carried-over days); the app counts
tracked `urlop` absences as Used and shows Left = (Bieżące + Zaległe) − Used. Per-calendar-year
record, shown as a dashboard card above the tabs, both employees and moderators can edit any
balance, and the HR provenance hint ("Do dnia: <date>") is stored as an informational date.

Research (3 Explore agents + 1 Plan agent) and the core solution-design decisions were gathered
in the originating conversation — see plan.md.
