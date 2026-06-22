# Frame Brief: S-11 admin-bootstrap

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

S-11 `admin-bootstrap` is unbuilt (roadmap status `proposed`; no change folder,
no implementing commit). As specced it bundles four things into one slice:
1. Seed the first admin (role moderator) from `.env`/`.env.dev`.
2. Disable self-registration (only moderators add users thereafter).
3. Make the admin a **hidden technical account** — invisible in grid, details,
   and employee list, and undeletable by other moderators.
4. "How do moderators create users without self-registration?"

The roadmap carries all four as open Unknowns to decide before planning.

## Initial Framing (preserved)

- **User's stated cause or approach**: Treat S-11 as one slice with four open
  Unknowns; run `/10x-frame` to lock them, then `/10x-plan`.
- **User's proposed direction**: Frame, then plan `admin-bootstrap`.
- **Pre-dispatch narrowing**: Lead concern = **hidden technical admin**. The
  hidden/technical/undeletable nature is a **hard requirement** (load-bearing),
  not "an ordinary moderator is fine". Environment = **pre-launch / no real
  users** (so disabling signup carries little reversibility risk).

## Dimension Map

The work could originate at any of these dimensions:

1. **Schema / identity** — how is the admin marked? Today the `employees` table
   has `id, user_id, role (employee|moderator), first_name, last_name,
   deleted_at, created_at, display_order` — **no `is_system`/`is_hidden`
   marker**, and `role` enum is only employee|moderator. An active admin
   (`deleted_at IS NULL`, `role='moderator'`) is **indistinguishable from a
   normal moderator** without a new marker.
2. **Read path (visibility)** — every query that surfaces employees must
   exclude the admin.  ← highest missed-filter risk
3. **Write/delete path** — undeletability/immutability enforcement.
4. **RLS vs app-layer** — could Postgres RLS hide+protect the admin centrally,
   so each site needn't repeat the guard?  ← decides 2 & 3
5. **Bootstrap + signup gate** — seed mechanism and disabling self-registration
   (the parts the roadmap emphasized).

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| D4: RLS can centrally enforce hide+protect | Drizzle connects via `postgres-js` with the **service-role** `DATABASE_URL` (Transaction pooler :6543) — `src/db/index.ts:9-13`, `.env.example:4`. `auth.uid()` never resolves over this connection; the `postgres` role bypasses RLS. **`AGENTS.md:60`**: *"DATABASE_URL uses the service role key, which bypasses Supabase RLS … Do not rely on RLS as a safety net for Drizzle queries."* RLS backstop is useless for every Drizzle path. | STRONG (negative) — RLS is NOT available |
| D2: Visibility risk is spread across many sites | 27 employee query sites; 10 are internal per-user role lookups (safe). User-facing surfaces that would leak an active admin: `GET /api/employees:47` (moderator path, unfiltered), `dashboard.astro:86-100` (moderator grid → feeds substitute dropdown), substitute selector `AbsenceFormDialog.tsx:50`, employee list. Existing `deleted_at IS NULL` filters do **not** exclude an active admin. | STRONG |
| D3: Write paths can all touch the admin | 5 paths mutate employees, none protect a seeded admin: DELETE soft-delete `[id].ts:115-180`, PATCH role/name `[id].ts:29-113` (only guards "last moderator", not admin), reorder `order.ts:29-83`, restore `[id]/restore.ts`, and UI only blocks self-delete (`EmployeeManagementSheet.tsx:93`). | STRONG |
| D1: A new marker column is required | No `is_system`/`is_hidden` today; `deleted_at` can't be reused (admin is active). Cannot distinguish admin from a normal moderator without a new field. | STRONG |
| D5 (Unknown #3): "how moderators create users" is open | **Already implemented by S-04.** `POST /api/employees:118-148` uses the service-role admin client to `createUser` + insert employee in one op, with compensating delete on failure. Not an open question. | RESOLVED (already done) |
| D5: seed + disable signup are the hard part | Seed is a one-time script/SQL; disabling signup touches a small surface (`signup.ts`, `auth/signup.astro`, `SignUpForm.tsx`, signin link `signin.astro:18`, Supabase auth setting). Pre-launch → low reversibility risk. | WEAK (low-risk, near-mechanical) |

## Narrowing Signals

- User confirms the **hidden/technical/undeletable** nature is load-bearing —
  so the visibility+immutability invariant (D2+D3) is in scope, not optional.
- **Pre-launch, no real users** — disabling self-registration and seeding are
  low-risk; they are not where the engineering weight sits.
- Unknown #3 is already solved by S-04 — removes a whole quarter of the slice.

## Cross-System Convention

This project has **no shared employee-fetch helper** — each of ~10 sites builds
its own `.from(employees)` query. S-08 (`deactivated-employee-grid`) already
established **per-site** visibility logic (moderator-sees-all vs
employee-sees-active), enforced query-by-query with no central choke point and
no RLS backstop. Adding a **third** visibility state (hidden admin) onto this
scattered enforcement is exactly the convention's weak spot — the roadmap's
flagged risk ("ryzyko pominięcia filtra w nowym kodzie") is **structural, not
incidental**.

## Reframed Problem Statement

> **The actual problem to plan around is**: introducing a hidden, undeletable
> account into a system whose access control is entirely application-code (RLS
> is bypassed by Drizzle) — so the hidden-account invariant must be re-asserted
> at ~8 independent enforcement points (≈3 read surfaces + 5 write paths) with
> **no database backstop**. The seed-admin and disable-signup parts are small,
> low-risk, near-mechanical (especially pre-launch); the engineering weight and
> the entire risk live in the hidden-account invariant.

The initial "four Unknowns" framing was directionally right but mis-weighted:
one Unknown (#3) is already done, two (seed, disable-signup) are trivial here,
and the fourth — where the admin lives — is the whole ballgame. Its difficulty
is structural: because RLS can't enforce it, **the app-code centralization is
the safety mechanism**. The plan's central decision is single-source-of-truth
enforcement (a marker column + a shared "visible employees" query helper and a
shared "is protected admin?" guard) versus copy-pasting filters/guards across
all sites. Choosing centralization is what converts the flagged risk from
"likely missed someday" to "asserted in one place".

## Confidence

**HIGH** — three independent sub-agents returned consistent, file:line-cited
evidence; the RLS-bypass fact is documented in `AGENTS.md:60`; the
no-central-helper and S-08 precedent corroborate the structural risk.

## What Changes for /10x-plan

Plan S-11 as **three separable concerns, risk-ordered**, not one bundle:
(A) the **hidden-account invariant** — new marker column + a single shared
visible-employees query helper + a single shared protected-admin guard, applied
to the ~8 enforcement points the investigation listed (this is the real plan
content and where review effort belongs); (B) **seed the first admin** from env
(one-time script/SQL, reusing the S-04 service-role create path); (C) **disable
self-registration** (remove/guard signup route + page + form + signin link;
decide Supabase Auth "enable signup" toggle). Drop Unknown #3 — moderator
user-creation already exists (S-04). Do **not** rely on RLS for any of it.

## References

- Source: `src/db/index.ts:9-13`, `AGENTS.md:60`, `.env.example:4`
- Read surfaces: `src/pages/api/employees/index.ts:47`,
  `src/pages/dashboard.astro:86-100`,
  `src/components/absence/AbsenceFormDialog.tsx:50`
- Write paths: `src/pages/api/employees/[id].ts:29-180`,
  `src/pages/api/employees/order.ts:29-83`,
  `src/pages/api/employees/[id]/restore.ts`
- Already-done dependency: `src/pages/api/employees/index.ts:118-148` (S-04)
- Signup surface: `src/pages/api/auth/signup.ts`,
  `src/pages/auth/signup.astro`, `src/components/auth/SignUpForm.tsx`,
  `src/pages/auth/signin.astro:18`
- Precedent: S-08 `context/archive/2026-06-03-deactivated-employee-grid/`
- Investigation: 3 parallel Explore/general-purpose sub-agents (read/write/RLS)
