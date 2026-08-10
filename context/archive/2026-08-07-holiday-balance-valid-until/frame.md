# Frame Brief: "Do dnia" (`holiday_balances.valid_until`)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

`Do dnia` (`holiday_balances.valid_until`) is a free-form date input that every
employee types by hand in the balance card's `Edytuj` dialog
(`src/components/holiday/HolidayBalanceDialog.tsx:234-244`, label
`"Do dnia (opcjonalnie)"`). Raised during S-17 (`huge-ui-ux-improvement`) manual
verification, rows 7.8 / 7.10.

## Initial Framing (preserved)

- **User's stated cause or approach**: the value is mechanically derivable from the
  balance year, so asking a user for it is pure friction — *"Less thinking by the
  user the better."* Non-moderators should not be offered it at all.
- **User's proposed direction**: derive `valid_until` as 31 December of the balance
  year (2026 → `2026-12-31`, rolling to `2027-12-31` on 1 Jan 2027); gate the input
  to moderators; fold in the two S-17 leftovers (moderator editing every employee's
  balance from `Pracownicy`; `Korekta` / `Do dnia` leaving the balance card's
  `Edytuj`) and the row-7.9 blocker.
- **Pre-dispatch narrowing**: the **free-form `Do dnia` itself** is the leading
  concern (not the moderator-reachability blocker, not field relocation). Stored
  data is **mostly empty / null**. The date means **"HR provenance / as-of"** —
  *"these numbers are what HR showed as of this date"* — not a deadline.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Field semantics** — `Do dnia` has never had a settled meaning. Column name says
   expiry, UI label says deadline, schema comment says provenance.
2. **Derivation rule** — 31 Dec of the balance year is the wrong (or empty) value.
   ← initial framing
3. **Storage necessity** — the column is redundant; the January rollover worry is an
   artifact of storing a derivable value.
4. **Whether the field earns its place** — mostly null + hidden-when-null means it
   conveys nothing today.
5. **Write-path gating / reachability** — the moderator gate and the row-7.9 blocker.
   Deprioritised by the user at Step 1.5; tracked as a separable branch.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. The meaning was never settled** | Five conflicting readings on one column: `valid_until` (expiry) vs UI `Do dnia:` (deadline, `HolidayBalanceCard.tsx:53`) vs `// informational HR provenance date` (`src/db/schema.ts:82`) vs `datę-wskazówkę` (`roadmap.md:283`) vs *"the field governs carryover"* (`change.md:31`). The two test fixtures encode **contradictory** meanings and both pass: `korekta-gate.test.ts:22,52` → `2031-09-30` for `YEAR=2031` (labour-law date); `used-computation.test.ts:11,113` → `2030-12-31` for `YEAR=2030`. Every assertion is round-trip identity; none asserts meaning. `DateSchema` (`src/lib/validators.ts:3-9`) checks ISO shape only — a 2030 row accepts `1999-04-17`. No PRD requirement exists: `prd.md` has zero occurrences of `valid_until`, "Do dnia", "saldo", or any balance concept. It is the only field in the dialog with no help text (contrast `Korekta`, `HolidayBalanceDialog.tsx:228-230`). | **STRONG** |
| **2. Derivation rule (initial framing)** | `${year}-12-31` is internally consistent — the Used window already terminates at 31 Dec (`holiday-balance.ts:21-22`), the row is keyed `(employee_id, year)` (`schema.ts:89`), and the prototype defaults new staff to `st.year + '-12-31'` (`new-design/10xUrlopy.dc.html:1332-1333`). **But the derived value is information-free**: `HolidayBalanceCard.tsx:41` already renders `Urlop 2026 – pozostało`; `:53` would render `Do dnia: 2026-12-31` twelve lines later. Because `:52` gates on truthiness, deriving makes a redundant line newly visible on *every* row. It would also print, beside the `Zaległe` tile (`:62`), a date that is not that figure's statutory deadline (Kodeks pracy art. 168 → 30 Sep of the following year). | **WEAK** (correct rule, no payload) |
| **3. Storage is unnecessary** | Sole read is a pass-through (`holiday-balance.ts:86`); `leftDays` (`:77`) and `computeUsedDays` (`:15-59`) ignore it. No SQL predicate, index, constraint, or RLS policy references it. The rollover worry is confirmed self-inflicted: **nothing runs on a schedule** — `wrangler.jsonc` has no `triggers`/`crons`, the Worker entry (`sentry.server.config.ts:8-15`) exports only `fetch`, `ci.yml:3-7` is push/PR only. A *stored* value has no rollover mechanism; a *derived* one rolls over free. | **STRONG** |
| **4. The field does not earn its place** | Nullable, no DB default (`20260713124938_premium_brother_voodoo.sql:8`), no seed writes it, dialog round-trips `"" → null` (`HolidayBalanceDialog.tsx:59,127`), card hides the line when null (`:52`). Default state is invisible — corroborated by the user's "mostly empty / null". `updated_at` exists and is maintained (`index.ts:201`) but is stripped by `buildBalanceView` and never rendered. The real HR screen the card mirrors (`plan_urlopów_example.png`: Rok / Okres / Status / Przysługuje / Pozostało) **has no date column** — the field was not copied from the system it claims provenance from. | **STRONG** |

Counter-evidence, recorded honestly (from the refutation pass): the field is not
consumer-free in the mechanical sense — it has a render path, a persisted contract,
a role decision encoded in a test *name* (`korekta-gate.test.ts:99`), and island-prop
serialization (`dashboard.astro:232`). And the 31-Dec rule is design-sanctioned, not
invented. Neither fact rescues the *value* the field carries.

## Narrowing Signals

- **The meaning is provenance, not deadline** (user, Step 1.5). This is decisive: a
  provenance date is *"when someone last read HR"* — a past fact that **cannot be
  derived from `year`**. The proposed rule (31 Dec, a future expiry) computes a
  different field from the one the user says this is. `updated_at` already answers
  the provenance question, for free, and is never shown.
- **The HR exception is hypothetical** (user, Step 4). `change.md:45-46` asserts an
  individually-extended September carryover deadline "is the reason the field exists
  at all." Never observed. This removes the only reason real rows would hold
  meaningful non-December dates, and moots the "can a moderator override it?"
  question.
- **The pool split is workable from the tiles** (user, Step 4). The card sums
  `current + carryover − used` flat (`holiday-balance.ts:77`) and no code decides
  whether a used day burns carryover or entitlement first — but the user can work it
  out from Bieżące / Zaległe / Wykorzystane. So "replace it with a real carryover
  deadline" is not warranted by felt need.
- **Stored data is mostly null** (user, Step 1.5), consistent with every code path.

## Added During Discussion (2026-08-10) — a fourth observation

Raised by the user after the investigation closed: *the balance card should present
information about the **current** year only — Bieżące / Zaległe / Wykorzystane should
be associated with the current year.*

**It does not do that today.** The card is bound to the *browsed* year, not the current
one. `dashboard.astro:142` fetches the row with `eq(holiday_balances.year, year)`, where
`year` derives from the `?month=YYYY-MM` param falling back to `now.getFullYear()`
(`:29`); `:230-235` passes the same `year` into the card, which titles itself
`Urlop {year} – pozostało` (`HolidayBalanceCard.tsx:41`).

Consequence: navigating to `?month=2025-03` renders the 2025 balance — 2025's tiles,
2025's `left_days` — in **identical styling to a live card**. No badge, no muting, no
staleness signal. If no row exists for that year the card shows
*"Brak wprowadzonego wymiaru urlopu."* (`:44`), which reads as "you haven't entered your
quota" rather than "that year is closed".

Related, and unlinked: years are wholly independent records. `Zaległe` is typed by hand
each year with no computed relationship to the prior year's remainder
(`archive/2026-06-22-urlop-balance/plan.md:38` — *"Not auto-rolling carryover between
years"*), so the 2026 card and the 2025 card share nothing but an employee id.

**Bearing on `Do dnia`** — bidirectional, and neither direction rescues the field:

- If the card is **pinned to the current year**, `year` is effectively constant on the
  card and `Do dnia: 2026-12-31` beside `Urlop 2026` is maximally redundant. Strengthens
  removal.
- If the card **keeps following month-nav**, a historical year genuinely needs marking —
  but the missing signal is a *state* treatment (muted styling / "zakończony" badge /
  distinct empty state), not a date. `Do dnia: 2025-12-31` under `Urlop 2025` still adds
  no information.

**User's answer (2026-08-10)**: the card should **stay on the current year** — browsing
the grid to an older month must not change it.

This is decisive against deriving. With the card pinned, `year` is always the current
year, so `${year}-12-31` renders **the same constant string on every card for every
employee all year** (`Do dnia: 2026-12-31` under a heading reading `Urlop 2026`). The
derivation would cost a migration, a backfill decision and a permissions reversal to
display a constant.

Scope note: `year` already defaults to `now.getFullYear()` when no `?month` param is
present (`dashboard.astro:29`), so the *default* view is current-year today. Pinning
changes only the navigation case — decoupling the balance card's year from the grid's
month. That is a narrow change, and it serves "less thinking by the user" more directly
than the `Do dnia` work does. Unaffected either way: on 1 Jan 2027 the card flips to
`Urlop 2027`, finds no row, and shows the empty state until that year's Bieżące /
Zaległe are entered — which the user must do regardless.

This observation is **separable** from the `Do dnia` question and may deserve its own
change. It is recorded here because it arrived during framing, not because it belongs to
this change's scope.

## Cross-System Convention

**The house answer to this exact shape already exists, inside this same table.** S-15
refused to store HR's "Wykorzystane" as a user-entered number — it is computed from
tracked absences, with `used_adjustment_days` as an explicit escape hatch for cases
computation gets wrong (`context/archive/2026-06-22-urlop-balance/plan.md:7,44`;
`plan-brief.md:19,21`). A second HR-sourced value that users type, that nothing reads,
and that is derivable, is the same problem the feature already solved once.

The project's rule for removing a user-visible field is set by the `Dodano` precedent:
S-17's prototype proposed dropping it and was **refused** because FR-006 backs it
(`huge-ui-ux-improvement/plan-brief.md:41`, `plan.md:104`). `valid_until` has **no PRD
requirement** — so that gate does not block here. But `roadmap.md:283` does commit to
the employee typing it (*"pracownik wpisuje … oraz datę-wskazówkę «Do dnia:»"*), and
that line needs amending whichever direction this goes. Nothing in `context/**`
currently flags it.

The one DROP-COLUMN precedent is `absences.hours` → `start_time`/`end_time`
(`20260605000001_absence_start_end_time.sql`), where the plan said "no conversion
needed" and the migration wrote a backfill anyway — the house style for the
existing-rows question.

## Reframed Problem Statement

> **The actual problem to plan around is**: `Do dnia` was given a form control before
> anyone decided what it denotes, and it still denotes nothing — so the question is
> not how to fill it in, but whether the balance card should say anything about the
> figures' validity at all, and if so, what fact.

The typing friction is a symptom, not the disease: a user has to think about what to
type because the field never posed a question. The reframe matters because the two
halves of the initial framing are mutually inconsistent — the stated meaning
(HR provenance, "as of when these numbers were true") is a *past* fact the app already
records as `updated_at`, while the proposed derivation (31 December, entitlement
expiry) is a *future* fact computable from `year` alone. Deriving `${year}-12-31`
would give an undecided field a confident-looking value that restates the card's own
title, make it newly visible on every row, and assert a deadline beside `Zaległe` that
contradicts the statute governing it — while costing a migration, a backfill decision,
a permissions reversal, and a rollover mechanism the app has no scheduler for.

The initial framing was **not** correct, but it was not baseless either: the 31-Dec
rule is the only date consistent with the shipped arithmetic, and the prototype had
already defaulted to it. What the evidence overturns is the premise that the field
should be kept and improved.

## Confidence

**HIGH** — four independent investigations (three hypothesis agents plus one
hypothesis-blind reader) converged; the blind reader reached the same conclusion
without being told it, and an explicit refutation pass broke only the peripheral
claims ("no consumer", "the rule is arbitrary"), not the core. Two decisive
narrowing signals from the user (provenance meaning; HR exception hypothetical)
came from outside the code.

### Production data — run 2026-08-10, question closed

```sql
SELECT valid_until, COUNT(*) FROM holiday_balances GROUP BY 1;
-- null         → 1
-- "2026-08-07" → 1
```

**Two rows exist in all of production**, and the one non-null value is a verification
artifact: `e2da254` — the commit shipping the balance card and the Korekta gate — is
dated **2026-08-07**, the day the S-17 manual pass checked rows 7.6/7.8 (*"Moderator:
`Korekta` and `Do dnia` present and saving correctly"*). The value stored is the **date
of entry**.

This is the strongest evidence in the investigation because it is behaviour, not
documentation: the only human who ever filled this field in read it as *"these numbers
are as of today"* — the provenance meaning — and produced a value **neither documented
reading nor the proposed derivation would ever generate** (not 31 Dec, not 30 Sep).

Consequences:

- The last claim resting on impression rather than code is now confirmed by data.
- No row carries a meaningful HR date → the override case does not exist in data,
  matching the user's "the HR exception is hypothetical".
- `change.md:47` ("what happens to existing rows") is **answered, not deferred**: one
  null, one test artifact. No backfill strategy is required.
- Deriving would have **destroyed this evidence** — overwriting `2026-08-07` with
  `2026-12-31`, erasing the only real signal about what a person thought the field meant
  and replacing it with a value contradicting them.

## What Changes for /10x-plan

The plan should open on *what the card should tell the user about the balance's
validity or freshness* and settle that first — the input affordance and the moderator
gate follow from it, and one live option is that neither is needed because the field
goes away. Deriving-and-gating as originally scoped should not be the plan's starting
assumption.

Carry forward regardless of direction:

- **Live data-loss footgun.** `index.ts:200` writes `valid_until` **unconditionally**
  in `onConflictDoUpdate`, unlike `used_adjustment_days` which is spread conditionally
  (`:193`/`:202`). Any client omitting the key nulls the stored date. Raised as F1 in
  `archive/2026-06-22-urlop-balance/reviews/impl-review-phase-2.md:25-37`; the fix
  landed for `Korekta` only. Unreachable today solely because the dialog always sends
  the key (`HolidayBalanceDialog.tsx:127`) — **relocating the field detonates it**
  (`huge-ui-ux-improvement/reviews/impl-review.md:158`).
- **Migration hazard.** A drizzle-generated `DROP COLUMN` on `holiday_balances` risks
  silently taking `holiday_balances_year_check` and
  `holiday_balances_days_nonnegative_check` with it — both hand-added
  (`20260713124938_premium_brother_voodoo.sql:19-22`) and invisible to drizzle-kit.
- **Two prior decisions to supersede explicitly**, per `change.md:19-24`: S-15's "both
  roles may edit any balance" (`archive/2026-06-22-urlop-balance/plan.md:34`) and
  S-17's "`valid_until` is **not** gated" (`huge-ui-ux-improvement/plan.md:843-851`,
  verified shipped as rows 7.6/7.8). Plus `roadmap.md:283`, which commits to the
  employee typing the date and is not currently flagged anywhere.
- **Tests that encode the current behaviour** and must be changed deliberately, not
  silently: `korekta-gate.test.ts:52,99,114` (asserts a non-moderator may write
  `2031-09-30`) and `used-computation.test.ts:146` (`expect(view.valid_until).toBeNull()`).
- **Scope items deferred here by S-17 remain open and are separable** — moderator
  editing every employee's balance from `Pracownicy`, and the row-7.9 blocker
  (`HolidayBalanceCard` hard-wired to `currentEmployee.id`, `dashboard.astro:230-235`).
  The user marked these as not the leading concern; they are coupled to the deferred
  batch-balance endpoint, not to the `Do dnia` question.

**Pinning the card to the current year** (see "Added During Discussion") is a small,
independently valuable change the user confirmed they want: decouple the balance card's
`year` from the grid's `?month` param so browsing history cannot repaint the card with a
past year's figures. It touches `dashboard.astro:29,142,230-235` only, needs no
migration, and does not depend on how the `Do dnia` question is settled. It is a
candidate to lead this change, or to become its own.

Out of scope for this change but surfaced by the investigation, worth its own entry:
the card cannot express which pool remaining days come from, and no code decides
whether a used day burns carryover or entitlement first (`holiday-balance.ts:77`).
The user can work it out from the tiles today, so this is not urgent.

## References

- Source: `src/db/schema.ts:82-85,89`, `src/types.ts:23`,
  `src/lib/services/holiday-balance.ts:21-22,77,86`,
  `src/pages/api/holiday-balances/index.ts:115,147,192,200-201,234`,
  `src/components/holiday/HolidayBalanceCard.tsx:41,52-54,62`,
  `src/components/holiday/HolidayBalanceDialog.tsx:59,127,234-244`,
  `src/pages/dashboard.astro:230-235`, `src/lib/validators.ts:3-9`
- Tests: `src/tests/api/holiday-balances/korekta-gate.test.ts:22,52,99,114`,
  `src/tests/api/holiday-balances/used-computation.test.ts:11,113,121,146`
- Migration: `supabase/migrations/20260713124938_premium_brother_voodoo.sql:8,19-22`
- Prior decisions: `context/archive/2026-06-22-urlop-balance/plan.md:7,9,34,44,70`,
  `.../reviews/impl-review-phase-2.md:25-37`,
  `context/changes/huge-ui-ux-improvement/plan.md:91,149,811-816,843-851`,
  `.../change.md:27-48`, `.../reviews/impl-review.md:158`,
  `context/foundation/roadmap.md:283`, `context/foundation/prd.md:80,82`
- Design: `new-design/10xUrlopy.dc.html:473-474,484-526,671,675-685,1332-1333`
- Investigation tasks: #1 (field semantics), #2 (storage necessity / earns-its-place),
  #3 (prior decisions and precedent), plus two unregistered cross-check agents
  (hypothesis-blind read; adversarial refutation)
