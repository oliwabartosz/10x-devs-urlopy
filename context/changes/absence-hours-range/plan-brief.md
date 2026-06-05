# Absence Hours → Start/End Time Range — Plan Brief

> Full plan: `context/changes/absence-hours-range/plan.md`
> Research: `context/changes/absence-hours-range/research.md`

## What & Why

Replace the `hours` duration field (e.g. "4h") on absences with `start_time` and `end_time` fields, and surface the time range visually in the grid ("12:00–14:00" label inside the colored cell) and in the Details table. The current hours count gives no scheduling information — you can't tell from "4h" whether someone is away in the morning or afternoon.

## Starting Point

The `absences` table has a single `hours NUMERIC(4,2)` column guarded by a biconditional CHECK constraint. The grid renders an identical colored block for both full-day and partial-day absences — `hours` is never used in rendering. The form captures hours via a plain `<input type="number">`.

## Desired End State

Partial-day absences show "HH:MM–HH:MM" in the monthly grid cell (with luminance-adaptive text color) and in the Details table ("Czas" column). The form has two `<Input type="time">` fields. The DB stores `start_time TIME` and `end_time TIME`; the API validates `end_time > start_time`. Stats compute duration as `(endMin − startMin) / 60`; full-day absences count as 8 h.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Existing data migration | Clean swap — no conversion | No partial-day absence data in production | Plan (user confirmed) |
| AbsenceStats scope | Update now | Stats are broken for partial-day today; fix in the same PR | Plan (user confirmed) |
| Grid visual for partial-day | Text label inside block | Time visible at a glance without extra layout | Plan (user confirmed) |
| Grid text contrast | Luminance-based (formula) | Yellow absence type (#ffcc00) fails white-on-yellow | Research → Plan |
| Time validation | `end_time > start_time` (strict) | Zero-duration absences have no domain meaning | Plan (user confirmed) |
| Details column header | Rename "Godziny" → "Czas" | "Hours" is a misnomer when displaying a time range | Plan (user confirmed) |
| Time input component | Native `<Input type="time">` | Already compatible with existing shadcn `Input` wrapper | Research → Plan |
| Full-day hours constant | 8 h | Simple; no PRD requirement for configurable work hours | Plan |
| Multi-day ranges | Out of scope | UX description ("12:00–14:00") implies same-day only | Research |

## Scope

**In scope:**
- Supabase migration: drop `hours`, add `start_time`/`end_time` TIME, new biconditional CHECK
- Drizzle schema, TypeScript `Absence` type simplification
- POST + PATCH zod schemas + handler updates; GET `hours::float` cast removal
- `AbsenceFormDialog` — two time pickers replace the number input
- `AbsenceGrid` — time label inside partial-day cell with luminance contrast
- `AbsenceDetailsTable` — column renamed, formatter updated
- `AbsenceStats` — duration computation replaces direct `hours` read
- CRUD integration tests updated; reversed-range validation test added
- `roadmap.md` S-09 entry added

**Out of scope:**
- Data conversion (no prod data)
- Multi-day ranges
- Configurable workday length
- RLS or role-conditional query changes
- E2E / Playwright tests

## Architecture / Approach

Strict bottom-up layering: DB → Types → API → Form → Display → Tests. Each phase is independently verifiable; phases 3–4 depend on the updated `Absence` type from phase 1. No new shadcn components; no new API routes; the UNIQUE `(employee_id, date)` constraint and the absence lookup map are unchanged.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. DB + Schema + Types | New migration, Drizzle columns, simplified `Absence` type | Must verify existing CHECK constraint name before dropping |
| 2. API Routes | `start_time`/`end_time` in POST/PATCH schemas; `hours::float` casts removed | Three separate SELECT statements need the cast removed |
| 3. Form Dialog | Two time pickers replace number input | Time value format: API returns "HH:MM:SS", input needs "HH:MM" slice |
| 4. Display UI | Grid label + contrast logic, Details rename, Stats duration math | Yellow (#ffcc00) contrast — luminance formula required |
| 5. Tests + Roadmap | Updated fixtures, new validation test, S-09 in roadmap | — |

**Prerequisites:** Local Supabase running (`npx supabase start`) for migration testing; integration tests require a connected test DB.  
**Estimated effort:** ~2–3 focused sessions across 5 phases.

## Open Risks & Assumptions

- The existing CHECK constraint name (set in `20260527000001`) must be confirmed by reading that migration file before writing the DROP — the plan uses `IF EXISTS` as a safeguard.
- `time()` columns in Drizzle's `$inferSelect` return `string | null`; if the version in use returns `Date`, a targeted type override is needed (verify after Phase 1).
- Staging environments may have test data with `hours` set — run `SELECT COUNT(*) FROM absences WHERE NOT is_full_day` before applying the migration anywhere other than dev.

## Success Criteria (Summary)

- A partial-day absence entered as "09:00–11:00" appears as a labeled colored block in the grid and shows "09:00–11:00" in the Details "Czas" column
- The API rejects reversed or equal time ranges with 400
- All CRUD integration tests pass; Stats totals are correct for both full-day (8 h) and partial-day (computed duration) absences
