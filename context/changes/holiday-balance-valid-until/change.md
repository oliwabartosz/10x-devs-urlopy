---
change_id: holiday-balance-valid-until
title: Remove "Do dnia" and pin the balance card to the current year
created: 2026-08-07
status: implementing
updated: 2026-08-10
archived_at: null
---

## Notes

Raised during S-17 (`huge-ui-ux-improvement`) manual verification, rows 7.8 / 7.10.

`Do dnia` (`holiday_balances.valid_until`) should stop being a free-form date every
employee types. Instead it should be derived from the balance year — 2026 → `2026-12-31`,
rolling over to `2027-12-31` on 1 January 2027 — and the input should not be offered to
non-moderators. "Less thinking by the user the better."

**This reverses a recorded decision.** S-17's plan states explicitly that `valid_until` is
**not** gated and stays editable by everyone
(`context/archive/…/huge-ui-ux-improvement/plan.md`, Phase 7 §3), which itself narrowed
S-15's "both roles may edit any balance"
(`context/archive/2026-06-22-urlop-balance/plan.md:34`). Two prior decisions are in play;
the plan for this change should open by restating them and saying what supersedes what.

**Answered 2026-08-10** (S-17 closing pass): the derived value is **31 December of the
balance year** — 2026 → `2026-12-31`, rolling to `2027-12-31` on 1 January 2027. This
confirms the assumption below and rules out the two competing readings: Polish labour law's
carryover deadline (30 September of the *following* year, which is what a deadline on
`carryover_days` would normally govern) and an end-of-*current*-month rule. Framing should
still note the labour-law divergence, because the field governs carryover and a reader who
knows the statute will expect September.

Also raised in the same pass: scope items (1) and (2) below — the moderator editing **every**
employee's balance from the `Pracownicy` panel, and `Korekta` / `Do dnia` leaving the balance
card's `Edytuj` altogether — were confirmed as wanted, and S-17 closed row 7.6 by routing
them here rather than reopening. See `context/changes/huge-ui-ux-improvement/change.md`,
closing notes.

Open questions the plan must answer before any code:

- **Derived or stored?** If `valid_until` becomes a pure function of `year`, the column is
  redundant and the rollover is free. If it stays stored, something has to write the new
  value each January — and nothing runs on a schedule today.
- **Can a moderator still override it?** An HR exception (carry-over deadline extended to
  September) is the reason the field exists at all.
- **What happens to existing rows** whose `valid_until` is null or is not 31 December?
- Does the rollover interact with `carryover_days`, which is the value a deadline would
  actually govern?

Also fold in the blocker found at S-17 row 7.9: a moderator cannot edit another employee's
balance today (`HolidayBalanceCard` is always wired to `currentEmployee.id`), so the
non-moderator/moderator write paths cannot be walked end-to-end in the UI. That may belong
here or with the deferred batch-balance endpoint — decide during framing.

## Framed 2026-08-10 — see `frame.md`

The framing step **reframed** this change. The observation (typing the date is friction)
holds; the stated framing (derive it from the year, gate it to moderators) does not survive
the evidence.

Short version: `Do dnia` was given a form control before anyone decided what it denotes,
and it still denotes nothing. Nothing reads it, no PRD requirement backs it, the two test
fixtures encode contradictory meanings and both pass, and the real HR screen the card
mirrors has no date column at all. Deriving `${year}-12-31` would restate the card's own
`Urlop 2026` heading twelve lines lower, make that redundant line newly visible on every
row (it is hidden when null today), and print a date beside `Zaległe` that is not that
figure's statutory deadline.

Three of the four open questions above are now answered:

- **Derived or stored?** — moot in the form asked. Confirmed: nothing runs on a schedule
  (no `triggers`/`crons` in `wrangler.jsonc`, no `scheduled` export), so a stored value
  cannot roll over at all. But the derived value carries no information.
- **Can a moderator override it?** — moot. The HR exception this rests on is
  hypothetical, never observed (user, framing Step 4).
- **Interaction with `carryover_days`?** — none exists in code. The relationship is
  asserted only in prose, in this file, three lines before it is listed as an open
  question.

`What happens to existing rows` stays open and is settled by one query against the
deployment — see frame.md, Confidence.

**Reframed problem**: not *how to fill this field in*, but *whether the balance card
should say anything about the figures' validity at all, and if so, what fact*. The user's
own reading of the field — "HR provenance / as-of date" — is a past fact the app already
records as `updated_at` and never renders; it is not derivable from `year`.

Two items carried forward regardless of direction: the unconditional `valid_until` write
at `index.ts:200` (omitting the key nulls the stored date — relocating the field makes it
reachable), and the drizzle `DROP COLUMN` hazard against the hand-added CHECK constraints.

Scope items (1) and (2) and the row-7.9 blocker remain open but are **separable** — the
user confirmed the free-form `Do dnia` is the leading concern.

**Added during the framing discussion**: the balance card must be **pinned to the current
year**. It is bound to the browsed year today (`dashboard.astro:29,142,230-235`), so
navigating the grid to an older month repaints the card with that year's figures in
identical styling. Confirmed wanted, needs no migration, and is independent of how
`Do dnia` resolves. This also finishes off the derive option: with the card pinned,
`${year}-12-31` is a single constant string shown to every employee all year, under a
heading that already reads `Urlop 2026`.

**Existing-rows question closed 2026-08-10** by a query against the deployment: the whole
table holds **two rows** — one `null`, one `2026-08-07`. That single value is a
verification artifact (commit `e2da254`, which shipped the balance card, is dated
2026-08-07 — the day rows 7.6/7.8 were manually checked), and it is the **date of entry**:
neither 31 December nor 30 September. The only human who ever filled the field in read it
as "as of today". No backfill strategy is needed, and no row carries an HR date worth
preserving.

Handed off to `/10x-plan` 2026-08-10. The one open product call left for the plan:
whether the card shows provenance at all (`updated_at` gives "stan na …" for free) or the
field simply goes away.

## Planned 2026-08-10 — see `plan.md` / `plan-brief.md`

**The field simply goes away.** No provenance line replaces it; `updated_at` stays stored,
maintained and unexposed. Three phases: (1) pin the balance card to the current year
(`dashboard.astro` only, no migration), (2) remove `Do dnia` from card, dialog, API, service,
types, `schema.ts`, both test files and `roadmap.md:283`, then deploy, (3) drop the column via a
`db:generate`-authored, hand-verified migration — applied only after phase 2 is live, because
Drizzle star-selects name every column explicitly and would 500 the dashboard otherwise.

The S-17 leftovers (moderator cross-employee balance editing from `Pracownicy`; the row-7.9
blocker; relocating `Korekta` out of the balance card) all stay separate — they are coupled to
the deferred batch-balance endpoint, not to this question.

Note for the implementer: this file's `title:` still describes the reversed framing and is
retitled in phase 2 (plan, Phase 2 §10). The change id stays as-is — `frame.md` and `plan.md`
both reference the folder path.
