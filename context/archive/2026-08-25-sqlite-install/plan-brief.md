# Self-hosted VPS install (SQLite + own auth + nginx) — Plan Brief

> Full plan: `context/changes/sqlite-install/plan.md`
> Research: `context/changes/sqlite-install/research.md`

## What & Why

Urlopy runs on Cloudflare Workers against hosted Supabase. It needs to run instead on an internal Linux
VPS with **no network access**, storing data in a SQLite file and authenticating users itself, served by
nginx. The requirement was known at scaffold time — `context/foundation/tech-stack.md:24` records the
"Red Hat server + SQLite" target as a deferred manual adaptation — but was never planned or budgeted.

## Starting Point

The app is far less coupled to Cloudflare than its own docs claim: no Cloudflare runtime API appears
anywhere in source, and `astro:env/server` already falls back to `process.env`, so the adapter swap
touches almost no application code. RLS is already inert — every query runs through Drizzle on a
service-role connection and authorization is app-level by design — so moving to a database without RLS
costs nothing. The real coupling is Supabase Auth (two factory functions, 8 files) and 15 route branches
that compare Postgres error codes.

## Desired End State

One command on a prepared VPS — `sudo ./install.sh` — yields a running systemd service behind nginx, a
SQLite file seeded with the 7-type absence catalogue and one hidden technical admin created from
`ADMIN_LOGIN`/`ADMIN_PASSWORD`. That admin signs in and creates every other user through the UI that
already exists. Backups run on a timer. Nothing reaches the internet.

## Key Decisions Made

| Decision         | Choice                                         | Why (1 sentence)                                                                                                                                  | Source   |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| SQLite driver    | `node:sqlite` via Drizzle `sqlite-proxy`       | The offline VPS makes native modules a liability; this is the only zero-native route, and it also makes `node_modules` portable between machines. | Plan     |
| Password hashing | scrypt from `node:crypto`                      | No dependency, nothing to compile, OWASP-accepted — keeps the offline install trivial.                                                            | Plan     |
| Sessions         | Opaque id in a `sessions` table                | The only design that can honour the "log out other sessions" promise the UI already makes.                                                        | Plan     |
| Existing data    | Fresh install, no migration                    | Removes time-string, timestamp and uuid-format hazards wholesale for ~11 employees of data.                                                       | Plan     |
| Sequencing       | Feature branch until the demo                  | The graded Cloudflare deployment cannot break; merging is what retires it.                                                                        | Plan     |
| Error handling   | Rewrite helper **and** add pre-flight checks   | SQLite's FK errors name neither constraint nor column, so the two distinct 422 messages need explicit lookups.                                    | Plan     |
| TLS              | Configurable                                   | The deployment environment isn't settled yet; cookie `Secure` follows the chosen mode.                                                            | Plan     |
| install.sh scope | Service, env file, DB init, seed, backup timer | nginx ships as a reviewed template placed by hand; Node and npm install are out — the box is offline.                                             | Plan     |
| RLS replacement  | None needed                                    | Already bypassed on the service-role connection; authorization is app-level today.                                                                | Research |
| SMTP             | Not needed                                     | No email flow is live; every user is created pre-confirmed.                                                                                       | Research |

## Scope

**In scope:** SQLite schema and driver; migration + consolidated seed; five Postgres-only query rewrites;
SQLite error mapping with pre-flight existence checks; scrypt credentials, opaque sessions and sign-in rate
limiting; porting the 13 vitest suites to SQLite; `@astrojs/node` + Sentry swap; `install.sh`, systemd units,
nginx template, offline delivery procedure; documentation corrections.

**Out of scope:** migrating Supabase data; removing the Supabase/Cloudflare **packages** (a post-demo
follow-up); retargeting Playwright or adding E2E to CI; any dual-target abstraction; automated deployment
(the VPS is unreachable from CI); installing Node or nginx.

## Architecture / Approach

Six phases on a `sqlite-install` branch, ordered so each is verifiable before the next begins. The schema
lands first — including `users` and `sessions`, before any auth logic exists — so the test harness can be
rebuilt against it in Phase 2. With the suites finally running (they self-skip today), the two riskiest
phases, error mapping and auth, are verified as they are written. Runtime and packaging come last because
unit tests cannot prove them anyway. The driver stays behind `src/db/index.ts` as a single seam, so the
`node:sqlite` choice is reversible in one file.

## Phases at a Glance

| Phase                  | What it delivers                                                        | Key risk                                                                  |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Data layer          | sqlite-core schema, proxy driver, migration + seed, five query rewrites | The proxy row-shape contract corrupts columns silently if mapped wrong    |
| 2. Test infrastructure | 13 suites running against a temp SQLite file instead of skipping        | Fixtures need `users` rows, which Phase 1 must have defined correctly     |
| 3. Error mapping       | SQLite codes + pre-flight checks restoring every 409/422/400            | Reverses a deliberate prior decision; failures here are invisible         |
| 4. Auth replacement    | scrypt credentials, sessions, rate limiting, admin seed                 | Replacing a security boundary; `is_system` has leaked by copy-paste twice |
| 5. Node runtime        | `@astrojs/node` build, Sentry swap, reverse-proxy correctness           | `checkOrigin` 403s every form post if nginx headers are wrong             |
| 6. Install & operate   | install.sh, systemd, nginx template, offline delivery, doc fixes        | First real VPS contact; no network to fix anything in place               |

**Prerequisites:** A VPS with Node 24 and nginx already installed; a way to copy an archive to it; the
`ADMIN_LOGIN`/`ADMIN_PASSWORD` values; a decision on TLS before Phase 6 completes.
**Estimated effort:** ~6–8 sessions across the six phases, with Phase 4 the largest single block.

## Open Risks & Assumptions

- **The demo gates the merge.** Merging the branch is what stops the Cloudflare deploy working; if the demo
  slips, so does the merge.
- **`node:sqlite` with Drizzle is the least-trodden path** in the plan. It is confined to one file, and
  Phase 1's row-mapping tests exist specifically to catch what would otherwise be silent.
- **Rate limiting is in-process** and resets on restart. Acceptable for a single-process VPS; it would need
  rethinking if the app were ever run with multiple workers.
- **The VPS environment is unverified** — Node 24's presence, nginx's configuration, and whether TLS uses an
  internal CA are all assumed rather than confirmed.
- **`node_modules` portability depends on the tree staying native-module-free.** Adding any native dependency
  later silently breaks the offline delivery procedure; Phase 6 asserts zero `.node` binaries in the archive.

## Success Criteria (Summary)

- A prepared but offline VPS goes from copied artifact to working sign-in page with one command.
- The seeded admin can create employees who can then sign in, record absences, and see them in the grid,
  details table and statistics — with the technical admin invisible and immutable throughout.
- Every response contract that Postgres error codes used to drive still returns the same status and the same
  Polish message, proven by tests that actually run rather than skip.
