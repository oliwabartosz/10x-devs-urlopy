# S-11 Admin Bootstrap Implementation Plan

## Overview

Introduce a hidden, undeletable **technical admin account** (role `moderator`) that is seeded from environment variables, plus disable self-registration. Because every Drizzle query runs over the service-role connection that **bypasses Supabase RLS** (`AGENTS.md:60`), the "hidden + undeletable" invariant cannot be enforced in the database — it must be re-asserted in application code at every employee read surface and write path. The plan's central decision (settled during questioning) is to **centralize** that enforcement behind a marker column and two shared helpers rather than scatter copy-pasted filters/guards across ~9 sites.

## Current State Analysis

- `employees` table (`src/db/schema.ts:17-26`) has `id, user_id, role (employee|moderator), first_name, last_name, deleted_at, created_at, display_order` — **no marker** to distinguish a technical account. An active admin (`deleted_at IS NULL, role='moderator'`) is indistinguishable from a normal moderator.
- **No central employee-fetch helper exists** — every site builds its own `.from(employees)` query. The auth-gatekeeper lookups (`user_id = ? AND deleted_at IS NULL`) are safe and need no change.
- **RLS is unavailable as a backstop**: `DATABASE_URL` is the service-role pooler; the `postgres` role bypasses RLS (`AGENTS.md:60`, `src/db/index.ts`).
- The moderator user-creation path already exists (S-04): `POST /api/employees:111-163` uses `createAdminClient()` → `auth.admin.createUser({email_confirm:true})` → Drizzle insert, with a compensating `deleteUser` on insert failure. The seed reuses this exact shape.
- **Drizzle queries fail in `wrangler dev`** (workerd TLS rejects Supabase's cert) — automated DB-backed tests aren't viable locally; manual verification runs against the Cloudflare preview/prod deployment.
- Test harness: Vitest (`npm run test` / `test:run`); existing unit tests live in `src/tests/lib/` (e.g. `db-errors.test.ts`), helpers in `src/tests/helpers/`.

### Read surfaces that would leak an active admin (confirmed):

- `GET /api/employees` moderator path — `src/pages/api/employees/index.ts:47` (unfiltered)
- `GET /api/employees` employee path — `src/pages/api/employees/index.ts:50-51` (filters `deleted_at` only)
- Dashboard moderator grid — `src/pages/dashboard.astro:86-95` (unfiltered)
- Dashboard employee grid — `src/pages/dashboard.astro:96-100` (filters `deleted_at` only)
- The dashboard grid feeds the substitute dropdown in `src/components/absence/AbsenceFormDialog.tsx:50` — fixing the dashboard query covers it (no DB access in the component).
- *(Minor)* absence list join — `src/pages/api/absences/index.ts:85-88`. The admin has no absences, so it cannot surface here in practice; out of scope (noted in "What We're NOT Doing").

### Write paths that can mutate an active admin (confirmed):

- `PATCH /api/employees/[id]` (role/name) — `src/pages/api/employees/[id].ts:29-113` (only guards "last moderator")
- `DELETE /api/employees/[id]` (soft-delete) — `src/pages/api/employees/[id].ts:115-180` (only blocks self-delete)
- `POST /api/employees/[id]/restore` — `src/pages/api/employees/[id]/restore.ts:19-80`
- `PATCH /api/employees/order` (raw-SQL bulk UNNEST) — `src/pages/api/employees/order.ts:29-83` (no per-row guard)

## Desired End State

After this plan:

- The `employees` table has an `is_system boolean NOT NULL DEFAULT false` column; exactly one row (the admin) has `is_system = true`.
- Every user-facing employee list excludes `is_system` rows — the admin is invisible in the moderator grid, the employee grid, the management sheet (fed by the same lists), and the substitute dropdown.
- Every employee mutation path rejects (or filters out) operations targeting an `is_system` row — the admin cannot be deleted, renamed, role-changed, restored, or reordered through any API path.
- A seeded admin exists, created idempotently from env via `npm run seed:admin`.
- Self-registration is removed: no signup route, page, form, or signin→signup link.
- The visible-employees filter and the protected-admin guard are unit-tested.

**Verification**: with a seeded admin, a moderator session sees no admin row in any list, and crafted PATCH/DELETE/restore/reorder requests against the admin's id are rejected or no-op. Hitting `/auth/signup` 404s/redirects.

### Key Discoveries:

- Marker must be app-enforced — RLS is bypassed (`AGENTS.md:60`).
- Seed reuses the S-04 create path: `createAdminClient()` → `createUser` → Drizzle insert (`src/pages/api/employees/index.ts:111-163`); admin client config at `src/lib/supabase-admin.ts`.
- The reorder path (`src/pages/api/employees/order.ts`) uses a raw-SQL UNNEST bulk update with no per-row guard — the guard there is a payload filter, not an early-return.
- `is_system` is orthogonal to `role` and `deleted_at`, so the existing "last moderator" count (`[id].ts:90-103`) and all `role === 'moderator'` checks stay untouched.

## What We're NOT Doing

- **Not** adding an `admin` value to the `role` enum — the admin keeps `role='moderator'`; `is_system` is the only new discriminator.
- **Not** relying on RLS for any part of this — all enforcement is app-code.
- **Not** filtering the absence-list join (`absences/index.ts:85-88`) — the admin has no absences, so it cannot leak there; revisit only if the admin ever gets absence rows.
- **Not** building integration tests against a live DB or new CI infrastructure — unit-test the pure logic; manually verify surfaces on the deployment.
- **Not** flipping the Supabase "Enable signup" dashboard toggle — the solution is app-code deletion so it survives a future migration off Supabase. (An operator may flip it manually as defense-in-depth, but it is not part of this plan.)
- **Not** solving "how moderators create users" — already shipped by S-04.
- **Not** adding a client-side hard-hide in `EmployeeManagementSheet` — server-side `is_system` filtering on the source lists is sufficient.

## Implementation Approach

Centralize the invariant in `src/lib/employees.ts`:

1. A **visible-employees filter** the read surfaces compose into their `where` clause (or a query helper) so "hidden" is defined once.
2. An **`isProtectedAdmin(row)` guard** the write paths call before mutating.

Then apply both across the confirmed enforcement points. Schema and helpers land first (no behavior change), the admin is seeded second (so later manual verification has a real target), the invariant is applied third (the real review surface), and self-registration is removed last.

## Critical Implementation Details

- **Reorder is a payload filter, not a guard.** `order.ts` updates many rows in one raw-SQL UNNEST statement; protecting the admin means **excluding any `is_system` row from the update set**, not early-returning the request. A normal reorder payload from the UI won't contain the admin (it's hidden from the grid), so this guards only crafted payloads.
- **Seed runs in Node, not the Worker.** Drizzle works against `DATABASE_URL_DIRECT` (port 5432) in Node tooling but not in `wrangler dev`. The seed script must use the direct URL for the Drizzle insert and `createAdminClient()` (Supabase service key) for the auth user — mirroring the S-04 split.
- **Seed idempotency.** Re-running must not create a second admin or a duplicate auth user. Check for an existing `is_system = true` row (and/or the env email) first and no-op if present.
- **Migration discipline (`AGENTS.md:54-58`).** `npm run db:generate` produces the diff for the new column; review it and confirm it omits nothing hand-maintained before `db:migrate`. The column is a pure additive boolean with a default — safe on the existing table.

## Phase 1: Marker Column + Shared Helpers

### Overview

Add the `is_system` marker and the single source of truth for hiding/protecting it. No behavior change to existing surfaces yet — this phase only introduces the column and the helpers plus their unit tests.

### Changes Required:

#### 1. Schema — add marker column

**File**: `src/db/schema.ts`

**Intent**: Add an `is_system` boolean to the `employees` table so a technical account is distinguishable from a normal moderator.

**Contract**: New column `is_system: boolean("is_system").notNull().default(false)` on the `employees` table. Then generate the migration via `npm run db:generate` (outputs to `supabase/migrations/`), review the diff per migration discipline, and apply with `npm run db:migrate`.

#### 2. Shared helpers

**File**: `src/lib/employees.ts` (new)

**Intent**: Define "a visible (non-system) employee" and "is this row the protected admin?" exactly once, so every read surface and write path references the same definition.

**Contract**: Export (a) a visible-employees predicate usable in Drizzle `where` composition — an `eq(employees.is_system, false)` fragment (and/or a small query helper that applies it) — and (b) `isProtectedAdmin(row: { is_system: boolean }): boolean`. Keep both dependency-light (no DB connection captured) so they are unit-testable with plain mock rows.

#### 3. Unit tests

**File**: `src/tests/lib/employees.test.ts` (new)

**Intent**: Lock the helper behavior so future edits can't silently change what "hidden" or "protected" means.

**Contract**: Tests asserting `isProtectedAdmin` returns true only for `is_system: true` rows, and that the visible-employees predicate excludes system rows / includes normal ones. Pure logic, mock rows, no DB.

### Success Criteria:

#### Automated Verification:

- Migration generates cleanly and the diff is the additive column only: `npm run db:generate`
- Type checking passes: `npm run lint`
- Unit tests pass: `npm run test:run`

#### Manual Verification:

- Generated migration reviewed; adds `is_system boolean NOT NULL DEFAULT false` and nothing else; applied with `npm run db:migrate` against the dev DB.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the migration applied cleanly before proceeding.

---

## Phase 2: Seed the First Admin

### Overview

Create a standalone, idempotent Node script that seeds the technical admin from env, reusing the proven S-04 create path.

### Changes Required:

#### 1. Seed script

**File**: `scripts/seed-admin.ts` (new) + an `npm run seed:admin` entry in `package.json`

**Intent**: Create the admin auth user and its `is_system=true` employee row from env credentials, once per environment, safely re-runnable.

**Contract**: Reads admin email + password from env (names mirroring existing conventions; document them in `.env.example`). Uses `createAdminClient()` (`src/lib/supabase-admin.ts`) for `auth.admin.createUser({ email, password, email_confirm: true })`, and a Drizzle connection over `DATABASE_URL_DIRECT` to insert the employee row with `role: 'moderator', is_system: true`. **Idempotent**: if an `is_system = true` row (or the env-email account) already exists, no-op. On insert failure after auth-user creation, compensating `deleteUser` (same pattern as `index.ts:149-163`).

#### 2. Env + docs

**File**: `.env.example`, `AGENTS.md` (or `README`)

**Intent**: Make the new env vars and the one-time seed step discoverable.

**Contract**: Add the admin email/password vars to `.env.example`; add a short "Seed the admin account" note documenting `npm run seed:admin` and that it runs once per environment in Node (not in `wrangler dev`).

### Success Criteria:

#### Automated Verification:

- Type checking / lint passes: `npm run lint`
- Script type-checks (no runtime DB call in CI): build/lint clean.

#### Manual Verification:

- `npm run seed:admin` against the dev DB creates exactly one `is_system=true` moderator and a matching Supabase auth user (`email_confirm` true).
- Re-running `npm run seed:admin` is a no-op (no second row, no duplicate-user error).

**Implementation Note**: After automated verification passes, pause for manual confirmation that the seed created the admin and is idempotent before proceeding.

---

## Phase 3: Apply the Hidden-Account Invariant

### Overview

Wire the visible-employees filter into every user-facing read surface and the protected-admin guard into every write path. This is the real review surface — the structural risk the frame flagged lives here.

### Changes Required:

#### 1. Read surfaces — exclude `is_system`

**Files**: `src/pages/api/employees/index.ts` (moderator path `:47`, employee path `:50-51`), `src/pages/dashboard.astro` (moderator grid `:86-95`, employee grid `:96-100`)

**Intent**: Ensure no user-facing employee list returns the admin.

**Contract**: Compose the Phase 1 visible-employees predicate into each list query's `where` clause (alongside existing `deleted_at` logic where present). The auth-gatekeeper caller lookups (`user_id = ? AND deleted_at IS NULL`) are unchanged. The substitute dropdown (`AbsenceFormDialog.tsx`) needs no change — it consumes the now-filtered dashboard list.

#### 2. Write paths — guard the admin

**Files**: `src/pages/api/employees/[id].ts` (PATCH `:29-113`, DELETE `:115-180`), `src/pages/api/employees/[id]/restore.ts` (`:19-80`), `src/pages/api/employees/order.ts` (`:29-83`)

**Intent**: Make the admin immutable through every mutation path.

**Contract**: In PATCH, DELETE, and restore, after fetching the target row (these already select the row by id), call `isProtectedAdmin(target)` and return a refusal (e.g. `403`/`409` with a clear message) before mutating. In `order.ts`, **filter `is_system` rows out of the reorder update set** before the UNNEST so a crafted payload cannot reorder the admin (payload filter, not early-return). Select `is_system` in the target/row reads where not already projected.

### Success Criteria:

#### Automated Verification:

- Type checking / lint passes: `npm run lint`
- Unit tests pass: `npm run test:run`

#### Manual Verification (against Cloudflare preview/prod, with seeded admin):

- Moderator session: admin row absent from the dashboard grid, the `GET /api/employees` response, the management sheet, and the substitute dropdown.
- Employee session: admin absent from the employee grid / `GET /api/employees`.
- Crafted `DELETE /api/employees/<adminId>` is refused; admin remains active.
- Crafted `PATCH /api/employees/<adminId>` (role and name) is refused.
- Crafted `POST /api/employees/<adminId>/restore` is refused/no-op.
- Crafted reorder payload including the admin id leaves the admin's row unchanged and reorders the rest.
- No regression: normal employees still list, edit, delete, restore, and reorder correctly.

**Implementation Note**: After automated verification passes, pause for manual confirmation of the leak/immutability checks against the deployment before proceeding.

---

## Phase 4: Disable Self-Registration

### Overview

Remove the self-registration surface entirely so no signup path exists, regardless of auth backend (survives a future migration off Supabase).

### Changes Required:

#### 1. Remove signup surface

**Files**: `src/pages/api/auth/signup.ts`, `src/pages/auth/signup.astro`, `src/components/auth/SignUpForm.tsx` (delete), `src/pages/auth/signin.astro:18` (remove the signin→signup link)

**Intent**: Eliminate every entry point to self-registration.

**Contract**: Delete the signup API route, page, and form component; remove the link to `/auth/signup` from the signin page. Confirm no other references to the signup route/component remain (grep for `signup`, `SignUpForm`, `/auth/signup`). The Supabase dashboard toggle is intentionally not touched (see "What We're NOT Doing").

### Success Criteria:

#### Automated Verification:

- No dangling references: `grep -rn "SignUpForm\|/auth/signup" src` returns nothing (except removals)
- Build passes (no broken imports): `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- Navigating to `/auth/signup` 404s (or redirects) — no signup form renders.
- The signin page shows no "create account / sign up" link.
- Existing users can still sign in normally.

**Implementation Note**: After automated verification passes, pause for manual confirmation that signup is gone and signin still works.

---

## Testing Strategy

### Unit Tests:

- `isProtectedAdmin` returns true only for `is_system: true` rows.
- The visible-employees predicate excludes system rows and includes normal (active and, per existing rules, deleted-for-moderators) rows.

### Integration Tests:

- None added (no live-DB harness; Drizzle can't run in `wrangler dev`). The centralized logic is unit-covered; end-to-end behavior is verified manually on the deployment.

### Manual Testing Steps:

1. Seed the admin (`npm run seed:admin`); confirm one `is_system=true` row + auth user; re-run and confirm no-op.
2. As a moderator on the deployment, confirm the admin is absent from the grid, `GET /api/employees`, the management sheet, and the substitute dropdown.
3. As an employee, confirm the admin is absent from the employee grid.
4. Send crafted DELETE / PATCH(role,name) / restore / reorder requests against the admin id; confirm each is refused or no-op and the admin stays active and unchanged.
5. Confirm normal employees still list/edit/delete/restore/reorder (no regression).
6. Navigate to `/auth/signup`; confirm it's gone; confirm signin still works and shows no signup link.

## Performance Considerations

Negligible. The `is_system` filter is one extra boolean predicate on already-indexed-by-PK queries; the guard is an in-memory check on an already-fetched row.

## Migration Notes

- The new column is additive with a default — existing rows get `is_system = false` automatically; no backfill needed.
- The single `is_system = true` row is established by the Phase 2 seed, not the migration.

## References

- Frame brief: `context/changes/admin-bootstrap/frame.md`
- Schema: `src/db/schema.ts:17-26`
- RLS-bypass constraint: `AGENTS.md:60`; migration discipline: `AGENTS.md:54-58`
- Reused create path (S-04): `src/pages/api/employees/index.ts:111-163`
- Admin client: `src/lib/supabase-admin.ts`
- Read surfaces: `src/pages/api/employees/index.ts:47,50-51`; `src/pages/dashboard.astro:86-100`; `src/components/absence/AbsenceFormDialog.tsx:50`
- Write paths: `src/pages/api/employees/[id].ts:29-180`; `src/pages/api/employees/[id]/restore.ts:19-80`; `src/pages/api/employees/order.ts:29-83`
- Signup surface: `src/pages/api/auth/signup.ts`; `src/pages/auth/signup.astro`; `src/components/auth/SignUpForm.tsx`; `src/pages/auth/signin.astro:18`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Marker Column + Shared Helpers

#### Automated

- [x] 1.1 Migration generates cleanly; diff is the additive column only (`npm run db:generate`) — a61220e
- [x] 1.2 Type checking / lint passes (`npm run lint`) — a61220e
- [x] 1.3 Unit tests pass (`npm run test:run`) — a61220e

#### Manual

- [x] 1.4 Generated migration reviewed (adds `is_system` and nothing else) and applied (`npm run db:migrate`) — a61220e

### Phase 2: Seed the First Admin

#### Automated

- [x] 2.1 Type checking / lint passes (`npm run lint`)
- [x] 2.2 Seed script type-checks; build/lint clean

#### Manual

- [x] 2.3 `npm run seed:admin` creates exactly one `is_system=true` moderator + matching auth user
- [x] 2.4 Re-running `npm run seed:admin` is a no-op

### Phase 3: Apply the Hidden-Account Invariant

#### Automated

- [ ] 3.1 Type checking / lint passes (`npm run lint`)
- [ ] 3.2 Unit tests pass (`npm run test:run`)

#### Manual

- [ ] 3.3 Admin absent from moderator grid, `GET /api/employees`, management sheet, substitute dropdown
- [ ] 3.4 Admin absent from employee grid / employee `GET /api/employees`
- [ ] 3.5 Crafted DELETE on admin refused; admin stays active
- [ ] 3.6 Crafted PATCH (role, name) on admin refused
- [ ] 3.7 Crafted restore on admin refused/no-op
- [ ] 3.8 Crafted reorder payload including admin leaves admin unchanged, reorders the rest
- [ ] 3.9 No regression: normal employees list/edit/delete/restore/reorder correctly

### Phase 4: Disable Self-Registration

#### Automated

- [ ] 4.1 No dangling references (`grep -rn "SignUpForm\|/auth/signup" src` clean)
- [ ] 4.2 Build passes (`npm run build`)
- [ ] 4.3 Lint passes (`npm run lint`)

#### Manual

- [ ] 4.4 `/auth/signup` 404s/redirects; no signup form renders
- [ ] 4.5 Signin page shows no signup link; existing users still sign in
