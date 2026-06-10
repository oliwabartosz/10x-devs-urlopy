# Sentry Integration — Plan Brief

> Full plan: `context/changes/sentry-integration/plan.md`
> Research: `context/changes/sentry-integration/research.md`

## What & Why

The Sentry SDK is already scaffolded — packages installed, `withSentry` wrapper wired, source maps configured, CI has the auth token. What's missing is the production activation (one Wrangler secret) and application-level instrumentation (every `catch` block currently silently swallows the original error without sending it to Sentry). S-12 closes that gap so developers can debug production errors without `wrangler tail`.

## Starting Point

`sentry.server.config.ts` wraps the Astro Cloudflare handler with `withSentry` — unhandled exceptions are already captured once `SENTRY_DSN` is set. The application layer (9 API routes + middleware + dashboard) has zero `Sentry.captureException()` calls; caught DB errors, RLS violations, and constraint failures are all silently dropped today.

## Desired End State

Every handled and unhandled exception from the Workers runtime appears in Sentry Issues with a source-mapped stack trace, the triggering user's ID and role, and a route tag. A developer hitting a production 500 can open Sentry, find the event, and read the original PostgreSQL error code alongside the call stack — without touching `wrangler tail`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Phases in scope | Phase 1 + Phase 2 (no GDPR scrubber) | Handles all real production errors; `sendDefaultPii: false` (default) already makes events GDPR-conservative | Plan |
| PII policy | `sendDefaultPii: false`, no `beforeSend` | Default is already safe (cookies and IP excluded); adding a scrubber is parked as Phase 3 | Plan |
| User context | `Sentry.setUser({ id })` + `Sentry.setTag("user_role")` in middleware | Role requires a guarded Drizzle query; tag propagates to all downstream events automatically | Research + Plan |
| Role lookup | Drizzle query in middleware, try/catch | Role is in `employees` table, not JWT; guard degrades gracefully in wrangler dev (TLS failure → ID-only) | Research + Plan |
| Performance tracing | `tracesSampleRate: 0.1` (10%) | Low overhead for a small team app; enables Sentry Performance dashboards | Plan |
| Verification approach | Production deploy + real error test | Workers runtime is the only environment where the full chain (Sentry ingest + source maps) can be verified | Plan |

## Scope

**In scope:**
- Add `tracesSampleRate: 0.1` to `sentry.server.config.ts`
- Set `SENTRY_DSN` Wrangler production secret
- Extend `src/middleware.ts` with guarded Drizzle role lookup + `Sentry.setUser/setTag`
- Add `userRole: UserRole | null` to `src/env.d.ts` `App.Locals`
- Add `Sentry.captureException(err, { tags: { route } })` to all `catch` blocks in 9 API route files
- Add `Sentry.captureException` to 2 `catch` blocks in `src/pages/dashboard.astro`
- Add try/catch wrappers to 3 auth route handlers for unexpected throws

**Out of scope:**
- `beforeSend` GDPR scrubber (parked as Phase 3)
- Sentry dashboard alert rules (configured in UI after deployment)
- 0% or 100% tracing variants
- Dedicated `/api/sentry-test` test endpoint
- Structured logging framework
- Source map configuration changes (already complete)

## Architecture / Approach

```
wrangler.jsonc → sentry.server.config.ts (withSentry wrapper)
                      ↓ Phase 1: add tracesSampleRate: 0.1
                      ↓ Phase 1: set SENTRY_DSN secret

src/middleware.ts  →  Sentry.setUser({ id }) + setTag("user_role", role)
                      (guarded Drizzle lookup for role)
                      ↓
All API routes     →  Sentry.captureException(err, { tags: { route } })
                      (in every existing catch block)
dashboard.astro    →  Sentry.captureException in 2 catch blocks
```

Middleware sets user scope once per request; all downstream `captureException` calls inherit it. Route tags enable per-endpoint filtering in Sentry Issues.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Config Activation | `SENTRY_DSN` secret set, `tracesSampleRate: 0.1` deployed — unhandled exceptions captured in production | Secret must be set before deploy; wrong DSN is a silent no-op |
| 2. Application Instrumentation | All catch blocks forward errors to Sentry; middleware attaches user ID + role | ~12 files changed; easy to miss a catch block — verify with manual test after deploy |

**Prerequisites:** Sentry project must exist (DSN ready to paste); Cloudflare Worker must be deployed at least once (for `wrangler secret put` to work).  
**Estimated effort:** Phase 1 ~15 minutes (one file edit + one CLI command). Phase 2 ~1–2 hours (repetitive pattern across 12 files).

## Open Risks & Assumptions

- **Wrong DSN**: If the DSN pasted into `wrangler secret put` is incorrect, Sentry silently drops events. Verify by checking the Sentry Issues view immediately after Phase 1 deploy.
- **Middleware DB query latency**: The role lookup adds one Drizzle round-trip per authenticated request. At the app's expected scale (~10 users), this is negligible; revisit if the app grows significantly.
- **Compensating transaction failure is now a `"warning"` in Sentry**: The orphaned auth user scenario (Phase 2, `employees/index.ts`) will create Sentry events. This is intentional — the event is a signal that manual cleanup may be needed.

## Success Criteria (Summary)

- Sentry Issues shows a captured event with deobfuscated stack trace after a production unhandled exception (Phase 1 gate)
- A deliberately bad `POST /api/absences` produces a Sentry event with `user_role` tag, `route` tag, and readable trace (Phase 2 gate)
- No Sentry events fire for expected 401 guard branches or normal page loads
