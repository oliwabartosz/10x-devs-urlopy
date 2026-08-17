---
change_id: radial-timepicker-ux
title: Radial timepicker UX
status: archived
created: 2026-08-11
updated: 2026-08-17
archived_at: 2026-08-17T10:25:41Z
---

## Notes

Wants a radial (clock-dial) timepicker for partial-day absence hours, replacing the two
native `<input type="time">` fields in `AbsenceFormDialog`. Follows on from
`absence-hours-window`, whose on-blur clamp shipped one day earlier.

## Framing outcome (2026-08-11)

`frame.md` reframed the change. Headlines:

- **Two symptoms, disjoint causes.** "Slow/fiddly" is a _granularity_ defect (no `step`;
  60 minute-values offered, quarter hours needed). "Values get rewritten" is a _feedback_
  defect (clamp is silent; `toast` already imported and unused; server returns the
  corrected row and the client discards it at `:140-141`).
- **The radial picker is not vetoed** — reaffirmed by the user, and a quarter-hour-snapped
  dial fits the data. But it must satisfy granularity + constraint visibility + correction
  feedback, or it reproduces both symptoms in a rounder shape.
- **Precedent:** a custom control was built and reverted here in 3 minutes on 2026-06-06
  (`9fcac6f` → `876a89b`). Reason never recorded outside commit messages.
- **Blocker:** the E2E suite is red at the setup project (`e2e-auth-locators`), and
  `absence-form-dialog.spec.ts:62-88` assumes a single `HH:MM`-valued element. A control
  swap cannot be verified today.
