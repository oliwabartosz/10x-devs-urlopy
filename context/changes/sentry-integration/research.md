---
date: 2026-06-10T14:00:00+02:00
researcher: Bartosz Oliwa
git_commit: 132c28cc014bb9e995235dd8998b23552a79ea28
branch: main
repository: 10xDevs
topic: "S-12: Sentry integration — current state, gaps, and integration strategy"
tags: [research, sentry, cloudflare-workers, observability, error-tracking, source-maps]
status: complete
last_updated: 2026-06-10
last_updated_by: Bartosz Oliwa
---

# Research: S-12 Sentry Integration

**Date**: 2026-06-10  
**Researcher**: Bartosz Oliwa  
**Git Commit**: 132c28cc014bb9e995235dd8998b23552a79ea28  
**Branch**: main  
**Repository**: 10xDevs (Urlopy)

## Research Question

What is the current state of Sentry integration in the codebase? What works already, what gaps exist, and what is the full integration strategy for S-12?

## Summary

**The SDK scaffolding is already in place.** `@sentry/cloudflare` and `@sentry/astro` are installed, `wrangler.jsonc` uses `sentry.server.config.ts` as the Workers entry point (wrapping Astro's handler with `withSentry`), source maps are configured, `SENTRY_AUTH_TOKEN` is in CI, and `SENTRY_DSN` is templated in `.dev.vars.example`.

**The gap is at the application layer.** All nine API routes catch exceptions silently — `try/catch` blocks return `json({ error: "..." }, status)` without forwarding the original error to Sentry. Only unhandled exceptions (crashes that escape all `try/catch`) are currently captured. The middleware has no error handling at all.

**Three tasks remain to close S-12:**
1. Set `SENTRY_DSN` as a production Wrangler secret (one CLI command).
2. Add `Sentry.captureException()` to each `catch` block across 9 API routes + middleware.
3. Decide on GDPR / PII scrubbing policy and wire a `beforeSend` hook.

---

## Detailed Findings

### What is Already Done

| Component | File | Status |
|-----------|------|--------|
| Workers entry wraps handler | [`sentry.server.config.ts:8`](https://github.com/bartorelli/10xDevs/blob/132c28cc014bb9e995235dd8998b23552a79ea28/sentry.server.config.ts#L8) | ✅ Done |
| Client-side error tracking | [`sentry.client.config.js:1`](https://github.com/bartorelli/10xDevs/blob/132c28cc014bb9e995235dd8998b23552a79ea28/sentry.client.config.js#L1) | ✅ Done |
| Astro build integration | [`astro.config.mjs:22-27`](https://github.com/bartorelli/10xDevs/blob/132c28cc014bb9e995235dd8998b23552a79ea28/astro.config.mjs#L22) | ✅ Done |
| Source maps upload | `wrangler.jsonc` `upload_source_maps: true` | ✅ Done |
| `SENTRY_AUTH_TOKEN` in CI | `.github/workflows/ci.yml:33` | ✅ Done |
| `nodejs_compat` flag | `wrangler.jsonc` `compatibility_flags` | ✅ Done |
| Console warn/error capture | `sentry.server.config.ts:11` `captureConsoleIntegration` | ✅ Done |
| DSN template in local dev | `.dev.vars.example:9` `SENTRY_DSN=https://...` | ✅ Done |
| SDK packages installed | `package.json` `@sentry/astro ^10.57.0`, `@sentry/cloudflare ^10.57.0` | ✅ Done |

**`withSentry` wraps the full request lifecycle.** Any unhandled exception — a thrown error that escapes all `try/catch`, a rejected `Promise` with no handler — is automatically captured with stack trace, request URL, method, and Worker bindings. This covers hard crashes today.

### What the `withSentry` Wrapper Looks Like

```typescript
// sentry.server.config.ts
import * as Sentry from "@sentry/cloudflare";
import handler from "@astrojs/cloudflare/entrypoints/server";

export default Sentry.withSentry<Env>(
  (env) => ({
    dsn: env.SENTRY_DSN,                                    // runtime binding, not baked into bundle
    integrations: [Sentry.captureConsoleIntegration({ levels: ["warn", "error"] })],
  }),
  handler,
);
```

`tracesSampleRate` is not set → performance tracing disabled. `sendDefaultPii` not set → defaults to `false` (cookies and IP not sent — GDPR-safe by default).

### What Is Missing

#### 1. Production `SENTRY_DSN` secret not set

The DSN is templated in `.dev.vars.example` but the production Wrangler secret has never been set. Until this runs, the server-side integration does nothing in production (DSN is undefined → SDK silences itself).

**Fix:** `wrangler secret put SENTRY_DSN` (one command, run once after creating a Sentry project and copying the DSN).

#### 2. Handled exceptions are silently dropped

All API routes follow this pattern:

```typescript
// src/pages/api/absences/index.ts:207-214 (representative)
} catch (err) {
  const code = extractPgErrorCode(err);
  // code determines status, but `err` itself goes nowhere
  return json({ error: "Database error" }, 500);
}
```

The original PostgreSQL error, stack trace, and context are discarded. Sentry never sees these. The same pattern repeats across all nine API route files. Only the one `console.error()` call in `src/pages/api/employees/index.ts:147` survives (and `captureConsoleIntegration` will catch that one).

**Affected files:**
- `src/pages/api/absences/index.ts` — GET, POST, ~5 catch blocks
- `src/pages/api/absences/[id].ts` — PATCH, DELETE, ~3 catch blocks
- `src/pages/api/employees/index.ts` — GET, POST, compensating txn catch
- `src/pages/api/employees/[id].ts` — PATCH, DELETE
- `src/pages/api/employees/order.ts` — PATCH
- `src/pages/api/employees/[id]/restore.ts` — POST
- `src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts`
- `src/pages/dashboard.astro` — two `try/catch` blocks set boolean flags, lose errors
- `src/middleware.ts` — no `try/catch` at all around `supabase.auth.getUser()`

#### 3. No user context attached to errors

No `Sentry.setUser()` is called after authentication. Errors in Sentry won't be associated with a user ID, making triage harder when investigating "who triggered this error".

**Fix:** Add to `src/middleware.ts` after `context.locals.user` is resolved:
```typescript
if (context.locals.user) {
  Sentry.setUser({ id: context.locals.user.id });
}
```

#### 4. No GDPR `beforeSend` scrubber

`sendDefaultPii` is `false` (default) — cookies and IP are not sent. But `captureConsoleIntegration` may capture console output containing user-identifiable data if a developer logs request payloads. A `beforeSend` hook provides a safety net.

---

## Architecture Insights

### The Two-Layer Sentry Setup

```
Browser                          Cloudflare Worker
  │                                    │
  ▼                                    ▼
sentry.client.config.js       sentry.server.config.ts
(@sentry/astro)                 (withSentry wrapper)
  │                                    │
  └──── captures JS exceptions ────────┘
         in the browser               captures unhandled
                                      Worker exceptions
                                      + console.warn/error
                                      (once SENTRY_DSN is set)
```

### DSN Convention Decided

- **Runtime binding** (`env.SENTRY_DSN` via Worker binding) — server-side
- **Hardcoded** in `sentry.client.config.js` — client-side (acceptable; client DSN is always public)
- **NOT** in `astro.config.mjs` env schema (DSN is not a build-time secret)
- **SENTRY_AUTH_TOKEN** is build-time only (source map upload)

### Source Map Flow

```
npm run build
  → Astro + Vite compile → dist/server/entry.mjs (minified)
  → @sentry/astro Vite plugin reads SENTRY_AUTH_TOKEN
  → uploads .map files to Sentry artifact store
  → wrangler.jsonc upload_source_maps: true also uploads via Cloudflare
  → Sentry deobfuscates stack traces automatically
```

Both Sentry and Cloudflare receive source maps. Sentry uses its copy for stack trace deobfuscation in the Issues UI; Cloudflare uses theirs for `wrangler tail` and Logpush.

### `nodejs_compat` Already Enabled

The `withSentry` wrapper requires `AsyncLocalStorage` (Node.js API) to maintain async request context. `wrangler.jsonc` already has `"compatibility_flags": ["nodejs_compat"]` — no action needed.

---

## Roadmap Unknowns — Resolved

| Unknown (from roadmap S-12) | Resolution |
|----------------------------|------------|
| DSN as Wrangler secret vs `wrangler.jsonc` env var | **Wrangler secret** (`env.SENTRY_DSN` runtime binding). Already reflected in `.dev.vars.example`. |
| `@sentry/astro` source maps auto or manual/skip? | **Auto via `@sentry/astro`** — already configured in `astro.config.mjs` with `authToken`. Source maps upload happens during `npm run build`. `wrangler.jsonc` also has `upload_source_maps: true`. Both paths active. |
| `sendDefaultPii` and RODO scrubbing | **`sendDefaultPii` defaults to `false`** → cookies/IP not sent. A `beforeSend` scrubber is not strictly required but is a useful defense-in-depth for console log capture via `captureConsoleIntegration`. Decide before phase 2. |

---

## Integration Strategy

### Phase 1 — Activate Production Capture (1 command, 0 code changes)

Set the production runtime secret:

```bash
wrangler secret put SENTRY_DSN
# paste the DSN from Sentry dashboard when prompted
```

After this, all unhandled exceptions from the Worker will appear in Sentry with readable stack traces. `captureConsoleIntegration` will forward `console.warn`/`console.error` output. Client-side JS errors are already captured (DSN is hardcoded in `sentry.client.config.js`).

**Verification:** Deploy, trigger a 500 error, check Sentry Issues.

### Phase 2 — Application-Level Capture (code changes across 9 API routes)

Add `Sentry.captureException(err)` to each `catch` block that currently swallows errors:

```typescript
// Pattern for all API route catch blocks
} catch (err) {
  Sentry.captureException(err, {
    tags: { route: "POST /api/absences" },
    user: { id: context.locals.user?.id },
  });
  const code = extractPgErrorCode(err);
  return json({ error: "Database error" }, 500);
}
```

Add user context in middleware:

```typescript
// src/middleware.ts — after user resolution
if (context.locals.user) {
  Sentry.setUser({ id: context.locals.user.id });
}
```

Add try/catch to middleware auth fetch (currently naked):

```typescript
// src/middleware.ts:12 — currently no error handling
try {
  const { data: { user } } = await supabase.auth.getUser();
  context.locals.user = user ?? null;
} catch (err) {
  Sentry.captureException(err);
  context.locals.user = null;
}
```

Promote `console.error` in compensating transaction to Sentry:

```typescript
// src/pages/api/employees/index.ts:147
await adminClient.auth.admin.deleteUser(authData.user.id).catch((err) => {
  Sentry.captureException(err, {
    level: "warning",
    contexts: { compensation: { userId: authData.user.id, action: "delete_orphaned_auth_user" } },
  });
});
```

### Phase 3 — GDPR Scrubber (optional, low-risk)

Add `beforeSend` to `sentry.server.config.ts`:

```typescript
(env) => ({
  dsn: env.SENTRY_DSN,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request?.cookies) event.request.cookies = {};
    if (event.request?.data) delete event.request.data;
    return event;
  },
  integrations: [Sentry.captureConsoleIntegration({ levels: ["warn", "error"] })],
}),
```

---

## Code References

- `sentry.server.config.ts:1-14` — Worker entry point, `withSentry` wrapper
- `sentry.client.config.js:1-5` — Client-side Sentry init (hardcoded DSN)
- `astro.config.mjs:22-27` — Build-time `sentry()` integration, `authToken`
- `wrangler.jsonc:3` — `"main": "./sentry.server.config.ts"`
- `wrangler.jsonc:5` — `"compatibility_flags": ["nodejs_compat"]`
- `.dev.vars.example:9` — `SENTRY_DSN` template
- `.github/workflows/ci.yml:33` — `SENTRY_AUTH_TOKEN` secret in build
- `src/middleware.ts:1-25` — Auth middleware (no error handling)
- `src/pages/api/absences/index.ts:207-214` — Representative catch-and-swallow pattern
- `src/pages/api/employees/index.ts:144-149` — Only `console.error()` in codebase
- `src/pages/dashboard.astro:39-53` — Page-level catch sets boolean flags, loses errors

---

## Open Questions

1. **Sentry project and org slug** — `astro.config.mjs` has `project: "javascript-astro"` and `org: "bartosz-o4"`. Verify these match the actual Sentry dashboard project before assuming source map uploads succeeded.

2. **Client DSN hardcoded in `sentry.client.config.js`** — The DSN `https://9ab5f9745a745e02e332f779c4cb3db7@o4511534802993152.ingest.de.sentry.io/4511534806007888` is embedded in the public bundle. This is standard practice (client DSN is always public), but should be confirmed as intentional.

3. **Has `SENTRY_DSN` ever been set in production?** — If yes, server-side capture is already active and the roadmap description of "zero manual triage" is partially met already. If no, Phase 1 is the first real unlock.

4. **`tracesSampleRate`** — Not set in `sentry.server.config.ts`. Setting it to `0.1` (10%) would enable Sentry Performance for tracking slow requests without significant overhead. Decide if performance tracing is in scope for S-12 or parked for later.

5. **Sentry dashboard alert rules** — Out of SDK scope. Once Phase 1 is live, configure alert rules in the Sentry UI (Issues → Alerts) for new-issue notifications to Slack or email.
