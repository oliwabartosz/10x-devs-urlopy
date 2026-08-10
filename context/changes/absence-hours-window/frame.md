# Frame Brief: Restricting partial-day absence hours

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Partial-day absences currently accept any time range the browser's
`<input type="time">` will produce. They should be restricted to **07:15–23:59**.

Raised during S-17 (`huge-ui-ux-improvement`) manual verification, row 8.3.

## Initial Framing (preserved)

- **User's stated cause or approach**: `min`/`max` on the inputs is a hint, not
  enforcement — a crafted request bypasses it. The rule should live where the
  existing partial-day rule lives (`POST`/`PATCH /api/absences` via a shared
  service), not only in `AbsenceFormDialog`.
- **User's proposed direction**: Restrict partial-day hours to 07:15–23:59,
  enforced server-side, with existing-row handling decided (grandfather /
  migrate / validate-only-changed).
- **Pre-dispatch narrowing**: Out-of-window rows are **real entered rows**, not
  just fixtures. The window derives from **building access hours**. The window
  is the **leading concern**; `end_time > start_time` and midnight-crossing were
  written down as due diligence, not as live problems.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Window definition** — is `07:15–23:59` one rule, or two facts glued
   together from different sources?
2. **Enforcement layer** — is time validation really client-only today, so that
   the gap is "no server-side rule"?  ← initial framing
3. **Existing data** — real out-of-window rows exist; can a bounded rule coexist
   with `PATCH` on legacy rows?
4. **The observable** — is "outside 07:15–23:59" a proxy for "implausible
   range", i.e. a *duration* problem wearing *clock* clothing?

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. Window definition is two facts, not one** | `23:59` appears nowhere in the repo outside `change.md`. `absences_time_check` already requires `end_time > start_time` on two `TIME` columns for a single date (`supabase/migrations/20260605000001_absence_start_end_time.sql:25-30`), so 23:59 is *already* the maximum — the ceiling is a **no-op**. `07:15` likewise appears nowhere but `change.md`; the only clock anchor in the codebase is `09:00` (backfill at `20260605000001...sql:19`, and every test fixture). No working-hours/workday-placement concept exists anywhere — `astro.config.mjs:34-41` has no config surface, there is no `constants.ts`. The only encoded "when is work" fact is Mon–Fri (`prd.md:52`, `AbsenceGrid.tsx:275`). | **STRONG** |
| **2. Enforcement is client-only (initial framing)** | **False as stated.** Server validation is present twice — `index.ts:145-154` and `[id].ts:27-39` — plus the DB CHECK. What is client-only is *nothing*; the client has no time validation at all (`AbsenceFormDialog.tsx:65` gates emptiness only). The real gap: all three layers validate **presence + ordering + format**, and *no* layer has ever expressed **bounds**. Also `min`/`max` on the inputs would be inert — there is no `<form>`, Save is `type="button"` (`AbsenceFormDialog.tsx:369`), so HTML constraint validation never fires. | **WEAK** (direction right, premise wrong) |
| **3. Existing data breaks under a new rule** | Real, but smaller and stranger than assumed — see the live query below. Also: `[id].ts:96-98` selects only `absence_type_id, is_full_day`, never the times, so a bounds rule on *effective* values has nothing to merge against. And `AbsenceFormDialog.tsx:101-116` **always sends the full field set on PATCH** — so `change.md`'s third option, "validate only changed values", protects nobody using the app. The three options collapse to two. | **STRONG** |
| **4. The window is a proxy for implausible duration** | The only rationale ever recorded for constraining times is a **duration** argument: `absence-hours-range/plan-brief.md:26` — *"Zero-duration absences have no domain meaning"*. The system's definition of a day is a **duration**: `FULL_DAY_HOURS = 8` (`src/lib/hours.ts:8`), consumed by `holiday-balance.ts:58` and `AbsenceStats.tsx:18`. `schema.ts:65` makes one date worth at most one absence — yet `07:15–23:59` permits **16.73 h = 2.09 days on a single date**. The proposed window leaves that intact. An independent agent, given only the symptom and *not* this hypothesis, reached the same conclusion unprompted. | **STRONG** |

### Live production data (read-only query, 2026-08-10)

All 8 partial-day rows:

| date | type | range | hours |
| --- | --- | --- | --- |
| 2026-06-12 | szkolenie w miejscu pracy | 01:14–06:14 | 5.00 |
| 2026-06-01 | **wyjazd zagraniczny** | 01:22–03:22 | 2.00 |
| 2026-06-09 | szkolenie/wyjście poza… | 09:00–13:00 | 4.00 |
| 2026-06-08 | szkolenie/wyjście poza… | 09:00–16:00 | 7.00 |
| 2026-05-04 | szkolenie/wyjście poza… | 09:00–11:30 | 2.50 |
| 2026-05-01 | szkolenie/wyjście poza… | 09:00–13:00 | 4.00 |
| 2026-07-07 | szkolenie/wyjście poza… | 16:27–17:27 | 1.00 |
| 2026-08-07 | szkolenie/wyjście poza… | 16:52–17:52 | 1.00 |

Latest end ever recorded: **17:52**. Longest range: **7.00 h**. Nothing exceeds 8 h.

## Narrowing Signals

- **The two out-of-window rows are copied demo data.** `01:22–03:22` and
  `01:14–06:14` are verbatim the design mockup's seed values
  (`new-design/10xUrlopy.dc.html:646,652`). They are hand-entered
  reproductions of prototype fixtures, created 2026-05-30/06-01 — before the
  partial-day guard landed. No organic user has produced an out-of-window entry.
- **One of those rows is illegal on a rule that already exists.**
  `wyjazd zagraniczny` is not in `PARTIAL_DAY_TYPE_NAMES`
  (`src/lib/absence-types.ts:11`) — only the two training types are. A 07:15
  floor would **not** catch it; the same row at 09:00–11:00 passes cleanly.
  This is the single most nonsensical row in the table, and the proposed rule
  misses it.
- **The ceiling is provably inert.** `23:59` cannot be exceeded today and never
  has been (max observed 17:52). The change as titled is, in substance, a
  07:15 floor and nothing else.
- **`23:59` also answers the change's own open question.** `change.md:36` asks
  whether a range may cross midnight "now that 23:59 is the ceiling" — it
  cannot and never could, per `absences_time_check`.
- **The "why 07:15" evidence does not survive.** `change.md:33` justifies the
  number by "the seed data has absences starting at 01:22". No seed writes any
  absence row (`scripts/seed-admin.ts`, the two `seed_absence_types` migrations
  and `src/tests/helpers/fixtures.ts` all confirm); `01:22` is prototype dummy
  data. Building-access hours remain a legitimate external rationale — but it
  is an unwritten external fact, and the repo contradicts it with a 09:00 anchor.
- **Row 8.3 passed.** `huge-ui-ux-improvement/plan.md:1196` — *"[x] 8.3 Training
  type reveals hours controls; other types hide them — 709431d"*. It is about
  control *visibility*, not accepted *values*, and S-17's closing notes record
  five other follow-ons but not this one.

## Decisions Taken During Framing (2026-08-10)

The user reviewed the reframe and settled the following. These supersede the
initial framing above:

1. **Floor is 06:00**, not 07:15. The building-access rationale no longer matches
   the number — a written source for 06:00 still needs recording.
2. **Maximum duration is 8 hours** — the reframe's primary rule, accepted.
3. **Both rules auto-correct rather than reject.** A start before 06:00 clamps to
   06:00; a range longer than 8 h clamps to 8 h.
4. **Clamping binds at both client and server, silently.** A crafted 20 h request
   succeeds and stores 8 h.
5. **The two junk rows are purged**, not migrated.
6. **No explicit ceiling.** Floor + duration cap bound the range at the top; 23:59
   stays inert.

### Consequence: the legacy-data problem disappears

Applying floor 06:00 + duration ≤ 8 h to the 8 live rows: the two junk rows fail
(and are being deleted), and **all six survivors already comply** — starts
09:00 ×4, 16:27, 16:52; durations 4 h, 7 h, 2.5 h, 4 h, 1 h, 1 h. No backfill, no
grandfathering, no "validate only changed values" workaround. `change.md:27-29`'s
entire legacy-data section reduces to a two-row `DELETE`.

`wyjazd zagraniczny` needs **no code change** — `PARTIAL_DAY_TYPE_NAMES`
(`src/lib/absence-types.ts:11`) already excludes it. The offending row simply
predates the guard.

### Open items the plan must resolve

- **Clamp ordering.** Floor first, then duration (start 01:00–23:00 → 06:00–23:00
  → 06:00–14:00). Needs to be specified, not left to implementation order.
- **Unclampable inputs.** start 01:00, end 03:00 → clamping start to 06:00 leaves
  `end < start`, which no clamp can fix and `absences_time_check` forbids. This
  case must still reject.
- **Late starts.** start 20:00 cannot have 8 h within one date; the duration cap
  is implicitly `min(8h, 23:59 − start)`.
- **Silent-rewrite visibility.** Server clamping stores values the caller did not
  send. Returning the stored row in the response is the cheap mitigation.
- **DB CHECK's role.** If the server clamps before writing, the CHECK never sees a
  duration violation — so a duration clause in `absences_time_check` would be a
  backstop for direct DB writes only. Decide whether it is worth the
  hand-re-add discipline (`src/db/schema.ts:56`, `AGENTS.md`).

## Cross-System Convention

This project's convention for time rules is **relational, not absolute**:
`end_time > start_time` is the entire existing rule, expressed at three layers
(zod POST, zod PATCH, DB CHECK), with the DB as backstop. There is no precedent
anywhere for an absolute clock bound.

The convention for *day* semantics is a **duration**, not a placement:
`FULL_DAY_HOURS = 8` is a pure divisor with no clock anchor
(`hours.ts:17-18`), and both consumers compute `end − start` and are wholly
indifferent to where the range sits (`holiday-balance.ts:42`,
`AbsenceStats.tsx:17-21`). `absence-hours-range/plan-brief.md:45-48` explicitly
put "Configurable workday length" out of scope.

So the leading hypothesis (duration) matches convention; the initial framing
(clock window) has no precedent in this system to attach to.

Constraint mechanics to respect either way: `absences_time_check` is invisible
to drizzle-kit — flagged at `src/db/schema.ts:56` and in `AGENTS.md` — so it
must be hand-re-added after any `db:generate`. Postgres re-evaluates every table
CHECK on any UPDATE, and `absences` has a `BEFORE UPDATE updated_at` trigger, so
a CHECK-only window rule would make legacy rows uneditable — surfacing as
`23514` → the misleading message *"Nieprawidłowa kombinacja godzin i trybu
całodniowego."* (`index.ts:253`, `[id].ts:168`).

## Reframed Problem Statement

> **The actual problem to plan around is**: partial-day absences have no
> definition of a *valid* range beyond "forward-going" — and the axis that
> actually corrupts the app's accounting is **magnitude**, not clock position.

The system's own accounting asserts an invariant it never enforces: one date is
worth at most one day (`schema.ts:65` + `AbsenceStats.tsx:44` +
`holiday-balance.ts:41`), yet a partial-day range is divided by
`FULL_DAY_HOURS = 8` with no ceiling — so a single date can contribute up to
2.998 days to statistics and to the holiday balance. `src/tests/lib/hours.test.ts:8`
(`hoursToDays(16) === 2`) actively encodes the violation as expected behaviour.

The proposed 07:15–23:59 window addresses a real but narrower concern —
*plausibility* — and does so with a ceiling that is a verified no-op and a floor
whose only in-repo evidence traces to prototype dummy data. It would reject 2
rows, both hand-copied demo fixtures, and would not reject the one row in
production that is genuinely invalid (`wyjazd zagraniczny` as partial-day).

This does **not** make the window worthless. Building-access hours are a
legitimate rationale the user holds and the repo simply doesn't record. But the
window is the *second* rule, not the first, and it should be planned knowing
that its ceiling is inert and its floor needs a written source.

**Resolved.** The user accepted the reframe and kept both axes: an 8-hour
duration cap as the primary rule, plus a 06:00 floor (revised down from 07:15),
both auto-correcting. The inert 23:59 ceiling is dropped. See *Decisions Taken
During Framing* above.

## Confidence

**HIGH** — four hypothesis agents plus one independent agent that was never told
the hypothesis converged on the same conclusion; the decisive claims are backed
by a live production query and by exact `file:line` evidence; and the ceiling's
no-op status is provable from the existing CHECK constraint rather than inferred.

Residual uncertainty, all bounded: the 07:15 figure itself is an external
organisational fact that cannot be verified from this repo — it needs a written
source recorded with it, which `change.md:32` already anticipated.

## What Changes for /10x-plan

Plan **two auto-correcting rules on partial-day ranges**, both bound at client
and server:

1. **Duration ≤ `FULL_DAY_HOURS` (8 h)** — the primary rule. Restores an
   invariant three modules already assume (`schema.ts:65`, `AbsenceStats.tsx:44`,
   `holiday-balance.ts:41`) and reuses the existing constant (`hours.ts:8`)
   rather than introducing a number. Over-long ranges clamp to 8 h.
2. **Start ≥ 06:00** — clamps up. Needs its source recorded; it is no longer the
   building-access figure.

No ceiling rule. No backfill — instead a **two-row purge** of the junk data
(`01:14–06:14`, `01:22–03:22`); every surviving row already complies.

Resolve the clamp-ordering and unclampable-input cases listed under *Open items*
above before writing code — clamping is not total, so a reject path still exists.

`src/tests/lib/hours.test.ts:8` asserts `hoursToDays(16) === 2`; that stays valid
as a pure-function test but no longer describes a reachable absence.

Two side findings deserve routing, not silent inclusion: `TimeSchema`
(`src/lib/validators.ts:11`) accepts `"99:99"` / `"24:00"`, turning a bad value
into a 500 rather than a 400; and `[id].ts:96-98` selects only
`absence_type_id, is_full_day`, so it must widen to the time columns (extending
the CAS pin at `:126-130`) before it can clamp effective values on a partial
`PATCH`.

## References

- Source files: `src/lib/hours.ts:8`, `src/db/schema.ts:56,65`,
  `src/lib/absence-types.ts:11`, `src/lib/validators.ts:11`,
  `src/lib/services/absence-partial-day.ts`,
  `src/pages/api/absences/index.ts:145-154,253`,
  `src/pages/api/absences/[id].ts:27-39,96-98,126-130,168`,
  `src/components/absence/AbsenceFormDialog.tsx:65,101-116,236-258,369`,
  `src/components/absence/AbsenceStats.tsx:17-21,44`,
  `src/lib/services/holiday-balance.ts:41-42,58`,
  `supabase/migrations/20260605000001_absence_start_end_time.sql:19,25-30`,
  `src/tests/lib/hours.test.ts:8`
- Prior decisions: `context/changes/absence-hours-range/plan-brief.md:22,26,45-48`,
  `context/archive/2026-06-22-hours-onsite-training-only/plan.md`,
  `context/changes/huge-ui-ux-improvement/plan.md:1196`
- Investigation tasks: #1 (window definition), #2 (enforcement layer),
  #3 (existing data), #4 (the observable) — plus one independent cross-check
