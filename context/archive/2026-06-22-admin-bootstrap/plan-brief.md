# S-11 Admin Bootstrap — Plan Brief

> Full plan: `context/changes/admin-bootstrap/plan.md`
> Frame brief: `context/changes/admin-bootstrap/frame.md`

## What & Why

Introduce a hidden, undeletable **technical admin account** (role `moderator`) seeded from environment variables, and disable self-registration so only moderators add users. The hard part isn't the seed or the signup toggle — it's that the admin must be invisible and immutable in a system whose access control is **entirely application code** (Drizzle runs over the service-role connection that bypasses Supabase RLS). The invariant has to be re-asserted at ~9 independent enforcement points with no database backstop.

## Starting Point

The `employees` table has no marker distinguishing a technical account, so an active admin is indistinguishable from a normal moderator. There is **no shared employee-fetch helper** — each of ~9 sites builds its own query, which is exactly where a "third visibility state" tends to be forgotten. The moderator-creates-user path already exists (S-04) and the seed reuses it.

## Desired End State

One `employees` row carries `is_system = true`; it is absent from every user-facing list (moderator grid, employee grid, management sheet, substitute dropdown) and rejected by every mutation path (delete, role/name edit, restore, reorder). A seeded admin exists via an idempotent `npm run seed:admin`, and self-registration no longer exists anywhere in the app.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| RLS as backstop | Not available | Drizzle uses the service-role connection that bypasses RLS — all enforcement is app-code. | Frame |
| Marker design | New `is_system` boolean column | Orthogonal to `role`/`deleted_at`, so existing role checks and the "last moderator" count are untouched. | Plan |
| Enforcement model | Two shared helpers (visible-employees filter + `isProtectedAdmin` guard) | Turns "missed filter someday" into a single source of truth; concentrates review in one file. | Frame + Plan |
| Seed mechanism | Standalone `npm run seed:admin` Node script | Mirrors the proven S-04 create path; runs in Node where Drizzle works; idempotent. | Plan |
| Disable signup | Delete the signup surface (route/page/form/link) | Fully portable — survives a planned future migration off Supabase; no dashboard toggle dependency. | Plan |
| Guard scope | Block ALL mutations on the admin (delete, role/name, restore, reorder) | Matches the "undeletable technical account" requirement; reorder is a payload filter, not an early-return. | Plan |
| Testing | Unit-test the helpers/guard; manually verify surfaces | Drizzle can't run in `wrangler dev`; the centralized logic is where the risk concentrates. | Plan |

## Scope

**In scope:** `is_system` column + migration; shared helpers + unit tests; idempotent seed script; applying the filter to ~5 read surfaces and the guard to ~4 write paths; deleting the self-registration surface.

**Out of scope:** RLS-based enforcement; the absence-list join (admin has no absences); `role` enum changes; live-DB integration tests; the Supabase "Enable signup" dashboard toggle; moderator user-creation (already shipped by S-04).

## Architecture / Approach

A new `src/lib/employees.ts` owns the invariant: a visible-employees predicate the read queries compose into their `where`, and an `isProtectedAdmin(row)` guard the write paths call before mutating. Schema + helpers land first (no behavior change), the admin is seeded second (so later verification has a real target), the invariant is applied third (the real review surface), and self-registration is deleted last.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Marker + helpers | `is_system` column, shared filter + guard, unit tests | Migration diff must be the additive column only |
| 2. Seed admin | Idempotent `npm run seed:admin` reusing S-04 path | Idempotency — no duplicate admin/auth user on re-run |
| 3. Apply invariant | Filter on ~5 read surfaces, guard on ~4 write paths | A missed site re-leaks the admin (the structural risk) |
| 4. Disable signup | Signup route/page/form/link deleted | Dangling references / broken imports after deletion |

**Prerequisites:** `data-schema-and-rls` and `employee-management` (both done); env admin email + password; Cloudflare preview/prod for manual verification (Drizzle can't run locally).
**Estimated effort:** ~2-3 sessions across 4 phases; Phase 3 carries most of the review weight.

## Open Risks & Assumptions

- The structural risk is a future query that forgets the filter — mitigated by the shared helper but not eliminated; new employee-list sites must adopt it.
- Reorder protection is a payload filter on a raw-SQL UNNEST update — verify a crafted payload including the admin id truly leaves it unchanged.
- Seed idempotency depends on a reliable existence check (by `is_system`/env email) before creating the auth user.
- Manual verification depends on a working preview/prod deployment since Drizzle won't run in `wrangler dev`.

## Success Criteria (Summary)

- A moderator and an employee never see the admin in any list, dropdown, or detail surface.
- No API path can delete, rename, role-change, restore, or reorder the admin.
- `/auth/signup` no longer exists; existing users still sign in; the admin is seeded idempotently from env.
