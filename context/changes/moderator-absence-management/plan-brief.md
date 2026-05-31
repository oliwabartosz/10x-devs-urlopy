# Moderator Absence Management — Plan Brief

> Full plan: `context/changes/moderator-absence-management/plan.md`

## What & Why

Moderators need to add, edit, and delete absence entries for any employee — not just their own. The PRD (FR-003) lists this as must-have. The RLS policies from F-01 already grant moderators full DB-level access to `absences`; this slice wires that permission into the API and UI.

## Starting Point

S-01 delivered a working absence grid where employees can manage their own entries. The DB-level moderator permissions are already in place. The only gates remaining are in application code: the POST API hardcodes the caller's own `employee_id`, and the grid restricts cell clicks to the user's own column.

## Desired End State

A moderator opens the dashboard, sees all non-weekend cells as clickable, and can open the form dialog for any employee's cell. The dialog names the employee being edited. The moderator can create, update, and delete absences for anyone. A "Moderator" badge appears in the Topbar. Employees' experience is unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| employee_id in POST body | Optional UUID field; server validates existence | Same endpoint, minimal change; RLS + role check guards abuse | Plan |
| Non-moderator POST | Always uses server-side lookup; body field ignored | Prevents privilege escalation even if a client sends the field | Plan |
| Dialog employee name | Shown as subtitle when target ≠ caller | Prevents accidental edits on the wrong row | Plan |
| Substitute filter | Excludes targetEmployee, not currentEmployee | Substitute must cover the absent person, not the editor | Plan |
| Moderator badge | "Moderator" chip in Topbar | Communicates elevated permissions; user requested explicit signal | User |
| No new migrations | RLS already correct from F-01 | get_user_role() moderator policies cover INSERT/UPDATE/DELETE | Plan |

## Scope

**In scope:**
- POST API: moderator-provided `employee_id` override with active-employee validation
- AbsenceGrid: unlock all non-weekend cells for moderators
- AbsenceFormDialog: `targetEmployee` prop, employee name in header, correct substitute filter, `employee_id` in POST body
- Topbar: "Moderator" badge (chip) next to email

**Out of scope:**
- PATCH/DELETE API changes (RLS already handles them)
- Audit trail / created-by tracking
- Employee management (S-04)
- Visual distinction between moderator-edited vs self-edited cells

## Architecture / Approach

No new components. Four small, targeted changes to existing files in backend → UI order. The API change (Phase 1) is independent and can be verified before touching the UI. Phases 2+3 (Grid + Dialog) are coupled through the `targetEmployee` prop but touch separate files. Phase 4 (Topbar) is independent.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. API POST override | Moderators can create absences for other employees | Role check must be server-side — client must never control ownership for non-moderators |
| 2. AbsenceGrid unlock | All non-weekend cells clickable for moderators | None — single condition change |
| 3. AbsenceFormDialog update | Correct target employee UX + POST body | Substitute filter bug if targetEmployee not used |
| 4. Topbar badge | Moderator role visually communicated | None — optional prop with graceful fallback |

**Prerequisites:** S-01 and F-01 complete (both done). Local Supabase running with at least one moderator and one employee user for manual testing.

**Estimated effort:** ~1 session across 4 short phases.

## Open Risks & Assumptions

- The `currentEmployee` select in `dashboard.astro` already includes `role` — confirmed in research. If this changes, Phase 4 will fail silently (no badge shown).
- PATCH/DELETE moderator paths rely entirely on RLS — this was tested in S-01 (step 2.6 confirmed RLS blocks non-owner PATCH). If those tests were not run against the current DB state, re-verify before shipping.

## Success Criteria (Summary)

- A moderator can click any non-weekend cell, create/edit/delete the absence, and see the change reflected in the grid
- A moderator sees the target employee's name in the dialog when editing another's row
- The "Moderator" badge appears in the Topbar for moderator users only
