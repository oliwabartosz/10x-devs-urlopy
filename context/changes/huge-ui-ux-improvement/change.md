---
change_id: huge-ui-ux-improvement
title: Adopt the new-design HTML/JS prototype as the app's UI/UX
status: impl_reviewed
created: 2026-08-07
updated: 2026-08-11
archived_at: null
---

## Notes

This new task takes @new-design/ html and js and implements the ui, ux and some functional improvements

## Closing notes (2026-08-10)

All 8 phases implemented; all 80 Progress rows confirmed. Two rows closed with their wording
superseded by what shipped — recorded here so a later reader does not read drift:

**Row 5.3** ("`Wyczyść filtry` restores all types") describes the one-way control the plan
specified. What shipped (`8b25781`) is a two-state toggle: `Wyczyść filtry` hides every type
while nothing is hidden, `Zaznacz wszystkie` restores while anything is. This is an
improvement on the plan, not a miss — the plan's own rule left the all-hidden state
unescapable, which is the trap it flagged in the prototype (`plan.md`, Phase 5 §1). The
"active only while something is hidden" half of the row still holds, driven by
`isFilterActive()` (`src/lib/type-filter.ts:44`).

**Row 7.6** passes as specified — a moderator does get `Korekta` and `Do dnia`, saving
correctly, on their own balance. The *design* is superseded. Manual verification raised four
follow-on requirements, all of which route to
`context/changes/holiday-balance-valid-until` rather than reopening this change:

1. A moderator should edit **every** employee's balance from the `Pracownicy` panel, not only
   their own. `HolidayBalanceCard` is hard-wired to `currentEmployee.id`
   (`src/pages/dashboard.astro:233`), so no such UI path exists today.
2. `Korekta` / `Do dnia` should therefore leave the balance card's `Edytuj` entirely.
3. `Do dnia` should not be shown to non-moderators — reversing this plan's explicit
   "`valid_until` is **not** gated" (Phase 7 §3), which itself narrowed S-15.
4. `Do dnia` should be derived, not typed.

(1) and (2) are the relocation this plan deferred as coupled to the batch-balance endpoint
(`plan.md`, What We're NOT Doing). (3) and (4) are that change folder's stated purpose.

**Product question answered during this pass:** `Do dnia` derives to **31 December of the
balance year** — 2026 → `2026-12-31`, rolling to `2027-12-31` on 1 January 2027. This
confirms the assumption already written into the follow-up's `change.md` and rules out both
the Polish carryover-law date (30 September of the following year) and an end-of-current-month
reading. The follow-up's remaining framing questions — derived vs stored, whether a moderator
may override, and what happens to existing rows — are still open.
