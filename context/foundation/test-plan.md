# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-04

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
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (excluding `node_modules/`, `dist/`, `.wrangler/`, `.astro/`).

---

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Drizzle CRUD produces wrong DB state — an absence is silently not saved, double-saved, or deleted due to query translation issues after the Supabase JS → Drizzle migration | High | High | Interview Q1 ("Drizzle doesn't handle CRUD properly after migration"), Q3 ("not sure it is working properly"); AGENTS.md Drizzle migration notes; hot-spot dir `src/pages/api/absences` 25 commits/30d |
| 2 | Authenticated employee modifies or deletes another employee's absence — ownership check missing in handler (IDOR), exposed because RLS is bypassed by the service role key | High | High | PRD guardrail "pracownik nie może edytować wpisów innych"; AGENTS.md "service role key bypasses RLS — authorization enforced in handler code only"; hot-spot dirs `src/pages/api/absences` 25 commits/30d, `src/pages/api/absences/[id]` 8 commits/30d |
| 3 | Stats computation returns wrong totals because `hours` values arrive as strings from postgres-js and are string-concatenated instead of numerically summed | Medium | High | AGENTS.md "NUMERIC columns return strings from postgres-js"; interview Q1 ("wrong statistics"), Q3 ("not sure about the stats computation"); hot-spot dir `src/components/absence` 21 commits/30d |
| 4 | Regular employee reaches moderator-only employee management endpoints — role check absent from handler | High | Medium | PRD FR-007 "moderator can add and remove employees"; AGENTS.md "authorization in handler code only — RLS bypassed"; hot-spot dir `src/pages/api/employees` 9 commits/30d |
| 5 | Monthly grid or Details tabs show incomplete data — a future query change re-introduces an overly-restrictive JOIN filter or omits a required column, silently breaking display | High | Medium | Archive `2026-06-03-deactivated-employee-grid/plan.md` (isNull filter stripped historical absences); archive `2026-05-30-details-and-stats/plan.md` (created_at omitted from SELECT); hot-spot dirs `src/pages/api/absences` 25 commits/30d, `src/pages` 22 commits/30d |
| 6 | Duplicate absence entry (same employee × same date) returns HTTP 500 instead of 409 — handler reads `err.code` but DrizzleQueryError wraps the PG code under `err.cause.code` | Low | High | AGENTS.md "PostgreSQL error code is NOT on err.code — it is on err.cause.code"; schema unique constraint on `(employee_id, date)`; hot-spot dir `src/pages/api/absences` 25 commits/30d |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | Absence is readable from DB immediately after save/update/delete with correct field values matching what was submitted | "Manual tests were ok" is not a regression net | Real DB connection path (DATABASE_URL_DIRECT); Drizzle schema column types; CRUD handler entry points | Integration test against real Supabase DB (Node env, not workerd) | Asserting current output without an independent oracle; mocking Drizzle internals |
| #2 | Authenticated employee-role request supplying another employee's absence ID returns 403 or 404, not a mutation | "Authentication works" does not imply "authorization works" | Which field in each handler is compared to `context.locals.user`; where the ownership check lives; which absence IDs are visible to the requesting user | Integration test: authenticated request with wrong user's resource ID must be rejected | Testing only the happy path (own employee's absence) |
| #3 | Stat totals match known inputs — e.g., three 2-hour entries sum to 6, not the string "2h2h2h" or 0 | "The stats look right visually" does not catch float accumulation errors | Exact aggregation logic; what `hours` value arrives as at the computation site; whether a cast exists | Unit test with controlled string inputs matching what postgres-js returns | Using real DB data as the oracle (the DB also stores strings — it will always "match") |
| #4 | Regular employee POST/PATCH/DELETE to employee management endpoints returns 403 | "Only moderators use this in practice" is not a code-level guarantee | Where role is read from `context.locals.user`; which endpoints perform the role check | Integration test: employee-role token request to employee management endpoint must return 403 | Testing only moderator-token happy path |
| #5 | Grid query for a given month returns all expected columns and the correct absence row count including deactivated employees' historical data | "No visible errors" hides silent empty cells | Full column list in the absences SELECT; all JOIN conditions and their scope; deactivated employee handling | Integration test: insert known absences, query for month, assert column presence and row count | Snapshotting current output and treating it as correct baseline |
| #6 | POST /api/absences with a duplicate date for the same employee returns HTTP 409 | "We haven't seen a 500 in production" is not evidence the error path is correct | Whether the handler accesses `err.cause.code` or `err.code`; what PG code 23505 maps to in the response | Unit test: simulate a DrizzleQueryError with `cause.code = "23505"`, assert the response status is 409 | Checking only that no error is thrown on a happy-path insertion |

---

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | CRUD integrity | Bootstrap Vitest in Node env; prove Drizzle CREATE/UPDATE/DELETE/SELECT return correct DB state; prove duplicate-entry returns 409 | #1, #6 | integration (real DB, Node env), unit | complete | crud-integrity |
| 2 | Authorization coverage | Prove ownership checks and role checks on all absence and employee API handlers | #2, #4 | integration (handler-level, real DB) | not started | — |
| 3 | Stats and query integrity | Prove NUMERIC-as-string cast in all stat aggregations; prove grid query returns complete column set and correct row count | #3, #5 | unit (aggregation logic), integration (query correctness) | not started | — |
| 4 | Quality gates wiring | Wire `npm test` into CI; define lint + typecheck + test as required pre-merge gates | cross-cutting | CI gate, pre-commit hook | not started | — |

**Status vocabulary** (parser literals — do not rename):

| Value | Meaning |
|---|---|
| `not started` | No change folder for this rollout phase yet. |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched` | `research.md` exists in the change folder. |
| `planned` | `plan.md` exists with a `## Progress` section. |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`. |
| `complete` | Progress section is fully `[x]`. |

---

## 4. Stack

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | Vitest | ^4.1.8 | Node env (`environment: 'node'`); config at `vitest.config.ts`; glob `src/tests/**/*.test.ts`; `envFile: '.env'` loads `DATABASE_URL_DIRECT`; `@/` alias resolves to `./src` |
| API / handler mocking | n/a — tests bypass handler layer | — | Handlers import `astro:env/server` (Vite virtual module) unavailable in Node env; tests call Drizzle directly via `getTestDb()` |
| e2e | none planned for MVP | — | Not justified by cost × signal for a ≤10-person internal app at this stage |
| accessibility | none planned for MVP | — | Out of scope for MVP NFRs |

**Stack grounding tools (current session):**
- Docs: Context7 MCP available — not queried during risk-analysis phase; available for Vitest/Astro 6 test setup details during Phase 1 research; checked: 2026-06-03
- Search: Exa MCP available — not used during discovery; available for current tool support checks during research phases; checked: 2026-06-03
- Runtime/browser: Playwright MCP not active in session — not used; checked: 2026-06-03
- Provider/platform: Cloudflare MCP available — could support production log tail (`wrangler tail`) as a pre-prod smoke gate in Phase 4; not wired yet; checked: 2026-06-03

---

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck | local + CI | required (already wired in CI) | syntactic / type drift |
| unit + integration | local + CI | required after §3 Phase 1 | Drizzle CRUD regressions, authorization regressions, stats computation errors |
| post-edit hook | local (agent loop) | recommended after §3 Phase 4 | regressions at edit time |
| e2e on critical flows | CI on PR | not planned for MVP | — |
| visual diff | CI on PR | not planned for MVP | — |
| pre-prod smoke (log tail) | post-merge | optional after §3 Phase 4 | environment-specific failures; Cloudflare MCP available for `wrangler tail` |

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

**Required env vars** (add to `.env`, never commit):
- `DATABASE_URL_DIRECT` — direct Supabase connection on port 5432 (same URL used by `drizzle-kit`)
- `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` — needed by fixture helpers that create/delete Supabase Auth users

**DB entry point**: use `getTestDb()` from `src/tests/helpers/db.ts`. It reads `DATABASE_URL_DIRECT` and throws a clear error if absent. Never instantiate a Drizzle client inline in a test file.

**Fixture helpers**: `createTestEmployee` and `teardownTestEmployee` from `src/tests/helpers/fixtures.ts` manage a dedicated test employee and its associated absence rows. `createTestEmployee` creates a real Supabase Auth user (required for the FK from `employees.user_id`) and returns the employee row `id`.

**CI guard**: wrap every `describe` block with `describe.skipIf(!process.env.DATABASE_URL_DIRECT)(...)`. The secret is absent in CI until Phase 4 quality gates; the guard makes tests skip (not fail) and prints a visible warning.

**Skeleton**:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@/tests/helpers/db";           // @/ alias works in tests
import { createTestEmployee, teardownTestEmployee } from "@/tests/helpers/fixtures";
import type { Db } from "@/db/index";

describe.skipIf(!process.env.DATABASE_URL_DIRECT)("MyArea — integration", () => {
  let db: Db;
  let testEmployeeId: string | undefined;

  beforeAll(async () => {
    db = getTestDb();
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

**`afterAll` cleanup order** — mandatory due to FK constraint `absences.employee_id → employees.id` (no `ON DELETE CASCADE`): `teardownTestEmployee` deletes absence rows first, then the employee row, then the Supabase Auth user. Reversing the order throws PG error `23503`.

**`hours`-as-string gotcha**: the `hours` column is `NUMERIC` in Postgres. postgres-js returns it as a string (`"2.50"`, not `2.5`). Integration test assertions against `hours` must compare to a string, not a number.

**Test isolation**: each test inserts its own rows with a unique date to avoid hitting the `(employee_id, date)` unique constraint across tests within the same suite. Use fixed past dates (`2026-01-15`, `2026-01-16`, …) rather than `new Date()` to keep tests deterministic.

### 6.3 Adding an authorization test for an API handler

TBD — see §3 Phase 2 for ownership-check and role-check patterns. Covers IDOR (Risk #2) and role-enforcement (Risk #4) test structure.

### 6.4 Adding a query completeness test

TBD — see §3 Phase 3 for the pattern of asserting column presence and row count against known fixture data. Covers query regression protection (Risk #5).

### 6.5 Per-rollout-phase notes

(Filled in by `/10x-implement` as each phase completes.)

---

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5).

- **Supabase auth flows (sign-in, sign-up, session refresh)** — Supabase SDK and infrastructure own this behavior; testing it would be testing the vendor, not our code. Re-evaluate if auth logic is ever brought in-house or if a middleware regression occurs. (Source: Phase 2 interview Q5.)
- **Absence type seed data** — the 6 absence types and their hex colors are a static seed applied once at migration; they never change via the app. Re-evaluate if the app gains a UI for managing absence types. (Source: stable-code heuristic, no churn in `absence_types` table.)
- **UI snapshot tests for the monthly grid** — color rendering and cell layout are high-churn (21 commits/30d in `src/components/absence`) and carry low failure signal; snapshot tests would break on every style tweak. Re-evaluate if a deterministic visual diff tool is introduced and scoped to 1–3 critical screens. (Source: cost × signal principle §1.)

---

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-03
- Stack versions last verified: 2026-06-03
- AI-native tool references last verified: 2026-06-03 (none in use)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
