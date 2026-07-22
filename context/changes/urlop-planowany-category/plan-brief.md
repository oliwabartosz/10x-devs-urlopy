# Add "urlop planowany" Absence Category (S-13) — Plan Brief

> Full plan: `context/changes/urlop-planowany-category/plan.md`

## What & Why

Add a seventh selectable absence type, **"urlop planowany"** (planned vacation), so users can
categorize planned leave distinctly from regular `urlop`. Roadmap slice S-13; PRD FR-001/FR-002.

## Starting Point

Absence types are rendered entirely from the `absence_types` table (currently 6 rows). The
dashboard loads them and fans them out to the form, grid, details, and legend — no type list,
color map, or legend is hardcoded anywhere in `src/`.

## Desired End State

`absence_types` has a `('urlop planowany', '#7c3aed')` row. The type is selectable in the
add/edit dialog and renders in the grid, details, and legend with its violet color. It is
full-day-only (no time inputs) and is not counted toward the vacation balance.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where the type lives | Seed row in `absence_types` | Types are data-driven; one row lights up all UI. | Plan |
| Color | Violet `#7c3aed` | Distinct from all 6 existing colors (fills the empty purple slot); passes the color CHECK. | Plan |
| Idempotency | `INSERT … WHERE NOT EXISTS` | `name` has no unique constraint; guards against re-apply / test-DB overlap. | Plan |
| Ordering | Appears last (id 7) | No `display_order` for types; reordering is out of scope. | Plan |
| Verification | Manual + migration-applies | Matches how the original 6 were seeded; S-15 test already covers exclusion. | Plan |

## Scope

**In scope:** one idempotent seed migration adding the type with its color.

**Out of scope:** any schema change, any app-code change, reordering types, partial-day rule
changes (S-14), balance-counting changes (S-15), a dedicated seed test.

## Architecture / Approach

Append one hand-authored SQL seed migration under `supabase/migrations/` (mirroring the existing
seed and the S-15 RLS migration), applied via the Supabase CLI. Every consumer reads types from
the DB at request time, so no rebuild or code edit is required.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Seed migration | `urlop planowany` type selectable and rendered everywhere | Non-idempotent insert duplicating the row (mitigated by `WHERE NOT EXISTS`) |

**Prerequisites:** F-01 (done — `absence_types` table + seed). Local/test DB to apply the migration.
**Estimated effort:** ~1 short session, single phase.

## Open Risks & Assumptions

- Assumes no consumer keys off an exact set of type names other than the S-14/S-15 paths already
  verified (grep of `src/` found none).
- Assumes the new type appearing last (id 7) is acceptable ordering.

## Success Criteria (Summary)

- "urlop planowany" is selectable in the dialog and renders in grid/details/legend with `#7c3aed`.
- It offers no time inputs (full-day only) and is excluded from the vacation balance.
- Lint, build, and the test suite (incl. the S-15 exclusion test) pass.
