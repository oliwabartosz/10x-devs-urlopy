# Sentry Integration Implementation Plan

## Overview

Activate the already-scaffolded Sentry integration for production error capture and add explicit `Sentry.captureException()` calls to the application layer so that handled exceptions (DB errors, constraint violations, auth failures) reach Sentry alongside unhandled ones.

## Current State Analysis

The SDK scaffolding is complete:
- `wrangler.jsonc` points `"main"` at `sentry.server.config.ts`, which wraps the Astro handler with `withSentry`
- Both `@sentry/cloudflare` and `@sentry/astro` are installed
- Source maps are configured (`upload_source_maps: true`, `SENTRY_AUTH_TOKEN` in CI)
- `nodejs_compat` flag is set; `captureConsoleIntegration` is wired
- `SENTRY_DSN` is templated in `.dev.vars.example`

What is missing:
- `SENTRY_DSN` is not set as a Wrangler secret in production → server-side capture is silently a no-op
- `tracesSampleRate` is unset → performance tracing is disabled
- All API route `catch` blocks swallow the original error without forwarding it to Sentry
- Middleware has no error handling and no `Sentry.setUser()` call
- `dashboard.astro` catch blocks set boolean flags and lose the original error

## Desired End State

After this plan:
- Every unhandled exception (hard crash) AND every caught DB/auth/constraint error is captured in Sentry with a readable, source-mapped stack trace
- Each event is associated with the triggering user's ID and role
- Each event is tagged with the route that produced it
- 10% of requests are sampled for performance tracing
- A developer can reproduce any production error from Sentry's Issues view without consulting `wrangler tail`

### Key Discoveries

- `sentry.server.config.ts:8` — `withSentry` wrapper exists; adding `tracesSampleRate: 0.1` is a one-line change
- `src/middleware.ts:12` — `supabase.auth.getUser()` is the only DB-touching call; role is NOT available here without an additional Drizzle query
- `src/types.ts:3` — `UserRole` type (`"employee" | "moderator"`) already exists
- `src/env.d.ts:2` — `App.Locals` only has `user`; adding `userRole` requires one line
- DB connection pattern: `createDb(DATABASE_URL)` from `@/db/index`, `DATABASE_URL` from `astro:env/server` — same pattern will work in middleware
- Drizzle fails in `wrangler dev` (TLS); the role lookup must be wrapped in `try/catch` that silently degrades to ID-only on failure

## What We're NOT Doing

- `beforeSend` GDPR scrubber (Phase 3, parked) — `sendDefaultPii` stays `false` (default), which already excludes cookies and IP
- `sendDefaultPii: true` — not in scope; current default is GDPR-conservative
- Sentry dashboard alert rules — configured in the Sentry UI after deployment, not in SDK
- 100% or 0% `tracesSampleRate` — 10% is chosen; no other sample rates
- Dedicated `/api/sentry-test` test endpoint — verification is production-based
- Structured logging framework — out of scope; `captureConsoleIntegration` covers `console.warn/error`

## Implementation Approach

Phase 1 activates the production path: one Wrangler secret + one config change. This alone covers all unhandled exceptions. Phase 2 instruments the application layer so caught exceptions are not silently dropped. The middleware role-lookup is guarded with `try/catch` to degrade gracefully in `wrangler dev` (where Drizzle/Supabase TLS fails).

## Critical Implementation Details

**Drizzle in middleware degrades silently in `wrangler dev`.** The role lookup (`createDb(DATABASE_URL)`) uses the same PostgreSQL connection that fails in the local workerd TLS environment. Wrap the entire role lookup block in `try { } catch { }` — on failure, `userRole` stays `null` and `Sentry.setUser({ id })` is called without the role tag. This is the correct behavior for local development.

**`Sentry.setUser` and `Sentry.setTag` called in middleware propagate to all downstream events in the same request.** Route-level `captureException` calls only need to add the `route` tag; user context comes for free from the middleware scope.

**Auth route errors are structured, not thrown.** `supabase.auth.signInWithPassword()` returns `{ data, error }` — the `error` case is handled via redirect, not via `throw`. These are expected operational outcomes, not bugs. Auth routes should get a `try/catch` wrapping their full handler body only to catch unexpected throws (network failure, SDK bug). Do not capture the Supabase `{ error }` response as a Sentry exception.

---

## Phase 1: Config Activation

### Overview

Add `tracesSampleRate: 0.1` to the `withSentry` options and set `SENTRY_DSN` as a Wrangler production secret. After this phase, all unhandled Worker exceptions reach Sentry with source-mapped traces.

### Changes Required

#### 1. Add performance tracing to `withSentry` options

**File**: `sentry.server.config.ts`

**Intent**: Enable 10% performance sampling so Sentry Performance dashboards show p50/p95 latency and slow DB queries alongside error data.

**Contract**: Add `tracesSampleRate: 0.1` as a second key inside the options object returned by the factory function (alongside the existing `dsn` and `integrations` keys). No other changes to this file.

#### 2. Set production `SENTRY_DSN` Wrangler secret

**File**: N/A — one-time CLI command documented below.

**Intent**: The `withSentry` wrapper reads `env.SENTRY_DSN` at request time; until this secret is set, the SDK silences itself and nothing is captured.

**Contract**: Run once after Phase 1 is deployed:
```bash
wrangler secret put SENTRY_DSN
# paste the DSN from Sentry Dashboard → Project → Settings → Client Keys when prompted
```

Confirm with `wrangler secret list` — `SENTRY_DSN` should appear.

### Success Criteria

#### Automated Verification

- Build succeeds: `npm run build`
- TypeScript compiles without errors: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification

- `wrangler secret list` output includes `SENTRY_DSN`
- Deploy to production, navigate to a non-existent route (e.g. `/api/notfound`) to trigger an unhandled 500
- Sentry Issues view shows the event within ~30 seconds with a deobfuscated stack trace (source maps working)
- Sentry Performance dashboard shows sampled transactions

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the Sentry Issues view shows the captured event before proceeding to Phase 2.

---

## Phase 2: Application-Level Instrumentation

### Overview

Wire user context into middleware (ID + role from Drizzle) and add `Sentry.captureException()` to every `catch` block across 9 API route files, middleware, and `dashboard.astro`. After this phase, handled exceptions — DB constraint violations, auth lookup failures, compensating transaction failures — all reach Sentry with full context.

### Changes Required

#### 1. Add `userRole` to Astro Locals type

**File**: `src/env.d.ts`

**Intent**: Make `context.locals.userRole` type-safe for any future consumer of the role without re-querying the DB.

**Contract**: Add `userRole: import("@/types").UserRole | null;` inside the `App.Locals` interface, below the existing `user` line.

#### 2. Extend middleware with role lookup and Sentry user context

**File**: `src/middleware.ts`

**Intent**: Attach the authenticated user's ID and role to every Sentry event scoped to the current request. Role requires a Drizzle query (not available in the auth token); guard it with try/catch so local dev failures don't break auth.

**Contract**: Import `* as Sentry from "@sentry/cloudflare"`, `createDb` and `employees` from `@/db/index`, `DATABASE_URL` from `astro:env/server`, and `eq`, `isNull`, `and` from `drizzle-orm`. After `context.locals.user = user ?? null` resolves to a non-null user, add a guarded block:
```typescript
let userRole: import("@/types").UserRole | null = null;
try {
  const db = createDb(DATABASE_URL);
  const [emp] = await db
    .select({ role: employees.role })
    .from(employees)
    .where(and(eq(employees.user_id, user.id), isNull(employees.deleted_at)))
    .limit(1);
  userRole = emp?.role ?? null;
} catch { /* silent — degrades to ID-only in wrangler dev */ }
context.locals.userRole = userRole;
Sentry.setUser({ id: user.id });
if (userRole) Sentry.setTag("user_role", userRole);
```
When `supabase` is null (no client), set `context.locals.userRole = null` in the existing `else` branch.

#### 3. Instrument absence API routes

**Files**: `src/pages/api/absences/index.ts`, `src/pages/api/absences/[id].ts`

**Intent**: Every DB error, RLS violation, constraint error, and auth failure in the absence CRUD surface reaches Sentry with a route tag so errors can be filtered by endpoint.

**Contract**: Import `* as Sentry from "@sentry/cloudflare"` at the top. In every existing `catch (err)` or `catch (e)` block, add before the `return json(...)` call:
```typescript
Sentry.captureException(err, { tags: { route: "POST /api/absences" } });
```
Adjust the `route` tag value to match the HTTP method and path of the handler (`GET /api/absences`, `POST /api/absences`, `PATCH /api/absences/:id`, `DELETE /api/absences/:id`). Do not capture the `401` early-return branches (those are expected auth guards, not errors).

#### 4. Instrument employee API routes

**Files**: `src/pages/api/employees/index.ts`, `src/pages/api/employees/[id].ts`, `src/pages/api/employees/order.ts`, `src/pages/api/employees/[id]/restore.ts`

**Intent**: DB errors in employee management (CRUD, display order, restore) reach Sentry. The compensating transaction failure in `employees/index.ts` is especially important — it means an orphaned auth user exists and needs urgent attention.

**Contract**: Same `Sentry.captureException(err, { tags: { route } })` pattern as above. For the compensating transaction catch in `employees/index.ts` (the `.catch()` callback after `adminClient.auth.admin.deleteUser()`), use `level: "warning"` and add an `action` tag:
```typescript
Sentry.captureException(err, {
  level: "warning",
  tags: { route: "POST /api/employees", action: "compensating_delete" },
});
```
This distinguishes a partially-successful employee creation from a hard failure.

#### 5. Instrument auth API routes

**Files**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`, `src/pages/api/auth/signout.ts`

**Intent**: Unexpected throws (network errors, Supabase SDK failures) in auth routes are caught and captured. Normal Supabase `{ error }` responses (wrong password, email already exists) are NOT captured — they are expected operational outcomes.

**Contract**: Wrap each route's entire handler body in a `try { ... } catch (err) { Sentry.captureException(err, { tags: { route: "POST /api/auth/signin" } }); return new Response("Internal Server Error", { status: 500 }); }` block. The existing `if (error) { return context.redirect(...) }` branches remain inside the `try` — only unexpected throws land in the `catch`.

#### 6. Instrument dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: The two silent `catch` blocks in the SSR phase (`employeeDbError = true` and the outer `dataDbError = true`) log the original error to Sentry so the developer knows what query failed, not just that something did.

**Contract**: Import `* as Sentry from "@sentry/cloudflare"` in the frontmatter. In the first catch (employee lookup, around line 52): add `Sentry.captureException(error, { tags: { page: "dashboard", phase: "employee-lookup" } })` before `employeeDbError = true`. In the second catch (Promise.all data fetch, around line 133): add `Sentry.captureException(error, { tags: { page: "dashboard", phase: "data-fetch" } })` before `dataDbError = true`.

### Success Criteria

#### Automated Verification

- TypeScript compiles: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification

- Deploy Phase 2 to production
- POST `/api/absences` with a missing required field (e.g. omit `type_id`) while authenticated
- Sentry Issues view shows the event with: user ID in the User section, `user_role` tag (employee or moderator), `route` tag (`POST /api/absences`), readable stack trace with source maps
- Sign in as moderator, POST `/api/employees` with a duplicate email — verify the constraint violation (`23505`) appears as a Sentry event tagged `POST /api/employees`
- Open dashboard, confirm no spurious Sentry events fire on normal page load (only real errors should appear)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the Sentry Issues view shows user context, role tag, and route tag on a captured event before marking S-12 complete.

---

## Testing Strategy

### Unit Tests

Not applicable — Sentry instrumentation is an observability layer, not business logic. Unit tests would require mocking the Sentry SDK, which provides no real signal.

### Integration Tests

Not applicable for the same reason — Sentry capture can only be verified against the live production environment (Workers runtime + real Sentry ingest endpoint).

### Manual Testing Steps

1. After Phase 1 deploy: trigger an unhandled exception, confirm it appears in Sentry Issues with deobfuscated stack trace
2. After Phase 2 deploy: POST `/api/absences` with bad data while authenticated as an employee — verify event has user ID, `user_role: employee`, `route: POST /api/absences`
3. Repeat step 2 as a moderator — verify `user_role: moderator` in the Sentry event
4. Check the Sentry Performance tab — confirm sampled transactions appear (10% rate means you may need several requests to see one)
5. Sign out, trigger a 401 (e.g. hit `/api/absences` unauthenticated) — confirm NO Sentry event fires (401s are expected guards, not errors)

## Performance Considerations

`tracesSampleRate: 0.1` adds a small overhead per sampled request (~1-2ms for trace context propagation). At 10% sampling and the app's expected low traffic volume (~10 concurrent users), this is negligible. The middleware role lookup adds one Drizzle query per authenticated request; at `postgres` connection pooling mode, this is ~5-10ms per request — acceptable for a team-internal tool.

## Migration Notes

No data migrations. The `SENTRY_DSN` secret must be set before Phase 1 changes are deployed; if Phase 1 code ships without the secret, behavior is unchanged (SDK silences itself). The middleware Drizzle addition does not change any API behavior — it's additive and guarded.

## References

- Research: `context/changes/sentry-integration/research.md`
- `sentry.server.config.ts` — existing `withSentry` wrapper to modify in Phase 1
- `src/middleware.ts` — existing auth middleware to extend in Phase 2
- `src/lib/db-errors.ts` — `extractPgErrorCode` helper used alongside `captureException` in routes
- `src/types.ts:3` — `UserRole` type

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Config Activation

#### Automated

- [x] 1.1 Build succeeds: `npm run build` — 469614c
- [x] 1.2 TypeScript compiles: `npx tsc --noEmit` — 469614c
- [x] 1.3 Lint passes: `npm run lint` — 469614c

#### Manual

- [x] 1.4 `wrangler secret list` shows `SENTRY_DSN`
- [x] 1.5 Sentry Issues view shows a captured event with deobfuscated stack trace after triggering an unhandled exception in production
- [x] 1.6 Sentry Performance dashboard shows sampled transactions

### Phase 2: Application-Level Instrumentation

#### Automated

- [x] 2.1 TypeScript compiles: `npx tsc --noEmit`
- [x] 2.2 Lint passes: `npm run lint`
- [x] 2.3 Build succeeds: `npm run build`

#### Manual

- [x] 2.4 POST `/api/absences` with missing field — Sentry event shows user ID, `user_role` tag, `route` tag, readable stack trace
- [x] 2.5 Same test as moderator — event shows `user_role: moderator`
- [x] 2.6 401 guard branch does NOT produce a Sentry event
- [x] 2.7 Normal dashboard load produces no spurious Sentry events
