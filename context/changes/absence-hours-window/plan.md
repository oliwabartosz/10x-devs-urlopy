# Bound partial-day absence ranges (max 8h, start from 06:00) — Implementation Plan

## Overview

Partial-day absences accept any forward-going time range. This plan adds two
**auto-correcting** rules — start ≥ 06:00 and duration ≤ 8 h — expressed once in a
dependency-free module and bound at both the client and the server, plus a two-row purge of
copied demo data.

The primary rule is the **duration cap**. Three modules already assume one date is worth at
most one day (`src/db/schema.ts:65`'s `unique().on(employee_id, date)`,
`src/components/absence/AbsenceStats.tsx:44`, `src/lib/services/holiday-balance.ts:41`), yet a
partial-day range is divided by `FULL_DAY_HOURS = 8` with no ceiling — so a single date can
contribute nearly 3 days to the holiday balance. The cap restores an invariant the system
already relies on, reusing the existing constant rather than introducing a number.

## Current State Analysis

**Validation today is presence + ordering + format, at three layers, with no notion of bounds:**

| Layer | Where | What it enforces |
| --- | --- | --- |
| Client | `AbsenceFormDialog.tsx:65` | Emptiness only (`saveDisabled`). No time validation at all. |
| Server (POST) | `index.ts:145-154` | Biconditional on `is_full_day`; `end_time > start_time`. |
| Server (PATCH) | `[id].ts:27-39` | Same, skipped when neither time field is patched. |
| DB | `absences_time_check` (`20260605000001_absence_start_end_time.sql:25-30`) | Same biconditional; backstop. |

**Constraints and gotchas discovered:**

- **`min`/`max` on the inputs would be inert.** There is no `<form>` and Save is
  `type="button"` (`AbsenceFormDialog.tsx:369`), so HTML constraint validation never fires.
  The client-side rule must be real JavaScript.
- **`[id].ts:96-98` selects only `absence_type_id, is_full_day`** — it has nothing to compute
  *effective* times against on a partial `PATCH`. The CAS pin at `:126-130` covers exactly
  those two fields, so widening the read means widening the pin.
- **`TimeSchema` (`validators.ts:11`) is `/^\d{2}:\d{2}$/`** — it accepts `"99:99"` and
  `"24:00"`. Verified: it has exactly two callers, both absence routes, so tightening is
  contained.
- **The 23:59 ceiling is provably inert.** `absences_time_check` already requires
  `end_time > start_time` on two `TIME` columns for a single date, so 23:59 is already the
  maximum. Verified independently: the literals `23:59` and `24:00` appear nowhere in `src/`,
  `supabase/` or `scripts/`. No ceiling rule is planned.
- **Postgres `TIME` round-trips as `"HH:MM:SS"`, request bodies carry `"HH:MM"`.** Confirmed
  by `AbsenceFormDialog.tsx:44`'s `start_time?.slice(0, 5)`. The widened PATCH read will mix
  both formats.
- **Legacy data does not break.** Applying floor + cap to the 8 live partial-day rows: the two
  junk rows fail (and are being deleted), and all six survivors already comply — starts 09:00
  ×4, 16:27, 16:52; durations 4 h, 7 h, 2.5 h, 4 h, 1 h, 1 h. No backfill, no grandfathering.
  Because enforcement clamps rather than rejects, and no DB CHECK is added, even an
  un-purged out-of-window row stays editable.

### Key Discoveries

- `FULL_DAY_HOURS = 8` already exists at `src/lib/hours.ts:8`, dependency-free and explicitly
  "safe to import from both React islands and server routes" — the duration cap reuses it.
- `src/lib/absence-types.ts` is the established shape for a domain rule shared by the form
  (UX) and the API (enforcement): a dependency-free module, with the DB-aware half split into
  `src/lib/services/absence-partial-day.ts`. The clamp follows this shape; it needs no DB
  access, so it is a single dependency-free module.
- Both routes already return the **stored** row (`index.ts:228-241`, `[id].ts:133-145`), so
  the frame's "return the stored row" mitigation for silent server-side rewriting is already
  satisfied — it needs asserting, not building.
- `tests/e2e/absence-form-dialog.spec.ts` already covers this dialog and the time inputs
  already carry `aria-label="Czas od"` / `"Czas do"` (`AbsenceFormDialog.tsx:238,250`) — the
  spec's comment at `:29-30` predicting them is now stale.
- `src/tests/api/absences/partial-day-guard.test.ts` is the model for route-level tests:
  `describe.skipIf(!process.env.DATABASE_URL_DIRECT)`, a narrow `APIContext` cast, real
  handler invocation.

## Desired End State

A partial-day absence can never be stored with a start before 06:00 or a duration over 8 h,
through any path the application exposes. Values outside those bounds are silently corrected
rather than rejected — both in the form as the user edits, and on the server for crafted
requests. The one range that cannot be corrected (ending at or before 06:00) is rejected with
a message naming the actual rule.

Verify by: entering `04:00–13:00` in the dialog and watching it become `06:00–13:00` on blur;
`POST`ing `{"start_time":"01:00","end_time":"22:00"}` with a valid session and reading
`06:00:00`–`14:00:00` back in the 201 response body.

## What We're NOT Doing

- **No ceiling rule.** 23:59 is unreachable today and always has been; the floor plus the
  duration cap bound the range at the top.
- **No DB CHECK for the duration cap.** Decided: the server clamps before writing, so the
  constraint could never fire from the app path — and if it did, it would surface as `23514`
  → the misleading *"Nieprawidłowa kombinacja godzin i trybu całodniowego."* (`index.ts:253`,
  `[id].ts:168`). It would also add a second hand-re-add landmine to the one already flagged
  at `src/db/schema.ts:56` and in `AGENTS.md`. Accepted cost: direct DB writes stay unbounded.
- **No change to `PARTIAL_DAY_TYPE_NAMES`.** The `wyjazd zagraniczny` row is already illegal
  under `src/lib/absence-types.ts:11` — it predates the guard and is purged, not coded around.
- **No configurable workday length.** `FULL_DAY_HOURS` stays a constant, consistent with
  `context/changes/absence-hours-range/plan-brief.md:45-48`.
- **No backfill or grandfathering migration.** Every surviving row already complies.
- **No new rejection UI in the dialog.** `end < start` keeps its existing path — server 400,
  `toast.error` with the server message (`AbsenceFormDialog.tsx:126`).
- **No revision of `src/tests/lib/hours.test.ts:8`.** `hoursToDays(16) === 2` stays valid as a
  pure-function assertion; it simply no longer describes a reachable absence.

## Implementation Approach

One dependency-free module owns the rules. The client imports it for on-blur correction; both
API routes import it to clamp before writing. Layering matches the existing partial-day guard:
the shared rule is stated once, and each layer applies it — the client for immediacy, the
server for authority.

Clamping is deliberately **not total**. Flooring the start can leave `end < start`, which no
clamp can repair and `absences_time_check` forbids, so a reject path survives and the module
returns a discriminated result rather than always producing a range.

## Critical Implementation Details

**Clamp ordering is load-bearing.** Floor first, then cap duration, with the reject test
between them. `start 01:00, end 23:00` → floor → `06:00–23:00` → cap → `06:00–14:00`. Running
the cap first would produce `01:00–09:00`, then flooring gives `06:00–09:00` — a 3 h absence
from the same input. Only the specified order is correct.

**The late-start case needs no special handling.** `start 20:00` cannot hold 8 h before
midnight, so the cap is implicitly `min(8h, 23:59 − start)`. This falls out of the arithmetic:
`min(end, start + 8h)` where `end ≤ 23:59` already. Do not add a separate branch for it.

**Time formats differ by source.** Postgres returns `TIME` as `"HH:MM:SS"`; request bodies
carry `"HH:MM"`. The clamp must normalize on the way in. On the way out, `"HH:MM"` is accepted
by the `TIME` columns, so no denormalization is needed.

**Nullable columns break the CAS pin idiom.** The existing pins at `[id].ts:126-130` compare
`absence_type_id` and `is_full_day`, both `NOT NULL`, so `eq()` always works. `start_time` and
`end_time` are nullable — a full-day row has `NULL` in both. `eq(col, null)` does not produce
`IS NULL` in SQL; use `isNull()` for that branch or the pin silently matches zero rows and the
handler reports a spurious 409.

**PATCH may have to write a column the body omitted.** If the body omits `start_time` and the
existing row holds `01:14`, the effective range still clamps and the clamped value must reach
the `UPDATE`'s `set`. Merging clamped values back into `parsed.data` is the point where this
is easy to get wrong.

## Phase 1: Clamp module and time-format tightening

### Overview

Establish the rules as pure functions with no I/O, and close the malformed-time hole they
would otherwise inherit. Fully verifiable by unit test, with no database involved.

### Changes Required:

#### 1. The shared clamp module

**File**: `src/lib/absence-hours.ts` (new)

**Intent**: State both rules once, in a module importable from React islands and server routes
alike — mirroring the header comment and dependency-free discipline of
`src/lib/absence-types.ts` and `src/lib/hours.ts`. Record in a comment that 06:00 is a
**plausibility floor chosen by the team**, not a building-access or regulatory figure: it is
the earliest hour at which a work-related partial-day absence is credible. The frame
(`frame.md`) established that the original building-access rationale stopped matching once
the figure moved from 07:15 to 06:00 — say so, so the next reader is not misled.

**Contract**: Exports `MIN_START_TIME = "06:00"` and a clamp function taking start and end
times and returning a discriminated result — either the corrected pair or a rejection. It
imports `FULL_DAY_HOURS` from `@/lib/hours` for the cap rather than restating `8`.

The algorithm's ordering is the contract, and it is not the obvious one:

```
1. normalize both to minutes (tolerate "HH:MM" and "HH:MM:SS")
2. flooredStart = max(start, 06:00)
3. if (end <= flooredStart) → reject        // no clamp can repair this
4. cappedEnd = min(end, flooredStart + FULL_DAY_HOURS * 60)
5. return { flooredStart, cappedEnd } as "HH:MM"
```

Step 3 sits *between* the two clamps, not before them: a range only becomes unclampable
*because* the start was floored. Reaching step 3 requires `start < 06:00 && end <= 06:00` —
when `start >= 06:00`, `flooredStart === start` and the callers' existing `end > start` check
already guarantees the branch is unreachable. The rejection message may therefore honestly
name 06:00 as the boundary.

#### 2. Tighten the time format

**File**: `src/lib/validators.ts`

**Intent**: `TimeSchema` accepts `"99:99"` and `"24:00"` today, which reach the database as a
`22007` and surface as a 500 rather than a 400. Now that the clamp performs arithmetic on the
value, a permissive schema is worse than a bad status code — `"99:99"` would clamp to a
plausible-looking wrong time and be stored. Narrow it to real `00:00`–`23:59`.

**Contract**: `TimeSchema` still parses to `string` in `"HH:MM"` form and keeps its
`"Invalid time format HH:MM"` message; only the accepted set narrows. Both call sites
(`index.ts:140-141`, `[id].ts:20-21`) are unchanged. Their `end_time > start_time` string
comparisons stay valid — the comment justifying them ("TimeSchema guarantees HH:MM format")
becomes more true, not less.

#### 3. Unit tests

**File**: `src/tests/lib/absence-hours.test.ts` (new)

**Intent**: Pin the ordering and the reject path, which are the parts most likely to be
"simplified" into incorrectness later.

**Contract**: Cover — an in-bounds range passes through untouched; `04:00–13:00` → `06:00–13:00`;
`08:00–20:00` → `08:00–16:00`; the ordering case `01:00–23:00` → `06:00–14:00` (asserting it is
*not* `06:00–09:00`); the reject case `01:00–03:00`; the late-start case `20:00–23:00` passing
through unclamped; boundary values `06:00` start and an exactly-8 h range; and `"HH:MM:SS"`
input normalizing identically to `"HH:MM"`.

**File**: `src/tests/lib/validators.test.ts` (new)

**Contract**: `TimeSchema` accepts `00:00`, `23:59`, `09:05`; rejects `24:00`, `99:99`,
`9:05`, `09:5`, `""`. Add `DateSchema` coverage only if it comes for free — it is not the
target of this change.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:run`
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- None — this phase adds no reachable behavior. Proceed directly to Phase 2.

---

## Phase 2: Server-side enforcement

### Overview

Bind both rules in `POST` and `PATCH`. This is the authoritative layer: a crafted request that
skips the browser entirely must still store a bounded range.

### Changes Required:

#### 1. Clamp on create

**File**: `src/pages/api/absences/index.ts`

**Intent**: After zod parsing and after the partial-day type guard, clamp the range before the
insert. Zod's refine (`:145-154`) already guarantees that a non-full-day body carries both
times with `end > start`, so the clamp receives a well-formed pair.

**Contract**: Applies only when `is_full_day` is false. A rejection returns 400 with the
message naming the 06:00 boundary — a new message, distinct from the existing combination
message at `:152`, and Polish to match every other string in the file. On success the clamped
values replace those in `absenceData` before `.values(...)`. The existing `.returning(...)` at
`:228-240` already sends the stored row back, so a silently corrected range is visible to the
caller in the 201 body — no response change needed.

#### 2. Clamp on update, and widen what PATCH knows

**File**: `src/pages/api/absences/[id].ts`

**Intent**: `PATCH` must clamp *effective* values — body value where present, existing row
value otherwise — exactly as the partial-day guard already does for type and full-day state
(`:107-108`). Today the existing-row read cannot support that, because it selects only two
columns.

**Contract**: Three coupled edits, in this order:

- **Widen the select at `:96-98`** to include `start_time` and `end_time`, and widen the
  `existing` type annotation at `:94` to match (both nullable).
- **Compute effective times** alongside `effectiveTypeId` / `effectiveIsFullDay` at
  `:107-108`, then clamp when `effectiveIsFullDay` is false and both times are non-null.
  Merge the clamped values back into `parsed.data` so they reach the `UPDATE`'s `set` even
  when the body omitted that column — see *Critical Implementation Details*. Note that
  `AbsenceFormDialog.tsx:101-116` always sends the full field set, so this merge path only
  serves crafted or future partial requests; it must still be correct.
- **Extend the CAS pin at `:126-130`** to cover `start_time` and `end_time` when the body
  omits them, matching the comment's existing rationale at `:121-125`: the guard judged
  effective state read a moment ago, so a concurrent write to those fields must make this
  `UPDATE` match zero rows rather than land on stale premises. Both columns are nullable —
  the `NULL` branch needs `isNull()`, not `eq(col, null)`. The zero-rows 404-vs-409 fallback
  at `:146-155` needs no change; it already keys off `casConditions.length > 0`.

A clamp rejection returns the same 400 as `POST`. The `.returning(...)` at `:133-145` already
carries the stored row back.

#### 3. Route-level tests

**File**: `src/tests/api/absences/hours-clamp.test.ts` (new)

**Intent**: Assert the HTTP contract, so that removing the clamp call from either route fails
here even though the module keeps working. This is the same division of labour
`partial-day-guard.test.ts:22-26` describes between service-level and route-level coverage.

**Contract**: Follow `partial-day-guard.test.ts` exactly — `describe.skipIf(!process.env.DATABASE_URL_DIRECT)`,
the `makeContext` narrow `APIContext` cast, `createTestEmployee` / `teardownTestEmployee`
fixtures, real handler invocation. Cover: `POST` with `01:00–22:00` returns 201 whose body
holds `06:00:00`–`14:00:00` (asserting on the **response body**, which is what makes silent
rewriting observable); `POST` with `01:00–03:00` returns 400; `PATCH` sending both times
clamps; `PATCH` sending only `end_time` against a stored `09:00` start clamps against the
effective range; an in-bounds range round-trips byte-identical. Use unique dates per test —
`absences` has a `unique(employee_id, date)`.

### Success Criteria:

#### Automated Verification:

- Route tests pass against the direct DB: `DATABASE_URL_DIRECT=... npm run test:run`
- Full suite passes: `npm run test:run`
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Against the **production deployment** (per `CLAUDE.md`, Drizzle queries fail under
  `wrangler dev`): a crafted `POST` with `start_time: "01:00", end_time: "22:00"` returns 201
  and the response body shows `06:00:00`–`14:00:00`.
- A crafted `POST` with `01:00–03:00` returns 400 with a message naming 06:00, not the generic
  combination message.
- Editing an existing in-bounds absence through the UI still saves unchanged — no accidental
  clamping of compliant rows (e.g. the `16:27–17:27` row).
- Editing one of the two out-of-window legacy rows through the UI succeeds and silently
  corrects it — confirming no new failure mode on legacy data before Phase 4 removes them.

**Implementation Note**: Pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Client-side on-blur correction

### Overview

Apply the same rules in the dialog so the user sees the legal value while editing rather than
discovering it after the page reloads.

### Changes Required:

#### 1. Correct the time inputs on blur

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Both time inputs (`:236-258`) correct their value when focus leaves, using the
Phase 1 module — so the form and the API enforce one rule from one source, exactly as
`typeAllowsPartialDay` is already shared between them (`:7`, `:63`, `:75`).

**Contract**: An `onBlur` on each `Input` runs the clamp over the current `startTime` /
`endTime` pair and writes both back through their existing setters. Skip entirely when either
field is empty — the user is mid-entry, and `saveDisabled` (`:65`) already gates that. On a
clamp rejection, leave both values untouched: that input keeps its current behavior of a
server 400 surfaced through `toast.error` (`:126`), and adding inline rejection UI is out of
scope. `onChange` stays untouched, so typing is never interrupted mid-keystroke.

Note `existingAbsence.start_time` arrives as `"HH:MM:SS"` and is sliced to `"HH:MM"` at
`:44,47` before entering state, so the clamp always sees `"HH:MM"` here — but it tolerates
both regardless.

#### 2. E2E coverage

**File**: `tests/e2e/absence-form-dialog.spec.ts`

**Intent**: The existing spec already opens this dialog and reveals the time inputs, so the
correction behavior extends it rather than starting a new file.

**Contract**: Add a test that fills `04:00` into "Czas od" and a valid end, blurs, and asserts
the start input reads `06:00`; and one that fills an over-long range and asserts the end pulls
back to start + 8 h. Use `getByLabel("Czas od")` / `getByLabel("Czas do")` — the aria-labels
are present at `:238,250`, so the ID-based fallback and its stale comment at `:28-31` can go.
Follow `tests/e2e/e2e-rules.md`: no `waitForTimeout`, self-contained setup and cleanup, unique
date per test.

### Success Criteria:

#### Automated Verification:

- E2E suite passes against the deployed app: `npm run e2e`
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Entering `04:00`–`13:00` and tabbing out shows `06:00`–`13:00`.
- Entering `08:00`–`20:00` and tabbing out shows `08:00`–`16:00`.
- Entering `01:00`–`03:00` leaves both values alone; Save produces the 06:00 error toast.
- Typing a start time digit by digit is never interrupted or rewritten mid-entry.
- Switching to a non-training type still clears the range (`:75-79` regression check).

**Implementation Note**: Pause here for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Purge the two demo rows

### Overview

Remove the two hand-entered reproductions of design-mockup fixtures. They are the only live
rows that violate the new rules, and both predate the partial-day guard.

### Changes Required:

#### 1. Purge migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_purge_demo_partial_day_absences.sql` (new)

**Intent**: Delete the two rows traced to `new-design/10xUrlopy.dc.html:646,652`
(`2026-06-12` `01:14–06:14`, and `2026-06-01` `01:22–03:22` — the latter also carrying
`wyjazd zagraniczny`, a type that `src/lib/absence-types.ts:11` has never permitted as
partial-day). Committing this as a migration rather than running ad-hoc SQL keeps it
auditable and reproducible across environments, matching the precedent of the data `UPDATE`
in `20260605000001_absence_start_end_time.sql:17-22`.

**Contract**: Timestamp must sort after `20260810112112_flippant_the_fury.sql`. The `DELETE`
predicate must be narrow enough that it can only ever match these two rows — key on exact
`date` **and** both exact time values **and** `NOT is_full_day`, not on a range expression or
on the time bounds alone. Lead with a comment recording why these rows are junk and where the
values came from, in the style of the existing migration headers.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:migrate`
- Full suite still passes: `npm run test:run`
- No Drizzle schema drift introduced: `npm run db:generate` produces no new migration

#### Manual Verification:

- A `SELECT` over partial-day rows returns 6 rows, all with `start_time >= '06:00'` and
  `end_time - start_time <= INTERVAL '8 hours'`.
- The two dates (`2026-06-12`, `2026-06-01`) show no absence in the grid for the affected
  employees.
- Statistics and the holiday balance card render without error and their totals dropped by
  exactly the purged rows' contribution (5.00 h and 2.00 h → 0.875 days combined).

**Implementation Note**: This is the final phase. After manual confirmation, close out the
change and update `change.md` to `status: implemented`.

---

## Testing Strategy

### Unit Tests

- `src/tests/lib/absence-hours.test.ts` — clamp ordering, the reject branch, boundary values
  (`06:00` start, exactly 8 h), late-start pass-through, `"HH:MM:SS"` normalization.
- `src/tests/lib/validators.test.ts` — `TimeSchema` accepts `00:00`/`23:59`, rejects
  `24:00`/`99:99` and malformed widths.

### Integration Tests

- `src/tests/api/absences/hours-clamp.test.ts` — handler-level HTTP contract for `POST` and
  `PATCH`, asserting on **response bodies** so silent server-side correction is observable.
  Includes the partial-`PATCH` effective-value path that Phase 2's widened select enables.

### E2E Tests

- `tests/e2e/absence-form-dialog.spec.ts` — on-blur correction for both the floor and the cap.

### Manual Testing Steps

1. Deploy to production (Drizzle cannot run under `wrangler dev`).
2. In the dialog, enter `04:00`–`13:00`, tab out, confirm `06:00`–`13:00`, save, reload,
   confirm the stored range.
3. Enter `08:00`–`20:00`, tab out, confirm `08:00`–`16:00`.
4. Enter `01:00`–`03:00`, tab out, confirm nothing changed; save and confirm the 06:00 toast.
5. `curl` a `POST` with `01:00`–`22:00` and confirm `06:00:00`–`14:00:00` in the 201 body.
6. Edit an existing compliant absence without touching its times; confirm it round-trips
   unchanged.
7. After Phase 4, confirm both purged dates are empty in the grid and the balance card totals
   moved by exactly 0.875 days.

## Performance Considerations

The clamp is integer arithmetic on two strings, once per write. `PATCH` gains two columns on a
`SELECT` it already performs — no extra round trip. There is no read-path change, so the grid,
statistics and balance queries are untouched.

## Migration Notes

Only Phase 4 touches the database, and only as a two-row `DELETE`. No schema change, so
`src/db/schema.ts` is unmodified and the `absences_time_check` hand-re-add discipline flagged
at `schema.ts:56` and in `AGENTS.md` is not triggered.

Rollback is per phase: reverting Phases 1–3 restores the prior unbounded behavior with no data
implications, since clamping only ever narrowed values that were written. The Phase 4 `DELETE`
is not reversible from the repo — capture the two rows' full contents before applying if you
want the option.

## References

- Frame brief: `context/changes/absence-hours-window/frame.md`
- Change identity: `context/changes/absence-hours-window/change.md`
- Prior decisions: `context/changes/absence-hours-range/plan-brief.md:22,26,45-48`
- Similar shared-rule implementation: `src/lib/absence-types.ts` +
  `src/lib/services/absence-partial-day.ts`
- Route-test model: `src/tests/api/absences/partial-day-guard.test.ts:16-26,44-60`
- E2E conventions: `tests/e2e/e2e-rules.md`
- Constraint origin: `supabase/migrations/20260605000001_absence_start_end_time.sql:25-30`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Clamp module and time-format tightening

#### Automated

- [x] 1.1 Unit tests pass: `npm run test:run`
- [x] 1.2 Type checking passes: `npm run build`
- [x] 1.3 Linting passes: `npm run lint`

### Phase 2: Server-side enforcement

#### Automated

- [ ] 2.1 Route tests pass against the direct DB
- [ ] 2.2 Full suite passes: `npm run test:run`
- [ ] 2.3 Type checking passes: `npm run build`
- [ ] 2.4 Linting passes: `npm run lint`

#### Manual

- [ ] 2.5 Crafted POST `01:00–22:00` returns 201 with `06:00:00`–`14:00:00` in the body
- [ ] 2.6 Crafted POST `01:00–03:00` returns 400 naming 06:00
- [ ] 2.7 Editing an existing in-bounds absence saves unchanged
- [ ] 2.8 Editing an out-of-window legacy row succeeds and silently corrects it

### Phase 3: Client-side on-blur correction

#### Automated

- [ ] 3.1 E2E suite passes: `npm run e2e`
- [ ] 3.2 Type checking passes: `npm run build`
- [ ] 3.3 Linting passes: `npm run lint`

#### Manual

- [ ] 3.4 `04:00–13:00` becomes `06:00–13:00` on blur
- [ ] 3.5 `08:00–20:00` becomes `08:00–16:00` on blur
- [ ] 3.6 `01:00–03:00` left untouched; Save produces the 06:00 toast
- [ ] 3.7 Typing a start time is never rewritten mid-entry
- [ ] 3.8 Switching to a non-training type still clears the range

### Phase 4: Purge the two demo rows

#### Automated

- [ ] 4.1 Migration applies cleanly: `npm run db:migrate`
- [ ] 4.2 Full suite still passes: `npm run test:run`
- [ ] 4.3 `npm run db:generate` produces no new migration

#### Manual

- [ ] 4.4 Partial-day rows number 6, all within the floor and the cap
- [ ] 4.5 Both purged dates show no absence in the grid
- [ ] 4.6 Balance card totals dropped by exactly 0.875 days
