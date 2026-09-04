# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-04

---

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (excluding `node_modules/`, `dist/`, `.wrangler/`, `.astro/`).

---

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                         | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Drizzle CRUD produces wrong DB state — an absence is silently not saved, double-saved, or deleted due to query translation issues after the Supabase JS → Drizzle migration     | High   | High       | Interview Q1 ("Drizzle doesn't handle CRUD properly after migration"), Q3 ("not sure it is working properly"); AGENTS.md Drizzle migration notes; hot-spot dir `src/pages/api/absences` 25 commits/30d                                                                  |
| 2   | Authenticated employee modifies or deletes another employee's absence — ownership check missing in handler (IDOR), exposed because RLS is bypassed by the service role key      | High   | High       | PRD guardrail "pracownik nie może edytować wpisów innych"; AGENTS.md "service role key bypasses RLS — authorization enforced in handler code only"; hot-spot dirs `src/pages/api/absences` 25 commits/30d, `src/pages/api/absences/[id]` 8 commits/30d                  |
| 3   | Stats computation returns wrong totals because `hours` values arrive as strings from postgres-js and are string-concatenated instead of numerically summed                      | Medium | High       | AGENTS.md "NUMERIC columns return strings from postgres-js"; interview Q1 ("wrong statistics"), Q3 ("not sure about the stats computation"); hot-spot dir `src/components/absence` 21 commits/30d                                                                       |
| 4   | Regular employee reaches moderator-only employee management endpoints — role check absent from handler                                                                          | High   | Medium     | PRD FR-007 "moderator can add and remove employees"; AGENTS.md "authorization in handler code only — RLS bypassed"; hot-spot dir `src/pages/api/employees` 9 commits/30d                                                                                                |
| 5   | Monthly grid or Details tabs show incomplete data — a future query change re-introduces an overly-restrictive JOIN filter or omits a required column, silently breaking display | High   | Medium     | Archive `2026-06-03-deactivated-employee-grid/plan.md` (isNull filter stripped historical absences); archive `2026-05-30-details-and-stats/plan.md` (created_at omitted from SELECT); hot-spot dirs `src/pages/api/absences` 25 commits/30d, `src/pages` 22 commits/30d |
| 6   | Duplicate absence entry (same employee × same date) returns HTTP 500 instead of 409 — handler reads `err.code` but DrizzleQueryError wraps the PG code under `err.cause.code`   | Low    | High       | AGENTS.md "PostgreSQL error code is NOT on err.code — it is on err.cause.code"; schema unique constraint on `(employee_id, date)`; hot-spot dir `src/pages/api/absences` 25 commits/30d                                                                                 |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                  | Must challenge                                                                  | Context `/10x-research` must ground                                                                                                                     | Likely cheapest layer                                                                                  | Anti-pattern to avoid                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| #1   | Absence is readable from DB immediately after save/update/delete with correct field values matching what was submitted                       | "Manual tests were ok" is not a regression net                                  | Real DB connection path (DATABASE_URL_DIRECT); Drizzle schema column types; CRUD handler entry points                                                   | Integration test against real Supabase DB (Node env, not workerd)                                      | Asserting current output without an independent oracle; mocking Drizzle internals      |
| #2   | Authenticated employee-role request supplying another employee's absence ID returns 403 or 404, not a mutation                               | "Authentication works" does not imply "authorization works"                     | Which field in each handler is compared to `context.locals.user`; where the ownership check lives; which absence IDs are visible to the requesting user | Integration test: authenticated request with wrong user's resource ID must be rejected                 | Testing only the happy path (own employee's absence)                                   |
| #3   | Stat totals match known inputs — e.g., three 2-hour entries sum to 6, not the string "2h2h2h" or 0                                           | "The stats look right visually" does not catch float accumulation errors        | Exact aggregation logic; what `hours` value arrives as at the computation site; whether a cast exists                                                   | Unit test with controlled string inputs matching what postgres-js returns                              | Using real DB data as the oracle (the DB also stores strings — it will always "match") |
| #4   | Regular employee POST/PATCH/DELETE to employee management endpoints returns 403                                                              | "Only moderators use this in practice" is not a code-level guarantee            | Where role is read from `context.locals.user`; which endpoints perform the role check                                                                   | Integration test: employee-role token request to employee management endpoint must return 403          | Testing only moderator-token happy path                                                |
| #5   | Grid query for a given month returns all expected columns and the correct absence row count including deactivated employees' historical data | "No visible errors" hides silent empty cells                                    | Full column list in the absences SELECT; all JOIN conditions and their scope; deactivated employee handling                                             | Integration test: insert known absences, query for month, assert column presence and row count         | Snapshotting current output and treating it as correct baseline                        |
| #6   | POST /api/absences with a duplicate date for the same employee returns HTTP 409                                                              | "We haven't seen a 500 in production" is not evidence the error path is correct | Whether the handler accesses `err.cause.code` or `err.code`; what PG code 23505 maps to in the response                                                 | Unit test: simulate a DrizzleQueryError with `cause.code = "23505"`, assert the response status is 409 | Checking only that no error is thrown on a happy-path insertion                        |

---

## 3. Phased Rollout

Each row is a discrete rollout phase. Phase 1 opened its own change folder
via `/10x-new`; phases 2-4 were delivered inside the feature changes that
touched the same code, so their Change folder cell names the change that
shipped the coverage rather than a dedicated rollout change. Status moves
left-to-right through the values below.

| #   | Phase name                | Goal (one line)                                                                                                                    | Risks covered | Test types                                                | Status   | Change folder                                                  |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| 1   | CRUD integrity            | Bootstrap Vitest in Node env; prove Drizzle CREATE/UPDATE/DELETE/SELECT return correct DB state; prove duplicate-entry returns 409 | #1, #6        | integration (real DB, Node env), unit                     | complete | crud-integrity                                                 |
| 2   | Authorization coverage    | Prove ownership checks and role checks on all absence and employee API handlers                                                    | #2, #4        | integration (handler-level, real DB)                      | complete | workers-data-edit, statistics-for-moderators, grid-bulk-delete |
| 3   | Stats and query integrity | Prove hour aggregation sums numerically; prove the rewritten SQLite queries return the same rows the Postgres ones did             | #3, #5        | unit (aggregation logic), integration (query correctness) | complete | statistics-for-moderators, sqlite-install                      |
| 4   | Quality gates wiring      | Wire `npm test` into CI; define lint + typecheck + test as required pre-merge gates                                                | cross-cutting | CI gate, pre-commit hook                                  | complete | hours-onsite-training-only, sqlite-install                     |

**Status vocabulary** (parser literals — do not rename):

| Value           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `not started`   | No change folder for this rollout phase yet.                        |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched`    | `research.md` exists in the change folder.                          |
| `planned`       | `plan.md` exists with a `## Progress` section.                      |
| `implementing`  | Progress section has at least one `[x]` and at least one `[ ]`.     |
| `complete`      | Progress section is fully `[x]`.                                    |

**Where each phase actually landed** (the evidence behind the Status column):

| Phase | Shipped as                                                                                            | Evidence                                                                                                                                                                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `context/archive/2026-06-03-crud-integrity/`                                                          | `src/tests/api/absences/crud.test.ts` — INSERT/SELECT/UPDATE/DELETE round-trips (Risk #1) and the duplicate-insert error shape (Risk #6)                                                                                                                                     |
| 2     | `2026-08-12-workers-data-edit`, `2026-08-21-statistics-for-moderators`, `2026-09-01-grid-bulk-delete` | `src/tests/api/absences/delete.test.ts` + `bulk-delete.test.ts` (IDOR, Risk #2), `src/tests/api/employees/email.test.ts` + `password.test.ts` (role gate, Risk #4 — both cite this plan by line), `src/tests/api/absences/stats-scope.test.ts` (scope widening, Risks #2/#4) |
| 3     | `2026-08-21-statistics-for-moderators`, `2026-08-25-sqlite-install`                                   | `src/tests/lib/absence-stats.test.ts` (aggregation, Risk #3), `src/tests/db/query-rewrites.test.ts` + `proxy-rows.test.ts` (query rewrites and row shapes after the Postgres → SQLite move, Risk #5)                                                                         |
| 4     | `hours-onsite-training-only` (3ae7a89, CI step), `2026-08-25-sqlite-install` (made it a real gate)    | `.github/workflows/ci.yml` runs `npm run test:run` between lint and build; suites no longer self-skip, so a green run means passed                                                                                                                                           |

Risk #3 changed shape along the way: the failure it names — a `NUMERIC` `hours` column
arriving as a string from postgres-js — cannot occur any more, because there is no `hours`
column. Duration is derived from `start_time`/`end_time` (`HH:MM` text, 8h for a full day)
by `getAbsenceHours()` in `src/lib/absence-stats.ts`. The scenario that survives is the
aggregation itself summing wrong, which is what `absence-stats.test.ts` pins — including
the `HH:MM:SS` form the old Postgres `TIME` columns produced.

---

## 4. Stack

| Layer               | Tool                                            | Version | Notes                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration  | Vitest                                          | ^4.1.8  | Node env (`environment: 'node'`); config at `vitest.config.ts`; glob `src/tests/**/*.test.ts`; env loaded via `loadEnv("test", process.cwd(), "")` — no `envFile`; `@/` alias resolves to `./src`                                                                                                                                                                          |
| API / handler tests | direct handler import + hand-built `APIContext` | —       | `astro:env/server` is aliased to the stub `src/tests/helpers/astro-env.ts` (`vitest.config.ts`), so route modules import cleanly in Node env. Suites import `GET`/`POST`/`PATCH`/`DELETE` directly and pass a context from `src/tests/helpers/http.ts`                                                                                                                     |
| e2e                 | Playwright                                      | ^1.60.0 | `playwright.config.ts`, specs in `tests/e2e/`, run with `npm run e2e` against a local `npm run dev` (`baseURL` defaults to `http://localhost:4321`; `BASE_URL` overrides). Account seeded once per database with `npm run seed:e2e`. Rules: `tests/e2e/e2e-rules.md`. Reserved for flows a handler test cannot reach — dialogs, the grid's drag/multi-select, sign-in copy |
| accessibility       | none planned for MVP                            | —       | Out of scope for MVP NFRs                                                                                                                                                                                                                                                                                                                                                  |

**Stack grounding tools (current session):**

- Docs: Context7 MCP available — not queried during risk-analysis phase; available for Vitest/Astro 6 test setup details during Phase 1 research; checked: 2026-06-03
- Search: Exa MCP available — not used during discovery; available for current tool support checks during research phases; checked: 2026-06-03
- Runtime/browser: Playwright MCP not active in session — not used; checked: 2026-06-03
- Provider/platform: n/a — the app is self-hosted on a VPS with no network access; the Cloudflare/`wrangler tail` option this row used to name died with the Workers deployment. Logs are `journalctl -u urlopy`; checked: 2026-09-04

---

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.

| Gate                  | Where                             | Required?                                                           | Catches                                                                                                                                                            |
| --------------------- | --------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lint + typecheck      | local + CI                        | required (already wired in CI)                                      | syntactic / type drift                                                                                                                                             |
| unit + integration    | local + CI                        | required — wired (`npm run test:run` in `.github/workflows/ci.yml`) | Drizzle CRUD regressions, authorization regressions, stats computation errors                                                                                      |
| post-edit hook        | local (agent loop)                | recommended after §3 Phase 4                                        | regressions at edit time                                                                                                                                           |
| e2e on critical flows | local, before merging a UI change | recommended, not wired to CI                                        | Dialog and grid-interaction regressions the handler suites cannot see. CI does carry two static guards over the sign-in copy the E2E locators depend on (`ci.yml`) |
| visual diff           | CI on PR                          | not planned for MVP                                                 | —                                                                                                                                                                  |
| build + server smoke  | CI                                | required — wired                                                    | A build that boots but 500s on the first request; CI starts the built server and asserts the sign-in page renders (`ci.yml`)                                       |

---

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section fills in once the relevant rollout phase ships.

### 6.1 Adding a unit test

**Runner**: Vitest (`npm run test:run` for a single pass; `npm test` for watch mode).

**File placement**: `src/tests/<area>/<module>.test.ts` — follow the same sub-path as the source file under `src/`. Example: a test for `src/lib/db-errors.ts` lives at `src/tests/lib/db-errors.test.ts`.

**Canonical example**: `src/tests/lib/db-errors.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { extractPgErrorCode } from "@/lib/db-errors";

describe("extractPgErrorCode", () => {
  it("returns top-level code when present", () => {
    expect(extractPgErrorCode({ code: "23505" })).toBe("23505");
  });

  it("returns cause.code when top-level code is absent", () => {
    expect(extractPgErrorCode({ code: undefined, cause: { code: "23505" } })).toBe("23505");
  });
});
```

**Two rules**:

1. Unit test files import only from `@/lib/*` or `@/db/*` — never from handler or page files (`src/pages/`). Handler files import `astro:env/server`, a Vite virtual module that crashes in Node env.
2. Pure-function unit tests need no async, no DB, no external deps — just import and assert. Keep them synchronous unless the function under test is genuinely async.

### 6.2 Adding an integration test against the database

**Canonical example**: `src/tests/api/absences/crud.test.ts`

**Required env vars**: none. This is the single biggest change since the plan was
written — the suite used to need `DATABASE_URL_DIRECT`, `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY` against a shared remote Postgres. It now runs entirely on a
local throwaway file.

**DB entry point**: `getTestDb()` from `src/tests/helpers/db.ts`. It is **async** —
it migrates and seeds a fresh SQLite file, then opens it — and memoised, so every
`beforeAll` in the file pays for it once:

```ts
db = await getTestDb();
```

The path comes from `src/tests/helpers/astro-env.ts`, the stub Vitest aliases over
`astro:env/server`. It draws one `crypto.randomUUID()` name per **test file** under
`os.tmpdir()/urlopy-vitest/`, so the suite and the handlers it imports land on the
same database and two test files never share one. `src/tests/helpers/setup.ts`
(registered as `setupFiles`) closes the handle and removes the `.db`, `-wal` and
`-shm` files afterwards. Never instantiate a Drizzle client inline; never read the
path from the environment.

**Fixture helpers** — `src/tests/helpers/fixtures.ts`:

- `createTestEmployee(db)` / `createTestModerator(db)` — insert a `users` row
  (e-mail `test-<uuid>@test.invalid`, real scrypt hash of `FIXTURE_PASSWORD`) plus
  the `employees` row pointing at it, and return the employee id.
- `FIXTURE_PASSWORD` — the shared plaintext, so a suite can assert a password works
  before a reset and stops working after one.
- `teardownTestEmployee(db, employeeId)` — deletes `absences`, then
  `holiday_balances`, then the `users` row (`employees` cascades from it). The order
  is mandatory: `node:sqlite` enforces foreign keys and neither table cascades from
  `employees`.

**No CI guard.** `describe.skipIf(!process.env.DATABASE_URL_DIRECT)` is gone from
every suite. A green run means passed, not skipped — do not reintroduce a skip
guard for a new integration test.

**Skeleton**:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@/tests/helpers/db";
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import type { Db } from "@/db/index";

describe("MyArea — integration", () => {
  let db!: Db;
  let testEmployeeId!: string;

  beforeAll(async () => {
    db = await getTestDb();
    testEmployeeId = await createTestEmployee(db);
  });

  afterAll(async () => {
    await teardownTestEmployee(db, testEmployeeId);
  });

  it("INSERT — row is readable immediately after save", async () => {
    // insert via db.insert(...).values(...).returning(...)
    // assert returned values match submitted values
  });
});
```

**Two carry-overs from the Postgres era that changed:**

- **There is no `hours` column.** It was dropped: duration is derived from
  `start_time`/`end_time` (`HH:MM` text, 8h when `is_full_day`) by
  `getAbsenceHours()`. The postgres-js `"2.50"`-as-a-string gotcha is gone with it —
  assert against the number `2.5`.
- **Error codes.** `node:sqlite` throws `code: 'ERR_SQLITE_ERROR'` for everything
  and carries the discriminator on `errcode` (SQLite's _extended_ result code):
  `2067` unique, `787` foreign key, `275` CHECK. No five-digit SQLSTATE
  (`23505`, `23503`) should appear in a new test.

**Still in force:** resolve absence-type ids **by name**, never hard-coded (a seed
rename must fail loudly — `crud.test.ts:30`), and give each test its own fixed past
date. `absences` carries `UNIQUE (employee_id, date)`, so a shared date makes one
test's leftover row the next test's failure. Suites claim date windows by month;
check which months are taken before picking one (`delete.test.ts:38-46` documents
the convention).

### 6.3 Adding an authorization test for an API handler

Covers IDOR (Risk #2) and role enforcement (Risk #4).

**Canonical examples**: `src/tests/api/absences/delete.test.ts` (ownership),
`src/tests/api/employees/email.test.ts` (role gate).

The pattern is a direct handler import plus a hand-built `APIContext` — no HTTP
server, no fetch:

```ts
import { DELETE } from "@/pages/api/absences/[id]";

const makeContext = (authUserId: string | null, id: string) =>
  ({
    locals: { user: authUserId ? { id: authUserId } : null },
    params: { id },
  }) as unknown as APIContext;
```

For routes that read cookies, a body, or call `redirect()`, use `makeApiContext()`
and `TestCookies` from `src/tests/helpers/http.ts` instead of hand-rolling the
object (`src/tests/api/auth/session-flow.test.ts` is the template). `TestCookies`
records the **options** of every `set`, which is how the `HttpOnly` / `SameSite`
flags on the session cookie are asserted at all.

**The case list every guarded route owes** (from `delete.test.ts:118-183`):

| Case                                      | Expected                                            |
| ----------------------------------------- | --------------------------------------------------- |
| no authenticated user                     | 401, row untouched                                  |
| authenticated but no live `employees` row | 403, row untouched                                  |
| own row                                   | success, row actually changed in the DB             |
| **colleague's row, employee role**        | 404 (not 403 — do not leak existence), row survives |
| colleague's row, moderator role           | success                                             |
| unknown uuid                              | 404, even for a moderator                           |
| malformed id                              | 400, nothing written                                |

**The rule that makes these tests worth writing**: assert the **database state**,
not only the status code. A refusal that still deletes returns 403 and passes a
status-only assertion. `crud.test.ts:153` is the counter-example the ownership
suite exists to complement — a raw `db.delete(...)` that would keep passing with
the entire handler removed.

For the role gate, seed the caller with `createTestModerator(db)` rather than
creating an employee and patching `role` afterwards.

### 6.4 Adding a query completeness test

Covers query regressions (Risk #5).

**Canonical examples**: `src/tests/db/query-rewrites.test.ts`,
`src/tests/db/proxy-rows.test.ts`.

These exist because the Postgres → SQLite move rewrote constructs that have no
SQLite equivalent (`extract(epoch from (end - start))`, `UPDATE ... FROM (SELECT
UNNEST(ARRAY[...]))`). The rule they establish:

**Assert against a real database, never against the generated SQL string.** A
string assertion passes on a query that SQLite rejects at runtime, and it breaks on
a harmless formatting change — wrong in both directions.

Shape of the test: insert a known fixture set (including the rows a too-narrow
filter would drop — a soft-deleted employee's historical absences, a row from the
adjacent year), run the real query function, then assert **both** the row count and
the presence of every column the caller reads. Row count alone misses a dropped
column; a column check alone misses a lost JOIN. Two archived regressions this
guards against are cited in §2, Risk #5: an `isNull` filter that stripped historical
absences, and a `created_at` omitted from a SELECT.

Unlike §6.2, these two suites manage their own `mkdtempSync` directory rather than
using `getTestDb()` — they test `createDb`/`migrateAndSeed` themselves, so they
cannot use the helper built on top of them. New tests that merely _query_ should
use `getTestDb()`.

### 6.5 Per-rollout-phase notes

- **Phase 1 (crud-integrity)** — established the direct-Drizzle integration suite and
  the by-name absence-type lookup. Written against Supabase; the harness underneath
  it was replaced in `sqlite-install` without the assertions changing.
- **Phase 2 (authorization)** — arrived in three feature changes rather than one
  rollout change. `workers-data-edit` added the role gate suites and recorded that a
  moderator fixture was impossible at the time; `sqlite-install` made
  `createTestModerator()` possible by moving the credential into a local row;
  `grid-bulk-delete` back-filled the route-level DELETE cases §6.3 now codifies.
- **Phase 3 (stats / query)** — `statistics-for-moderators` extracted the aggregation
  into `src/lib/absence-stats.ts` specifically so it could be unit-tested without a
  database. `sqlite-install` added the query-rewrite suites.
- **Phase 4 (gates)** — the CI step landed early (3ae7a89) but was theatre while every
  suite self-skipped without `DATABASE_URL_DIRECT`. `sqlite-install` deleted the skip
  guards, which is the commit that actually turned the gate on.

---

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5).

- ~~**Supabase auth flows (sign-in, sign-up, session refresh)**~~ — **no longer excluded.** The
  condition this exclusion named ("re-evaluate if auth logic is ever brought in-house") came
  true: there is no auth vendor any more. scrypt hashing, opaque server-side sessions and
  sign-in throttling are our code, and they are tested —
  `src/tests/lib/auth/password.test.ts` and `src/tests/api/auth/session-flow.test.ts`
  (cookie flags, expiry pruning, fabricated ids, generic failure message).
- **Absence type seed data as product content** — the catalogue's names, colors and icons are a
  static seed; they never change through the app. What _is_ tested is the seed's structural
  contract (`src/tests/db/migrate-seed.test.ts`: idempotence, `UNIQUE(name)`, CHECK constraints
  surviving the whole migration chain), because a regenerated Drizzle migration drops those
  silently. Re-evaluate the exclusion if the app gains a UI for managing absence types.
- **UI snapshot tests for the monthly grid** — color rendering and cell layout are high-churn (21 commits/30d in `src/components/absence`) and carry low failure signal; snapshot tests would break on every style tweak. Re-evaluate if a deterministic visual diff tool is introduced and scoped to 1–3 critical screens. (Source: cost × signal principle §1.)

---

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-04
- Stack versions last verified: 2026-09-04
- AI-native tool references last verified: 2026-09-04 (none in use)

Known drift accepted at the 2026-09-04 review, not yet rewritten: §2's risk table still
describes the failure modes in Postgres/Supabase terms (postgres-js string `NUMERIC`, RLS
bypassed by a service-role key). The _scenarios_ still hold — wrong stats, IDOR, incomplete
queries — but their stated mechanisms belong to a stack this branch no longer runs. A full
`--refresh` should re-derive them against SQLite + local auth.

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
