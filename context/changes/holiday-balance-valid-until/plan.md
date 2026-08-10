# Remove "Do dnia" and pin the balance card to the current year — Implementation Plan

## Overview

`Do dnia` (`holiday_balances.valid_until`) is removed from the product entirely — the input,
the card line, the API field, the type, the Drizzle column and the database column. In the
same change, the dashboard balance card is pinned to the current calendar year so browsing the
grid to an older month can no longer repaint it with a past year's figures.

The two are shipped in that order deliberately: the pin lands first, which makes the removal
obviously correct (a card that always shows the current year can never need a validity marker),
and it is independently valuable if the rest slips.

This change **reverses two recorded decisions** and amends one roadmap commitment — see
"Prior Decisions Superseded" below.

## Current State Analysis

`valid_until` is a nullable `date` column on `holiday_balances`, surfaced as a free-form
`<input type="date">` labelled `Do dnia (opcjonalnie)` in the balance card's `Edytuj` dialog,
and rendered on the card as `Do dnia: {value}` only when non-null.

**Nothing consumes it.** The sole read is a pass-through into the API response
(`src/lib/services/holiday-balance.ts:86`). `leftDays` (`:77`) and `computeUsedDays` (`:15-59`)
ignore it. No SQL predicate, index, constraint or RLS policy references it —
`supabase/migrations/20260714114608_holiday_balances_rls.sql` gates every policy on `employees`,
never on this column.

**Its meaning was never settled.** The column name says expiry, the UI label says deadline, the
schema comment (`src/db/schema.ts:82`) says "informational HR provenance date",
`context/foundation/roadmap.md:283` says `datę-wskazówkę`. The two test fixtures encode
contradictory meanings and both pass: `korekta-gate.test.ts:52` stores `2031-09-30` for
`YEAR=2031` (the labour-law carryover date), `used-computation.test.ts:113` stores `2030-12-31`
for `YEAR=2030` (calendar-year end). Every assertion is round-trip identity; none asserts
meaning. `DateSchema` (`src/lib/validators.ts:3-9`) validates ISO shape only, so a 2030 row
accepts `1999-04-17`. No PRD requirement backs the field.

**Production holds two rows**: one `null`, one `2026-08-07` — a verification artifact from
commit `e2da254`, which shipped the balance card and is dated 2026-08-07. That single value is
the *date of entry*, which is neither of the two documented readings. No backfill is required
and no row carries an HR date worth preserving. (Query run 2026-08-10; see `frame.md`,
Confidence.)

**The card follows the browsed year, not the current one.** `src/pages/dashboard.astro:29`
derives `year` from the `?month=YYYY-MM` param, falling back to `now.getFullYear()`; `:142`
filters the balance row by that `year`; `:146` builds the view with it; `:234` passes it into
the card, which titles itself `Urlop {year} – pozostało` (`HolidayBalanceCard.tsx:41`).
Navigating to `?month=2025-03` therefore renders 2025's tiles and 2025's `left_days` in styling
identical to a live card — no badge, no muting, no staleness signal. Years are wholly
independent records: `Zaległe` is typed by hand each year with no computed relationship to the
prior year's remainder.

### Key Discoveries

- **Live data-loss footgun, resolved by this change.** `src/pages/api/holiday-balances/index.ts:192`
  and `:200` write `valid_until` unconditionally in both the insert values and the
  `onConflictDoUpdate.set`, unlike `used_adjustment_days` which is spread conditionally
  (`:193`/`:202`). Any client omitting the key nulls the stored date. Unreachable today only
  because the dialog always sends it (`HolidayBalanceDialog.tsx:127`). Removing the field
  removes the footgun rather than patching it.
- **Deploy ordering is load-bearing.** Drizzle star-selects compile to an *explicit* column list
  from `schema.ts`, not to `SELECT *`. `dashboard.astro:141` (`db.select().from(holidayBalancesTable)`)
  and `index.ts:93` both do this. Dropping the column while the current Worker is live makes
  every dashboard load and every `GET /api/holiday-balances` fail. Code deploys first; the
  migration runs after.
- **The snapshot, not the CHECK constraints, is the migration hazard.** The latest Drizzle
  snapshot (`supabase/migrations/meta/20260807122840_snapshot.json`) reports
  `checkConstraints: {}` and `policies: []` for `public.holiday_balances` — drizzle-kit is blind
  to both hand-added CHECKs (`20260713124938_premium_brother_voodoo.sql:19-22`) and the RLS
  policies, so it cannot emit a DROP for them on a column-drop path. The real risk is the
  reverse: if the snapshot is not advanced, the next unrelated `db:generate` diffs a
  `valid_until`-free `schema.ts` against a snapshot that still has it and re-emits this DROP
  inside someone else's migration.
- **Hand-authored migrations here are not journal-registered.** `meta/_journal.json` lists only
  the four drizzle-generated migrations; `20260714114608_holiday_balances_rls.sql`,
  `20260526000001_schema.sql` and the other hand-authored files are absent and were applied
  out-of-band. A purely hand-written file would never be applied by `npm run db:migrate`.
- **`updated_at` already answers the provenance question** and is maintained on every write
  (`index.ts:201`), but is stripped by `buildBalanceView` and never rendered. It stays that way —
  see "What We're NOT Doing".
- **`year` has six other consumers in `dashboard.astro`** (`:74` grid date range, `:166-172` nav
  URLs, `:214` MonthNav, `:247`/`:258`/`:269` grid/details/stats). Only the three balance-related
  uses move to the pinned year.

### Prior Decisions Superseded

The plan must state these explicitly rather than letting the code drift away from them:

| Decision | Where recorded | What supersedes it |
| --- | --- | --- |
| S-15: both roles may edit any balance, including `Do dnia` | `context/archive/2026-06-22-urlop-balance/plan.md:34` | Still true for the remaining fields. `Do dnia` is not gated — it ceases to exist. |
| S-17: `valid_until` is **not** role-gated and stays editable by everyone | `context/changes/huge-ui-ux-improvement/plan.md:843-851` | Superseded: the field is removed, so the gating question is moot. The `Korekta` gate S-17 introduced is untouched. |
| Roadmap S-15 outcome commits to the employee typing the date | `context/foundation/roadmap.md:283` | Amended in Phase 2 — the clause `oraz datę-wskazówkę "Do dnia:"` is struck, with a note recording this change as the reason. |
| `change.md` title: "Derive Do dnia from the balance year and gate it to moderators" | `context/changes/holiday-balance-valid-until/change.md:3` | Superseded by the frame. Retitled in Phase 2. |

## Desired End State

The balance card shows `Urlop {current year} – pozostało`, the remaining-days figure, and the
three tiles (`Bieżące` / `Zaległe` / `Wykorzystane`) — and nothing else. Navigating the grid to
any other month leaves the card unchanged. The `Edytuj` dialog offers `Bieżące`, `Zaległe`, and
(for moderators only) `Korekta wykorzystania`. No date input anywhere. `holiday_balances` has no
`valid_until` column, and `HolidayBalanceView` has no `valid_until` field.

Verify by: opening the dashboard, navigating back several months, and confirming the card's
heading year never changes; opening `Edytuj` and confirming three fields for a moderator and two
for an employee; and confirming `\d holiday_balances` shows no `valid_until` while both CHECK
constraints and all four RLS policies remain.

## What We're NOT Doing

- **Not showing provenance in any form.** No `Stan na {updated_at}` line, no read-only date. The
  card gets nothing in place of `Do dnia`. `updated_at` stays stored, maintained, and unexposed —
  it is not threaded into `HolidayBalanceView`.
- **Not deriving `${year}-12-31`** or any other value. The original framing is retired; see
  `frame.md`.
- **Not touching the `Korekta` moderator gate** or relocating `Korekta` out of the balance card's
  `Edytuj`. S-17 leftover item (2) stays open — its destination (the `Pracownicy` panel) depends
  on the deferred batch-balance endpoint.
- **Not fixing the row-7.9 blocker** (`HolidayBalanceCard` hard-wired to `currentEmployee.id`,
  `dashboard.astro:230-235`), and not adding moderator editing of other employees' balances from
  `Pracownicy`. Both remain open and separable, coupled to the deferred batch-balance endpoint.
- **Not adding a historical-year treatment** (muted styling, "zakończony" badge, distinct empty
  state). Once the card is pinned, a historical year can no longer be displayed.
- **Not auto-rolling `carryover_days`** between years. Years stay independent records, per S-15.
- **Not introducing timezone handling.** See "Critical Implementation Details".
- **Not adding `db:migrate` to CI.** The migration stays a manual post-deploy step.

## Implementation Approach

Three phases, strictly ordered, each independently deployable:

1. **Pin the card** — a self-contained edit to `dashboard.astro` that introduces a separate
   `balanceYear` used only by the three balance-related call sites. No migration, no API change,
   no risk to the grid.
2. **Remove the field from code** — UI, API, service, types, Drizzle schema, both test files, and
   the roadmap line. After this deploys, nothing in the running system references the column,
   though the column still exists and still holds its two rows.
3. **Drop the column** — a migration generated by `db:generate`, verified by hand to be exactly
   the column drop, applied only once Phase 2 is confirmed live.

The gap between Phase 2 and Phase 3 is the safety margin: both the "column present, code
ignores it" and "column absent, code ignores it" states are correct, so the migration can be run
at any time after the deploy — or rolled back to by simply not running it.

## Critical Implementation Details

**Migration and deploy sequencing.** Phase 3's migration must not be applied until Phase 2's code
is deployed and verified in production. Drizzle star-selects name every schema column explicitly,
so a live Worker built from a `valid_until`-bearing `schema.ts` will issue
`select ... "valid_until" ... from "holiday_balances"` and fail hard against a dropped column —
taking the whole dashboard and the balances API with it. The reverse order is safe in both
directions.

**Snapshot consistency.** Phase 3 uses `npm run db:generate` (not a hand-written file) precisely
so that `meta/_journal.json` and a new `meta/*_snapshot.json` advance together. The generated SQL
must then be read before `db:migrate` runs: it should contain exactly
`ALTER TABLE "holiday_balances" DROP COLUMN "valid_until";` and nothing else. If it contains
anything more — particularly any `DROP CONSTRAINT` or table recreate — hand-correct the `.sql`
file down to the single statement but keep the generated snapshot and journal entry.

**Timezone edge, deliberately left alone.** `now.getFullYear()` in the Workers runtime is the UTC
year, and the repo has no timezone handling anywhere (`grep` for `Europe/Warsaw` returns nothing).
Between 23:00 CET on 31 December and midnight UTC, the pinned card will show the incoming year
while Poland is still in the outgoing one. This is the behaviour the default view already has
today (`dashboard.astro:29`), so Phase 1 preserves it rather than introducing a lone
timezone-aware call site. Worth a follow-up change if it ever bites; not this one.

**January rollover is unchanged and expected.** On 1 January the pinned card flips to the new
year, finds no row, and shows `Brak wprowadzonego wymiaru urlopu.` until that year's `Bieżące` /
`Zaległe` are entered. That is the same behaviour as today's default view and requires no
scheduler.

---

## Phase 1: Pin the balance card to the current year

### Overview

Decouple the balance card's year from the grid's `?month` param, so browsing to an older month
leaves the card showing the current year's figures.

### Changes Required:

#### 1. Dashboard year derivation

**File**: `src/pages/dashboard.astro`

**Intent**: Introduce a second year value that always reflects the current calendar year, and
route only the balance-related call sites through it. The grid, the month nav, the stats and the
details tabs keep using the browsed `year` exactly as they do now.

**Contract**: A new frontmatter constant derived from the same `now` already declared at `:26`,
independent of `validMonthParam`. It replaces `year` at exactly three sites: the balance row
query's `eq(holidayBalancesTable.year, …)` (`:142`), the `buildBalanceView(…)` call (`:146`), and
the `year={…}` prop on `<HolidayBalanceCard>` (`:234`). The other six uses of `year` (`:74`,
`:166`, `:169-170`, `:214`, `:247`, `:258`, `:269`) are untouched. Add a short comment at the
declaration recording *why* the two years are separate, so a future reader does not "simplify"
them back together.

**Note**: `HolidayBalanceCard` and `HolidayBalanceDialog` take `year` as a prop and pass it into
the POST body (`HolidayBalanceDialog.tsx:123`) — no component signature changes, they simply
receive the pinned value.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Existing tests still pass: `npm run test:run`

#### Manual Verification:

- Dashboard loads with the card reading `Urlop <current year> – pozostało`
- Navigating back several months (including into a prior calendar year) leaves the card's heading
  year, remaining-days figure and all three tiles unchanged
- The grid, MonthNav, `Szczegóły` and `Statystyki` tabs still follow the browsed month/year
- `Edytuj` → save writes to the current year's row, not the browsed year's

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Remove `Do dnia` from the code

### Overview

Strip the field from every layer — UI, API, service, types, Drizzle schema — plus the two test
files that assert its behaviour and the roadmap line that commits to it. The database column
survives this phase untouched.

### Changes Required:

#### 1. Balance card

**File**: `src/components/holiday/HolidayBalanceCard.tsx`

**Intent**: Remove the conditional `Do dnia:` line so the card shows the remaining-days figure
alone.

**Contract**: Delete the `{balance.valid_until && …}` block at `:52-54`. The surrounding
`flex items-baseline gap-3` wrapper at `:46` now has a single child — collapse it only if that
leaves the layout unchanged; the `gap-3` is otherwise inert.

#### 2. Balance dialog

**File**: `src/components/holiday/HolidayBalanceDialog.tsx`

**Intent**: Remove the date input, its state, and its contribution to the POST body.

**Contract**: Delete the `valid-until` field group (`:234-244`), the `validUntil` state
(`:59`), and the `valid_until` key in the POST body (`:127`). Update the comment at `:54-55`,
which explains the full-replace strategy in terms of "the stored adjustment / 'Do dnia' date" —
after this change the rationale applies to the adjustment only.

#### 3. API route

**File**: `src/pages/api/holiday-balances/index.ts`

**Intent**: Remove the field from the request contract and from both halves of the upsert,
eliminating the unconditional-write footgun in the process.

**Contract**: Drop `valid_until` from `HolidayBalanceUpsertSchema` (`:115`), from the
destructuring at `:147-148`, from the insert values (`:192`), from `onConflictDoUpdate.set`
(`:200`), and from the degraded-view fallback object (`:234`). Amend the S-15/S-17 comment at
`:150-155`, which currently reads "Both roles may edit any balance's entitlement, carryover and
'Do dnia'". Check whether the `DateSchema` import (`:10`) still has a consumer in this file and
remove it if not. Zod's `z.object` strips unknown keys, so a stale client still sending
`valid_until` gets a 200 with the key silently ignored — no compatibility shim needed.

#### 4. Service layer

**File**: `src/lib/services/holiday-balance.ts`

**Intent**: Stop projecting the field into the API response shape.

**Contract**: Remove `valid_until: row?.valid_until ?? null` from `buildBalanceView`'s return
(`:86`). No other line in this file references it.

#### 5. Shared types

**File**: `src/types.ts`

**Intent**: Remove the field from the API response interface.

**Contract**: Delete `valid_until: string | null;` from `HolidayBalanceView` (`:23`).
`HolidayBalance` is `typeof holiday_balances.$inferSelect` and follows the schema change
automatically.

#### 6. Drizzle schema

**File**: `src/db/schema.ts`

**Intent**: Remove the column declaration so no compiled query names it.

**Contract**: Delete the `valid_until` column and its comment (`:82-83`). Check whether the
`date` import from `drizzle-orm/pg-core` still has another consumer in this file and remove it if
not. Leave the hand-added-CHECK-constraints comment at `:88-89` in place — it still applies.

**This is the line that makes the deploy ordering matter**: from here on, compiled queries no
longer name the column, which is precisely what Phase 3 requires.

#### 7. Korekta gate test

**File**: `src/tests/api/holiday-balances/korekta-gate.test.ts`

**Intent**: Remove the `valid_until` assertions without weakening what the test actually guards —
that the moderator gate covers one field, not the whole route.

**Contract**: Drop `valid_until` from the `payload()` helper (`:52`) and the assertion at `:114`.
Rename the test at `:99` (currently "non-moderator still writes entitlement, carryover and
valid_until — the gate is one field, not the route") to name only the two surviving fields; the
entitlement and carryover assertions at `:112-113` stay and continue to carry the test's real
purpose. Update the file-header comment at `:11-20`, which describes a "full replace of all four
fields" — it is three now.

#### 8. Used-computation test

**File**: `src/tests/api/holiday-balances/used-computation.test.ts`

**Intent**: Remove the field from fixtures and assertions.

**Contract**: Drop `valid_until: "2030-12-31"` from the insert at `:113`, the assertion at `:121`,
and `expect(view.valid_until).toBeNull()` at `:146`. The surrounding assertions on `used_days`,
`left_days` and `balance_id` are the substance of both tests and are unaffected.

#### 9. Roadmap amendment

**File**: `context/foundation/roadmap.md`

**Intent**: Strike the commitment to the employee typing the date, so the roadmap stops
contradicting the shipped product.

**Contract**: In the S-15 outcome line (`:283`), remove `oraz datę-wskazówkę "Do dnia:"` and
append a short note recording that the field was removed by this change, with the change id. The
rest of the S-15 entry (the `Pozostało` formula, the per-year framing, the both-roles-edit claim)
stays accurate.

#### 10. Change identity

**File**: `context/changes/holiday-balance-valid-until/change.md`

**Intent**: Retitle the change to match what it does, and record the phase-2 status.

**Contract**: Update `title:` (currently "Derive 'Do dnia' from the balance year and gate it to
moderators", which the frame reversed) and set `status:` / `updated:`. The change id stays as-is —
folder renames break the references already written into `frame.md` and this plan.

### Success Criteria:

#### Automated Verification:

- No source reference to the field remains: `grep -rn "valid_until\|validUntil\|Do dnia" src/` returns nothing
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Full test suite passes against the direct DB: `DATABASE_URL_DIRECT=… npm run test:run`
- Deployed successfully and health check green (CI `deploy` job on push to `main`)

#### Manual Verification:

- Card shows the remaining-days figure with no date line, for both a row with a stored
  `valid_until` and a row without
- `Edytuj` dialog shows `Bieżące` + `Zaległe` for an employee, and those plus
  `Korekta wykorzystania` for a moderator — no date input for either role
- Saving from the dialog persists entitlement and carryover correctly, and a non-moderator's save
  still leaves a stored `Korekta` untouched
- The `Pozostanie` live preview still tracks the steppers
- `Usuń` still removes the row
- Verified against the **production deployment**, not `wrangler dev` — Drizzle queries cannot
  connect from the local Workers runtime

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful — and
specifically that the deploy is live — before proceeding to Phase 3. Phase 3 is unsafe until this
code is running in production.

---

## Phase 3: Drop the column

### Overview

Remove `valid_until` from the database, keeping both hand-added CHECK constraints, all four RLS
policies, and Drizzle's journal/snapshot state consistent.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<generated>.sql` (+ `meta/_journal.json`, `meta/<generated>_snapshot.json`)

**Intent**: Generate the drop from the already-edited `schema.ts` so the journal and snapshot
advance with it, then verify the SQL by hand before applying.

**Contract**: Run `npm run db:generate`. The emitted SQL must be exactly:

```sql
ALTER TABLE "holiday_balances" DROP COLUMN "valid_until";
```

If it contains anything else — any `DROP CONSTRAINT`, any table recreate, any change to another
table — hand-correct the `.sql` file down to that single statement, but keep the generated
snapshot and journal entry. The snapshot advance is the point of generating rather than
hand-writing: without it, the next unrelated `db:generate` re-emits this drop inside someone
else's migration.

Apply with `npm run db:migrate` (which reads `DATABASE_URL_DIRECT`), **only after Phase 2 is
deployed and verified**.

Note for the implementer: drizzle-kit's snapshot records `checkConstraints: {}` and
`policies: []` for this table, so it has no knowledge of `holiday_balances_year_check`,
`holiday_balances_days_nonnegative_check`, or the four RLS policies — it cannot deliberately drop
them on a column-drop path. The post-migration constraint check below exists to prove that, not
because a specific mechanism is expected to break it.

### Success Criteria:

#### Automated Verification:

- Generated SQL contains exactly one statement, the `DROP COLUMN`
- Migration applies cleanly: `npm run db:migrate`
- Column is gone: `SELECT column_name FROM information_schema.columns WHERE table_name='holiday_balances'` has no `valid_until`
- Both CHECK constraints survive: `SELECT conname FROM pg_constraint WHERE conrelid='holiday_balances'::regclass` still lists `holiday_balances_year_check` and `holiday_balances_days_nonnegative_check`
- All four RLS policies survive: `SELECT policyname FROM pg_policies WHERE tablename='holiday_balances'` returns `holiday_balances_select`, `_insert`, `_update`, `_delete`
- A subsequent `npm run db:generate` produces no further diff for this table
- Full test suite passes against the direct DB: `DATABASE_URL_DIRECT=… npm run test:run`
- Build and lint still pass: `npm run build`, `npm run lint`

#### Manual Verification:

- Dashboard loads in production with the card rendering correctly
- `Edytuj` → save → reload round-trips entitlement, carryover and `Korekta` correctly
- Creating a balance for an employee with no existing row still works (insert path)
- `Usuń` still works
- No new Sentry events on the dashboard or `/api/holiday-balances` routes

**Implementation Note**: This phase's migration is irreversible. Confirm Phase 2 is live in
production before running `db:migrate`.

---

## Testing Strategy

### Unit / Integration Tests

The two existing test files are the coverage that matters here; both gate on
`DATABASE_URL_DIRECT` via `describe.skipIf`, so they must be run with that env var set or they
silently pass as skipped.

- `korekta-gate.test.ts` — the moderator gate on `used_adjustment_days` is the behaviour most at
  risk from editing this file. After the edits, all six cases must still pass, and the
  "gate is one field, not the route" case must still assert that a non-moderator writes
  entitlement and carryover.
- `used-computation.test.ts` — `used_days` / `left_days` arithmetic, the negative-Left case, and
  the synthesized-view case must all still pass with the field's assertions removed.

No new tests are added. There is no new behaviour to cover: Phase 1 changes which year a query
uses (verified manually — the assertion would be against `dashboard.astro` frontmatter, which has
no test harness), and Phases 2-3 remove a field that no test meaningfully asserted in the first
place.

### Manual Testing Steps

1. **Phase 1**: load the dashboard, note the card's heading year; click back through MonthNav into
   the previous calendar year; confirm the card is unchanged while the grid follows.
2. **Phase 2**: as a moderator, open `Edytuj` — confirm three fields, no date input. Save, reload,
   confirm values persist.
3. **Phase 2**: as an employee, open `Edytuj` — confirm two fields. Save, reload, and confirm a
   moderator-set `Korekta` was not clobbered.
4. **Phase 2**: on an employee with no balance row, confirm the empty state and that a first save
   creates the row.
5. **Phase 3**: repeat steps 2-4 after the migration, against production.

## Performance Considerations

None. Phase 1 changes one predicate value on an indexed `(employee_id, year)` unique constraint.
Phases 2-3 remove a column from a two-row table and shrink one response payload.

## Migration Notes

**No backfill.** The whole table holds two rows — one `null`, one `2026-08-07`. The non-null value
is a verification artifact from the day the card shipped (commit `e2da254`, 2026-08-07) and is
the *date of entry*, matching neither documented reading of the field. It is preserved in writing
in `frame.md` and in this plan; nothing depends on it in data.

**Rollback.** Before Phase 3 runs, rollback is a code revert plus a Cloudflare deployment
rollback — the column is still there. After Phase 3, restoring the column would mean a new
migration adding it back as nullable, which restores the schema but not the two values. Given the
above, that is an acceptable one-way door.

## References

- Frame brief: `context/changes/holiday-balance-valid-until/frame.md`
- Change identity: `context/changes/holiday-balance-valid-until/change.md`
- Prior decisions: `context/archive/2026-06-22-urlop-balance/plan.md:7,34,44`,
  `context/archive/2026-06-22-urlop-balance/reviews/impl-review-phase-2.md:25-37` (the F1
  unconditional-write finding), `context/changes/huge-ui-ux-improvement/plan.md:843-851`,
  `context/changes/huge-ui-ux-improvement/reviews/impl-review.md:158`
- Roadmap: `context/foundation/roadmap.md:283` (S-15 outcome)
- DROP COLUMN precedent: `supabase/migrations/20260605000001_absence_start_end_time.sql`
- Migration discipline: `AGENTS.md` §"Migration discipline", `src/db/schema.ts:88-89`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pin the balance card to the current year

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — 34553f3
- [x] 1.2 Linting passes: `npm run lint` — 34553f3
- [x] 1.3 Existing tests still pass: `npm run test:run` — 34553f3

#### Manual

- [ ] 1.4 Card reads `Urlop <current year> – pozostało` on load
- [ ] 1.5 Navigating back across a year boundary leaves the card unchanged
- [ ] 1.6 Grid, MonthNav, Szczegóły and Statystyki still follow the browsed month/year
- [ ] 1.7 `Edytuj` → save writes to the current year's row

### Phase 2: Remove `Do dnia` from the code

#### Automated

- [x] 2.1 `grep -rn "valid_until\|validUntil\|Do dnia" src/` returns nothing
- [x] 2.2 Type checking passes: `npm run build`
- [x] 2.3 Linting passes: `npm run lint`
- [x] 2.4 Full test suite passes with `DATABASE_URL_DIRECT` set: `npm run test:run`
- [ ] 2.5 Deployed successfully and health check green

#### Manual

- [ ] 2.6 Card shows no date line, for rows with and without a stored `valid_until`
- [ ] 2.7 Dialog shows 2 fields for an employee, 3 for a moderator, no date input
- [ ] 2.8 Saving persists entitlement/carryover; non-moderator save preserves stored `Korekta`
- [ ] 2.9 `Pozostanie` live preview still tracks the steppers
- [ ] 2.10 `Usuń` still removes the row
- [ ] 2.11 Verified against the production deployment, not `wrangler dev`

### Phase 3: Drop the column

#### Automated

- [ ] 3.1 Generated SQL contains exactly one statement, the `DROP COLUMN`
- [ ] 3.2 Migration applies cleanly: `npm run db:migrate`
- [ ] 3.3 `valid_until` absent from `information_schema.columns`
- [ ] 3.4 Both CHECK constraints survive in `pg_constraint`
- [ ] 3.5 All four RLS policies survive in `pg_policies`
- [ ] 3.6 A subsequent `npm run db:generate` produces no further diff for this table
- [ ] 3.7 Full test suite passes with `DATABASE_URL_DIRECT` set: `npm run test:run`
- [ ] 3.8 Build and lint still pass

#### Manual

- [ ] 3.9 Dashboard loads in production, card renders correctly
- [ ] 3.10 `Edytuj` → save → reload round-trips all remaining fields
- [ ] 3.11 Insert path works for an employee with no existing row
- [ ] 3.12 `Usuń` still works
- [ ] 3.13 No new Sentry events on the dashboard or `/api/holiday-balances`
