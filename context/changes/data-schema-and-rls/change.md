---
change_id: data-schema-and-rls
title: Database schema and RLS policies for employees, absences, and absence types
status: implemented
created: 2026-05-26
updated: 2026-05-26
archived_at: null
---

## Notes

Roadmap item F-01. Creates tables `employees` (with role field + FK on `auth.users`), `absences` (type, date, hours/all-day, comment, optional substitute, FK on employees), and `absence_types` (seeded with 6 types and hex colors). Includes Supabase migrations and RLS policies: employee reads/edits own rows only, moderator reads/edits all rows, unauthenticated — no access. Soft-delete strategy for employees (field TBD in plan) must be decided here to unblock S-04.
