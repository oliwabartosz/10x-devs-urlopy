<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Drizzle Migration

- **Plan**: context/changes/drizzle-migration/plan.md
- **Scope**: All phases (1–5)
- **Date**: 2026-06-03
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  6 warnings  4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — GET /api/absences returns all employees' absences after RLS removal

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:89–107
- **Detail**: The GET handler verifies the caller is an active employee, then queries absences with only a date-range filter — no employee_id filter. Service role bypasses RLS so any authenticated user gets every employee's absences for the requested period. Before migration, the Supabase session client carried the caller's auth cookie and was subject to RLS. Whether RLS restricted to "own absences" or "all absences" determined what GET returned. The dashboard's absences query has always fetched all employees' absences without an owner filter — suggesting team-wide visibility is intentional. But the API endpoint is a REST surface any client with valid cookies can script. Needs explicit verification against the original RLS policy intent.
- **Fix A ⭐ Recommended**: Verify original RLS intent and document
  - Approach: Read the Supabase migration SQL to confirm RLS on absences table. If team-wide ("all employees see all"), add a comment to the handler documenting the intentional design.
  - Strength: Matches the dashboard's own absences fetch (same unfiltered query); preserves existing behavior.
  - Tradeoff: Leaves the full absence history of all employees accessible to any authenticated user via the API.
  - Confidence: HIGH — the dashboard has always shown all employees' absences to regular users; inconsistency would break the grid.
  - Blind spot: Haven't read the Supabase RLS policies in the migration SQL files to confirm.
- **Fix B**: Add role-based owner filter for non-moderators
  - Approach: For non-moderator callers, add `eq(absences.employee_id, employeeRow.id)` to the WHERE clause.
  - Strength: Stricter — regular employees only see their own absences via the API.
  - Tradeoff: Breaks the frontend if any component calls GET /api/absences to populate the full-team grid for regular users.
  - Confidence: MED — unknown if any client-side component relies on seeing all absences via this endpoint.
  - Blind spot: Not checked which React components call this endpoint vs. receiving absences as server-side props.
- **Decision**: FIXED via Fix A — RLS policy confirmed intentional in migration 20260529000001; comment added to handler.

### F2 — DATABASE_URL declared optional:true despite being required

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: astro.config.mjs:22
- **Detail**: `envField.string({ context: "server", access: "secret", optional: true })` makes DATABASE_URL typed as `string | undefined`. If the secret is absent from Cloudflare Workers, every DB-backed route throws uncaught rather than Astro failing fast at startup with a clear "missing required env var" message. The var is not optional — the app cannot function without it.
- **Fix**: Remove `optional: true` (or replace with `optional: false`). Astro will validate presence at startup and surface a clear error before any request is served.
- **Decision**: FIXED — removed optional: true from DATABASE_URL in astro.config.mjs.

### F3 — Restore UPDATE missing atomic isNotNull guard (TOCTOU race)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/[id]/restore.ts:65
- **Detail**: Restore checks `if (target.deleted_at === null) return 409` then issues UPDATE without `isNotNull(deleted_at)` in the WHERE clause. A concurrent restore of the same employee between the SELECT and UPDATE would apply the update to an already-active employee and return a false-positive 200. The sibling soft-delete in [id].ts correctly uses an atomic guard: `.where(and(eq(employees.id, ...), isNull(employees.deleted_at)))`.
- **Fix**: Add `isNotNull(employees.deleted_at)` to the restore UPDATE's WHERE clause: `.where(and(eq(employees.id, id), isNotNull(employees.deleted_at)))`. Then `returning().then(r => r[0])` returning undefined covers both "not found" and "already active" races atomically.
- **Decision**: FIXED — added isNotNull(employees.deleted_at) guard to restore UPDATE WHERE clause; added isNotNull import.

### F4 — PATCH /api/absences missing calendar-date refine that POST has

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/[id].ts:13
- **Detail**: `AbsenceUpdateSchema` validates `date` with only `/^\d{4}-\d{2}-\d{2}$/` — no `.refine()` calendar-date check. POST's `DateSchema` (absences/index.ts:17–23) adds a refine that verifies the date is a real calendar date (not "2026-02-30"). An invalid date passes the PATCH schema, reaches Postgres, and raises a `22007` error that the catch block doesn't handle — falls through to the generic "Database error" 500.
- **Fix**: Extract `DateSchema` from absences/index.ts to a shared location (e.g. `src/lib/validators.ts`) and import it in both files. At minimum add the same `.refine()` to the `date` field in `AbsenceUpdateSchema`.
- **Decision**: FIXED — extracted DateSchema to src/lib/validators.ts; both absences files now import it; PATCH date field uses the refine.

### F5 — Compensating auth-user delete silently swallows errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/employees/index.ts:140
- **Detail**: `adminClient.auth.admin.deleteUser(authData.user.id).catch(() => undefined)` silently swallows any failure to clean up an orphaned auth user. If the compensating delete fails (network issue, quota), the auth user is left permanently without an employee record and there is no way to diagnose it.
- **Fix**: Replace `.catch(() => undefined)` with `.catch((err) => console.error("Failed to rollback auth user:", authData.user.id, err))`. The error surfaces in `wrangler tail` / Cloudflare Logpush.
- **Decision**: FIXED — replaced silent .catch(() => undefined) with console.error logging.

### F6 — Year-mode GET /api/absences is unbounded; date-range mode caps at 90 days

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:102
- **Detail**: Year-mode (`year=YYYY`) generates a 12-month range with no row limit. The date-range mode enforces a 90-day cap (line 81). Service role means there is no database-level cap either. Pre-existing in the Supabase version but the RLS fence was previously a cap on what could be returned to a given user.
- **Fix**: Add `.limit(5000)` (or similar generous but finite cap) to the year-mode SELECT, matching the spirit of the date-range 90-day cap.
- **Decision**: FIXED — added .limit(5000) to the year-mode SELECT.

### F7 — Dead createClient / supabase variable in dashboard.astro

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dashboard.astro:8,35–38
- **Detail**: `createClient` is imported and `supabase` is constructed then used only for a null-check (`if (!supabase)`). No data query uses it. The middleware and Astro.locals.user check (line 31) already guarantee auth. Dead import and dead variable.
- **Fix**: Remove the `createClient` import and the supabase null-check block (lines 35–38).
- **Decision**: FIXED — removed createClient import and supabase null-check block from dashboard.astro.

### F8 — Unused @neondatabase/serverless dependency

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: package.json:24
- **Detail**: The plan specified neon-http as the driver, but during Phase 2 the driver was correctly switched to postgres-js (Supabase's pooler is incompatible with neon-http). The pivot was documented in AGENTS.md. However, `@neondatabase/serverless` was left in package.json as a dead dependency.
- **Fix**: Remove `@neondatabase/serverless` from package.json dependencies and run `npm install`.
- **Decision**: FIXED — removed @neondatabase/serverless via npm uninstall.

### F9 — substitute_employee_id FK violation (23503) not caught

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/absences/index.ts:194–199
- **Detail**: The POST catch block handles 23505 (duplicate), 23514 (hours check) but not 23503 (FK violation). A request with an invalid `substitute_employee_id` triggers a 23503 from Postgres and returns the generic "Database error" 500 instead of a user-friendly message.
- **Fix**: Add `if (code === "23503") return json({ error: "Substitute employee not found." }, 422);` to the catch block.
- **Decision**: FIXED — added 23503 FK violation handler to POST catch block.

### F10 — Deleted employees' absences included in query results

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/absences/index.ts:102 / src/pages/dashboard.astro:90
- **Detail**: Absences are not filtered by whether the employee is active. Soft-deleted employees' historical absences are returned in the date range. The dashboard's gridEmployees filter correctly hides deleted employees by date range, and grid components ignore absences for employees not in gridEmployees — so no data leaks. Pre-existing behavior. Wasted work at scale.
- **Fix**: No immediate action required. Consider joining absences with employees and filtering `isNull(employees.deleted_at)` when query efficiency becomes a concern.
- **Decision**: FIXED — added innerJoin(employees, isNull(employees.deleted_at)) to absences GET query (API and dashboard).
