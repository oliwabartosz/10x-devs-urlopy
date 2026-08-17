---
change_id: absence-hours-window
title: Bound partial-day absence ranges (max 8h, start from 06:00)
created: 2026-08-07
status: impl_reviewed
updated: 2026-08-17
archived_at: null
---

## Notes

Raised during S-17 (`huge-ui-ux-improvement`) manual verification, row 8.3.

Partial-day absences currently accept any time range the browser's `<input type="time">`
will produce. They should be restricted to **07:15–23:59**.

Only the two training types may be partial-day at all
(`src/lib/absence-types.ts`, enforced server-side by
`src/lib/services/absence-partial-day.ts`), so this window applies to exactly those rows.

Open questions the plan must answer before any code:

- **Where does the rule live?** `min`/`max` on the inputs is a hint, not enforcement — a
  crafted request bypasses it. The existing partial-day rule is enforced in
  `POST`/`PATCH /api/absences` via a shared service, and this should follow that shape
  rather than living only in `AbsenceFormDialog`.
- **What about existing rows outside the window?** A `PATCH` that doesn't touch the times
  must not start failing on data that was legal when it was written. Decide between
  grandfathering, a migration, or validating only changed values.
- **Is there also a DB-level CHECK?** `absences_time_check` already exists and is invisible
  to drizzle-kit (`AGENTS.md`) — adding a second constraint means the same care.
- **Why 07:15?** Recording the reason matters more than the number; the next person will
  ask, and the seed data has absences starting at 01:22.

Should also confirm the existing `end_time > start_time` rule still holds and whether a
range may cross midnight now that 23:59 is the ceiling.

## Framing outcome (2026-08-10)

The notes above are preserved as originally written. `frame.md` reframed the change;
the open questions are answered there:

- **Where does the rule live?** Client *and* server, both clamping. Server validation
  already exists (`index.ts:145-154`, `[id].ts:27-39`) — the gap was bounds, not layer.
- **Existing rows?** Purge the two junk rows; all six survivors already comply. No
  backfill, no grandfathering.
- **DB-level CHECK?** Open — with server-side clamping it would only backstop direct
  DB writes. Decide against the hand-re-add discipline it costs.
- **Why 07:15?** Superseded: the floor is **06:00**, and its source still needs writing
  down. The cited "seed data at 01:22" traced to design-mockup dummy data.
- **Cross midnight?** No — `absences_time_check` already forbids it; 23:59 was never
  reachable and is dropped as a rule.

Scope is now: max 8 h duration (clamped) + start ≥ 06:00 (clamped) + a two-row purge.
