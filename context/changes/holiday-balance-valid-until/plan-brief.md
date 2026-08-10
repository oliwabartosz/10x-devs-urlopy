# Remove "Do dnia" and pin the balance card to the current year — Plan Brief

> Full plan: `context/changes/holiday-balance-valid-until/plan.md`
> Frame brief: `context/changes/holiday-balance-valid-until/frame.md`

## What & Why

`Do dnia` was given a form control before anyone decided what it denotes, and it still denotes
nothing — so the question was never how to fill it in, but whether the balance card should say
anything about the figures' validity at all. The answer is no: the field is removed from the
product entirely. Alongside it, the balance card is pinned to the current calendar year so
browsing the grid to an older month can no longer repaint it with a past year's figures.

## Starting Point

`valid_until` is a nullable date column surfaced as a free-form `<input type="date">` in the
balance card's `Edytuj` dialog, rendered as `Do dnia: {value}` when non-null. Nothing reads it —
the only access is a pass-through into the API response; `left_days` and the Used computation
ignore it, and no SQL predicate, index, constraint or RLS policy names it. Its meaning is
recorded five different ways across the schema comment, the UI label, the column name, the
roadmap and two test fixtures that encode contradictory readings and both pass. Production holds
two rows: one null, one `2026-08-07` — a verification artifact from the day the card shipped,
storing the *date of entry*, which is neither documented reading.

Separately, the card is bound to the browsed year (`dashboard.astro:29,142,230-235`), so
`?month=2025-03` renders 2025's figures in styling identical to a live card.

## Desired End State

The card shows `Urlop <current year> – pozostało`, the remaining-days figure and the three tiles —
nothing else — and never changes as you browse months. The `Edytuj` dialog offers `Bieżące`,
`Zaległe`, and `Korekta wykorzystania` for moderators only. No date input anywhere, no
`valid_until` in the database, the API response or the type.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| What the field denotes | Nothing settled — retire it | Five conflicting readings, no PRD requirement, no consumer, and the one real value written matches none of them | Frame |
| Derive `${year}-12-31`? | No | It restates the card's own heading, and with the card pinned it is one constant string for every employee all year | Frame |
| Card freshness line | Nothing replaces it | The field is null on every real row, so no user loses information; `updated_at` stays stored, maintained and unexposed | Plan |
| Column disposition | DROP COLUMN | Two rows in all of production, neither worth preserving; leaving it orphaned guarantees schema drift at the next `db:generate` | Plan |
| Migration authoring | `db:generate`, then verify by hand | Advances journal + snapshot together, so the drop can't reappear inside an unrelated future migration; hand-verify the SQL before applying | Plan |
| Year pinning | Rides along, as the lead phase | Confirmed wanted, needs no migration, independently valuable, and makes the removal obviously correct | Frame + Plan |
| S-17 leftovers | All stay separate | Moderator cross-employee editing and the row-7.9 blocker are coupled to the deferred batch-balance endpoint, not to this question | Frame + Plan |
| Deploy sequencing | Code first, migration after | Drizzle star-selects name every column explicitly, so dropping while the old Worker is live 500s the whole dashboard | Plan |

## Scope

**In scope:**

- Pin the balance card's year to the current calendar year (`dashboard.astro` only)
- Remove `Do dnia` from card, dialog, API route, service, types and Drizzle schema
- Update the two test files that assert its behaviour
- Amend `roadmap.md:283`, which commits to the employee typing the date
- Drop the database column via a verified migration

**Out of scope:**

- Any provenance display, including `Stan na {updated_at}`
- Deriving `${year}-12-31` (the original framing, retired)
- Relocating `Korekta` out of the balance card's `Edytuj`
- Moderator editing other employees' balances from `Pracownicy`; the row-7.9 blocker
- Historical-year styling or badges (unreachable once pinned)
- Auto-rolling `carryover_days`; timezone handling; adding `db:migrate` to CI

## Architecture / Approach

Three strictly ordered, independently deployable phases. Phase 1 introduces a `balanceYear`
constant in `dashboard.astro` used by exactly three call sites (the balance query, the view
build, the card prop), leaving the other six uses of the browsed `year` alone. Phase 2 strips the
field top-to-bottom — UI → API → service → types → schema — plus tests and the roadmap line; after
it deploys, no compiled query names the column, though the column still exists. Phase 3 generates
and applies the drop. The gap between 2 and 3 is the safety margin: both intermediate states are
correct, so the migration can wait, or simply not be run.

Removing the field also kills a live footgun for free: `index.ts:192,200` write `valid_until`
unconditionally in both halves of the upsert (unlike `used_adjustment_days`, which is spread
conditionally), so any client omitting the key nulls the stored date.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pin the card | Card fixed to the current year; grid still follows `?month` | Missing one of the three balance call sites, leaving a half-pinned card |
| 2. Remove from code | No `Do dnia` in UI, API, service, types or schema; tests and roadmap updated | Editing `korekta-gate.test.ts` weakens the moderator gate it actually guards |
| 3. Drop the column | Column gone; constraints, policies and Drizzle snapshot intact | Applying before Phase 2 is live 500s every dashboard load; irreversible |

**Prerequisites:** Phase 3 requires Phase 2 deployed and verified in production. Tests need
`DATABASE_URL_DIRECT` set or they skip silently. Manual verification must run against the
production deployment — Drizzle cannot connect from `wrangler dev`.

**Estimated effort:** ~1–2 sessions. Phase 1 and 2 are small and mechanical; Phase 3 is one
generated migration plus verification queries.

## Open Risks & Assumptions

- **Phase 3 is a one-way door.** Restoring the column later restores the schema but not the two
  values. Accepted: one is null, the other is a verification artifact preserved in writing.
- **Timezone edge, deliberately left alone.** `now.getFullYear()` is the UTC year in the Workers
  runtime and the repo has no timezone handling anywhere; for ~1–2 hours on 31 December the pinned
  card shows the incoming year. This matches today's default-view behaviour rather than
  introducing a lone timezone-aware call site.
- **`dashboard.astro` frontmatter has no test harness**, so the pinning is verified manually only.
- **Assumption:** the generated migration will be a bare `DROP COLUMN`. The snapshot records
  `checkConstraints: {}` and `policies: []`, so drizzle-kit cannot knowingly drop the hand-added
  CHECKs or the RLS policies — but the plan verifies all six survive rather than trusting it.

## Success Criteria (Summary)

- Nobody is asked to type a date they cannot reason about, and the card no longer displays one
- The balance card always shows the current year, no matter where the grid is browsed
- Entitlement, carryover and the moderator-only `Korekta` all still save and round-trip correctly,
  with both CHECK constraints and all four RLS policies intact after the drop
