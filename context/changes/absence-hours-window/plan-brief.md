# Bound partial-day absence ranges — Plan Brief

> Full plan: `context/changes/absence-hours-window/plan.md`
> Frame brief: `context/changes/absence-hours-window/frame.md`

## What & Why

Partial-day absences have no definition of a *valid* range beyond "forward-going" — and the
axis that actually corrupts the app's accounting is **magnitude**, not clock position. The
system asserts an invariant it never enforces: one date is worth at most one day
(`schema.ts:65`, `AbsenceStats.tsx:44`, `holiday-balance.ts:41`), yet a partial-day range is
divided by `FULL_DAY_HOURS = 8` with no ceiling, so a single date can contribute nearly 3 days
to the holiday balance. This plan adds a duration cap and a start-time floor, both
auto-correcting.

## Starting Point

Validation exists at three layers — zod on `POST`, zod on `PATCH`, and the `absences_time_check`
CHECK — but all three enforce only presence, ordering and format. None has ever expressed
bounds. The client has no time validation at all. Of 8 live partial-day rows, 6 already comply
with the new rules; the 2 that don't are hand-entered copies of design-mockup fixtures
(`01:14–06:14`, `01:22–03:22`) that predate the partial-day guard.

## Desired End State

A partial-day absence can never be stored with a start before 06:00 or a duration over 8 h,
through any path the app exposes. The form corrects out-of-bounds values as the user tabs out
of a time field; the server corrects crafted requests and returns the stored row so the
correction is visible. The one range that cannot be corrected — ending at or before 06:00 —
is rejected with a message naming the actual rule.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Primary rule | Duration ≤ 8 h | Restores an invariant three modules already assume; reuses `FULL_DAY_HOURS` rather than inventing a number | Frame |
| Secondary rule | Start ≥ 06:00 | Excludes implausible entries; revised down from the original 07:15 | Frame |
| Failure mode | Clamp, don't reject | A 20 h request succeeds and stores 8 h | Frame |
| Ceiling | Dropped | `absences_time_check` already makes 23:59 unreachable; verified absent from the whole codebase | Frame |
| Legacy rows | Purge 2, keep 6 | All survivors already comply — no backfill, no grandfathering | Frame |
| DB CHECK for the cap | No | Server clamps before writing, so it could never fire from the app path; avoids a second hand-re-add landmine and a misleading `23514` message | Plan |
| Client correction timing | On blur | Matches a bounded numeric input; the saved value never surprises | Plan |
| Purge mechanism | Migration | Auditable and reproducible; matches the data-`UPDATE` precedent in `20260605000001` | Plan |
| `TimeSchema` (`"99:99"`, `"24:00"`) | Tighten here | The clamp does arithmetic on this value — a loose schema turns a bad input into a plausible wrong time rather than a 400 | Plan |
| 06:00's written source | Plausibility floor, chosen | No external regulation; recorded honestly so the next reader isn't misled by a rationale the number outgrew | Plan |

## Scope

**In scope:** shared clamp module; `TimeSchema` tightening; clamping in `POST` and `PATCH`;
widening the `PATCH` existing-row read and its CAS pin to the time columns; on-blur correction
in `AbsenceFormDialog`; unit, route and E2E tests; a two-row purge migration.

**Out of scope:** any ceiling rule; a DB CHECK for the duration cap; changes to
`PARTIAL_DAY_TYPE_NAMES`; configurable workday length; backfill or grandfathering; new inline
rejection UI in the dialog; revising `hours.test.ts:8`.

## Architecture / Approach

One dependency-free module (`src/lib/absence-hours.ts`) owns both rules — the same shape
`absence-types.ts` already uses for a rule shared between form and API. The client imports it
for immediacy, both routes import it for authority.

```
AbsenceFormDialog (onBlur) ─┐
                            ├─→ absence-hours.ts ──→ floor → reject? → cap
POST /api/absences ─────────┤        (pure)
PATCH /api/absences/:id ────┘
```

Clamping is deliberately **not total**: flooring the start can leave `end < start`, which no
clamp repairs and the DB forbids, so a reject path survives.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Clamp module + `TimeSchema` | Both rules as pure functions; malformed times rejected | Clamp ordering — floor must precede cap, or `01:00–23:00` yields a 3 h absence instead of 8 h |
| 2. Server enforcement | Crafted requests bounded; `PATCH` learns the effective range | Nullable time columns break the `eq()` CAS-pin idiom → spurious 409s |
| 3. Client on-blur correction | User sees the legal value while editing | Over-eager clamping interrupting mid-entry typing |
| 4. Purge migration | Two junk rows removed | Irreversible `DELETE`; predicate must be narrow enough to match only those rows |

**Prerequisites:** access to the production deployment for manual verification (Drizzle cannot
run under `wrangler dev`); `DATABASE_URL_DIRECT` set for route-level tests.
**Estimated effort:** ~1–2 sessions across 4 phases; Phase 1 is self-contained and fast.

## Open Risks & Assumptions

- **Direct DB writes stay unbounded.** Declining the DB CHECK is a deliberate trade — nothing
  outside the API enforces the cap.
- **The 06:00 figure is a judgment call**, not an external rule. If a real regulation surfaces
  later, the constant moves and the recorded rationale should move with it.
- **Silent server-side correction is discoverable only by reading the response.** Both routes
  already return the stored row, but a future non-browser client that ignores the body would
  never learn its range was rewritten.
- **The `PATCH` merge path is under-exercised in practice** — the dialog always sends the full
  field set, so only the new tests cover partial requests.

## Success Criteria (Summary)

- No partial-day absence in the database starts before 06:00 or runs longer than 8 h — and no
  path through the app can create one.
- A user entering an out-of-bounds range sees it corrected while editing, never rejected.
- The holiday balance and statistics can no longer be inflated past one day per date.
