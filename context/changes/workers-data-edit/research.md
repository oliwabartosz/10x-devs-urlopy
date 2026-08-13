---
date: 2026-08-12T15:52:09+02:00
researcher: Bartosz Oliwa
git_commit: 23628c000fca41477ed598dcbea2750335feb8bf
branch: main
repository: 10xDevs
topic: "Moderator edits worker e-mail and holiday-balance day counts; workers change their own password"
tags: [research, codebase, auth, supabase-admin, employees, holiday-balances, topbar]
status: complete
last_updated: 2026-08-12
last_updated_by: Bartosz Oliwa
---

# Research: Moderator edits worker e-mail and balance days; workers change their own password

**Date**: 2026-08-12T15:52:09+02:00
**Researcher**: Bartosz Oliwa
**Git Commit**: `23628c0` (`chore(grid-adjustment-offsite-training): single-codepoint offsite icon (p1)`)
**Branch**: main
**Repository**: 10xDevs

> Note: the working tree advanced during this research (three files listed as modified at session start — `korekta-gate.test.ts`, `HolidayBalanceCard.tsx`, `HolidayBalanceDialog.tsx` — landed in `63f7a38` mid-sweep). All findings below were re-verified against `23628c0`.

## Research Question

> Moderator should have possibility to change the e-mail of their workers and number of the absence days: bieżące, zaległe, korekta. Each worker should have possibility to edit his own password while clicking his e-mail in the left upper corner.

Scope decisions taken before the sweep:
- The e-mail change is an **Auth identity change via the Supabase Admin API** (service role), effective immediately, no confirmation mail to the worker.
- Password authentication approach left open — research what the codebase and Supabase actually support.

## Summary

The request is three separate features with wildly different costs, and the naming in the request needs one correction before anything is planned.

**Vocabulary fix first.** "number of the absence days: bieżące, zaległe, korekta" are **holiday/urlop balance** fields on the `holiday_balances` table, not absence-day counts. `absences` is a different table entirely, and the fourth visible number ("Wykorzystane") is *computed*, never stored (`src/lib/services/holiday-balance.ts:15-59`). A plan written against "absence days" risks being implemented against the wrong table.

**Feature 2 (balance days) is almost free — it is a pure UI gap.** `POST /api/holiday-balances` already takes `employee_id` in the request body, already lets a moderator target any employee (including soft-deleted ones), and already has a field-level moderator gate on `used_adjustment_days` (korekta). `GET /api/holiday-balances?employee_id=&year=` already works the same way. The only reason a moderator cannot do this today is that `HolidayBalanceCard` is mounted exactly once, hard-wired to `currentEmployee.id` (`src/pages/dashboard.astro:246-253`). **No API work, no migration.** This is also explicitly the work the last change said should come next (`context/archive/2026-08-07-holiday-balance-valid-until/change.md:133-140`: *"Confirmed still wanted — it should lead the next change in this area."*).

**Feature 1 (e-mail) is the expensive one, and larger than it looks.** `employees` has no `email` column; the address lives only in `auth.users`. Nothing in the codebase ever reads it back — it is typed once in `AddEmployeeDialog` and written straight into `auth.admin.createUser`. So **a moderator cannot see any worker's e-mail anywhere in the product today.** A read path must be built before an edit path, and `PATCH /api/employees/[id]` currently rejects an `email` key outright. It also reverses a recorded decision (`context/changes/employee-management/plan.md:39` — *"No ability to change an employee's email after creation"*) and grants a moderator power the PRD does not authorize, with no audit trail anywhere in the system.

**Feature 3 (self-service password) is net-new but small and self-contained.** `supabase.auth.updateUser({ password })` works off the existing SSR cookie session — no service key needed. Supabase supports an optional `current_password` argument that gives an old-password check without touching any project setting; that is the safest gate here and is what I'd recommend. The blocker is presentational: `Topbar.astro:14` is a plain, non-interactive `<span>` in a zero-JS Astro component, and the top bar's layout was deliberately locked by S-17.

### Cost sketch

| Feature | API work | Migration | UI work | Reverses a decision? |
|---|---|---|---|---|
| Balance days (bieżące/zaległe/korekta) | **none** — already supports it | none | moderate (new mount + first async read in the sheet) | no — completes a deferral |
| Worker e-mail | new read path + `PATCH` extension | none (auth-only) | small | **yes** — `employee-management/plan.md:39` |
| Own password | one new route | none | new Topbar affordance (first island there) | no — but PRD-extending |

## Detailed Findings

### 1. Data model — where e-mail and the three day-counts actually live

`src/db/schema.ts:17-29` — `employees` carries `id, user_id, role, first_name, last_name, deleted_at, created_at, display_order, is_system`. **No e-mail.** The link to Auth is `user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE` (`supabase/migrations/20260526000001_schema.sql:16-24`). There is no `handle_new_user()` trigger — the employees row is created explicitly in app code after `admin.createUser` (`src/pages/api/employees/index.ts:149-152`), with a compensating `admin.deleteUser` on failure (`:157-164`).

`src/db/schema.ts:68-88` — `holiday_balances` carries the three fields the request names:

| Request term | Column | Type |
|---|---|---|
| bieżące | `current_entitlement_days` | `integer NOT NULL DEFAULT 0` |
| zaległe | `carryover_days` | `integer NOT NULL DEFAULT 0` |
| korekta | `used_adjustment_days` | `integer NOT NULL DEFAULT 0` |

Unique on `(employee_id, year)`. CHECK constraints (year 2000–2100, all three columns `>= 0`) are **hand-added** to the migration and invisible to Drizzle — `src/db/schema.ts:85-87` and `AGENTS.md:58` both warn they must be re-inspected after any `db:generate`.

Because `auth.users.id` is the FK and an e-mail change never touches the id, **changing an e-mail has zero DB-side ripple** — employees, absences, balances and every RLS predicate keep matching.

### 2. Feature 2 — moderator editing balances is a UI gap only

`src/pages/api/holiday-balances/index.ts:116-235` (`POST`, upsert):

- `HolidayBalanceUpsertSchema` (`:105-114`) takes `employee_id` (uuid), `year`, both open day-fields as required `z.number().int().min(0)`, and `used_adjustment_days` as **optional with no `.default(0)`** — verified on disk, with a comment explaining that an omitted adjustment means "leave unchanged", not "reset to zero".
- **No route-level role gate.** Both roles may write `current_entitlement_days` and `carryover_days` for **any** employee (`:147-156`); moderators may even target soft-deleted employees (`:153-156`).
- The **korekta gate** is field-level, verified verbatim at `:178`:
  ```ts
  const canWriteAdjustment = caller.role === "moderator" && used_adjustment_days !== undefined;
  ```
  and the column is then spread-omitted from both `.values()` (`:189`) and `.onConflictDoUpdate().set()` (`:197`). A non-moderator gets **200**, and the stored value survives untouched. The in-file comment states the reason: the dialog does a full-replace save of all three fields, so a 403 would break ordinary saves.
- Locked by `src/tests/api/holiday-balances/korekta-gate.test.ts` — 8 cases, including two added in `63f7a38` (finding F9) that exist purely to fail if `.default(0)` ever comes back.

`GET` (`:34-103`) already accepts `?employee_id=` (`:49-51`) with the same "moderators may target soft-deleted" branch, and returns a fully computed `HolidayBalanceView`.

**The only blocker** is `src/pages/dashboard.astro:246-253`: `HolidayBalanceCard` is mounted once with `employeeId={currentEmployee.id}` and `year={balanceYear}` pinned to `now.getFullYear()` (`:37`). `EmployeeManagementSheet` (`dashboard.astro:218`) receives no balance data at all.

`HolidayBalanceDialog.tsx` is nearly reusable verbatim — it takes `{ balance, employeeId, year, currentRole }` and already POSTs `employee_id` explicitly (`:118`). What it needs is a caller that hands it another employee's `HolidayBalanceView`, which means the sheet must `GET` on row-click — **the first genuine async read in `src/components/employee/`**, a component that today has no loading or skeleton state.

### 3. Feature 1 — the e-mail change

**There is no read path.** Repo-wide search for `listUsers` / `getUserById` returns zero hits; the only `auth.admin.*` calls anywhere are `createUser` and `deleteUser`, both in `src/pages/api/employees/index.ts`. `GET /api/employees` selects `id, first_name, last_name, role, deleted_at, created_at, display_order` (`:35-43`) — no e-mail. The only address rendered anywhere in the app is the session owner's own, at `Topbar.astro:14`.

Options for the read, none free:
- `admin.listUsers()` — paginated (default `perPage: 50`), one call joined client-side on `user_id` (already shipped to the island at `dashboard.astro:87`).
- `admin.getUserById(user_id)` per row — N round-trips inside the dashboard's already-batched `Promise.all` (`dashboard.astro:112-161`).

**The write.** `PATCH /api/employees/[id]` is verified as `first_name` / `last_name` / `role` only (`src/pages/api/employees/[id].ts:20-28`), and the handler writes `parsed.data` straight into `db.update(employees)` (`:116`) — an added `email` key would have to be split out of that object, because it goes to Supabase Auth, not to the table.

**Supabase semantics** (context7, `/supabase/auth` — the GoTrue `adminUserUpdate` handler and README):
- `auth.admin.updateUserById` writes `users.email` directly. It **does not** go through the `email_change` double-confirm flow that self-service `updateUser({ email })` uses — which is exactly why the admin API is the right tool for the chosen "immediate, no confirmation" behaviour. (Local config confirms the self-service path would double-confirm: `supabase/config.toml:208` `double_confirm_changes = true`.)
- **Pass `email_confirm: true`.** Omitting it leaves `email_verified: false`, which with confirmations enabled would lock the worker out. This mirrors the existing `createUser({ email_confirm: true })` at `employees/index.ts:128`.
- **No session revocation occurs on e-mail change** — the handler contains no logout or refresh-token revoke. The worker's cookie session keeps working; the JWT's `email` claim just goes stale until refresh.
- `GOTRUE_MAILER_NOTIFICATIONS_EMAIL_CHANGED_ENABLED` defaults to `false`, so no notification mail fires by default.
- Duplicate-address collisions surface as the same 422-family error `createUser` returns; the established mapping is 409 + `"Konto z tym adresem email już istnieje."` (`employees/index.ts:138-140`).

### 4. Feature 3 — self-service password change

**Zero prior art.** `grep` for `updateUser|resetPasswordForEmail|reauthenticate|verifyOtp|exchangeCodeForSession` across `src/` and `tests/` returns nothing. There is no `/api/auth/password` route; `src/pages/api/auth/` holds only `signin.ts` and `signout.ts` (plus inert `.scaffold` files — the whole signup surface was deliberately deleted in `admin-bootstrap/plan.md:221`).

**Supabase semantics** (context7, `/supabase/supabase` — `guides/auth/passwords.mdx`, `guides/auth/password-security.mdx`, and Studio's own `ResetPasswordForm.tsx`):
- `supabase.auth.updateUser({ password })` works off the **existing session** — the SSR client from `createClient(request.headers, cookies)` suffices. No service key.
- It accepts an optional `current_password` argument: *"Requires the user to provide their existing password when setting a new one for security."* This gives an old-password check **without touching any project setting** — the recommended gate here.
- The `reauthenticate()` + `nonce` flow is only needed when `secure_password_change` is enabled **and** the session is older than 24 h. This repo's local config has it off (`supabase/config.toml:210-211`), but **`config.toml` governs `supabase start` only** — the production project's setting lives in the Supabase dashboard and is not represented in this repo. Confirm before relying on the no-nonce path.
- `updateUser({ password })` does **not** revoke other sessions. Supabase Studio calls `auth.signOut({ scope: 'others' })` explicitly afterwards; do the same if that's wanted.
- Password floor: local config allows 6 (`config.toml:175`), but the app's own floor is `z.string().min(8)` (`employees/index.ts:76`) — match the app.

**The Topbar constraint.** Verified on disk (`src/components/Topbar.astro:9-19`): the e-mail is a bare `<span>{user.email}</span>` with no class, id, or `data-*` hook, inside a `flex items-center gap-3` div next to the gold moderator pill. `Topbar` is a zero-JS `.astro` component mounted at exactly one place (`dashboard.astro:213`). The existing "action in the topbar" idiom is a native `<form method="POST">` (the Sign out button, `:25-29`). Making the e-mail a menu trigger means either the first React island in the topbar or a native `<details>`/form in the Astro spirit.

Two prior decisions constrain this specific pixel:
- S-17 locked the bar's design: *"56px tall, email plus a gold uppercase role pill on the left, `Dashboard` and `Sign out` in white on the right"* (`huge-ui-ux-improvement/plan.md:210-219`), and the labels stay **English** to match the prototype.
- `context/foundation/lessons.md:5-13` — a Topbar affordance needing the role should resolve it from `Astro.locals`, not accept it as a prop. Relevant here: `middleware.ts:19-31` already computes `locals.userRole` on every request and **nothing reads it**.

### 5. The authorization idiom any new route must copy

There is **no shared guard helper** — the ~25-line block is duplicated across `employees/index.ts`, `employees/[id].ts`, `employees/order.ts`, `restore.ts`, and `holiday-balances/index.ts` (whose route-local `resolveCaller` at `:23-32` is the closest thing to an extraction seed). Canonical order:

```ts
export const prerender = false;                       // line 1 of every route
// 1. !context.locals.user                          → 401 { error: "Unauthorized" }
// 2. createDb(DATABASE_URL) inside the handler     (never module top-level)
// 3. caller = employees row by (user_id, deleted_at IS NULL)
//      DB throw                                    → 503 "Database error"
//      no row                                      → 403 "Employee record not found"
// 4. caller.role !== "moderator"                   → 403 "Forbidden"
// 5. UUIDSchema.safeParse(context.params.id)       → 400
// 6. await request.json()                          → 400 "Invalid JSON body"
// 7. Schema.safeParse(body)                        → 400 parsed.error.issues[0]?.message
// 8. target lookup 404 → isProtectedAdmin 403 → deleted_at 409 → mutate → 200
```

Conventions worth pinning:
- Error body is always `{ error: string }`. Lookup failures → **503**, final-operation failures → **500**.
- PG codes via `extractPgErrorCode` from `@/lib/db-errors` (they live on `err.cause.code`, not `err.code` — `AGENTS.md:75-83`): `42501`→403, `23503`→404, `23505`→409, `23514`→400.
- **Business-rule messages are Polish; plumbing messages are English** (`"Unauthorized"`, `"Database error"`, `"Forbidden"`).
- `isProtectedAdmin(target)` from `src/lib/employees.ts:24` must be re-asserted on **every** new write path — RLS is bypassed on the service-role connection, so the technical admin's immutability is app-enforced only (`admin-bootstrap/plan.md:38`). Note `POST /api/holiday-balances` has **no `is_system` check today** (`:153-170` checks existence only).
- House pattern for role-varying behaviour: **one endpoint, role branch inside the handler** — not a parallel `/api/admin/...` route (`moderator-absence-management/plan.md:38`).

**Two conflicting endpoint conventions exist.** `/api/auth/*` uses `FormData` + redirect-with-`?error=` and no zod at all (`signin.ts:7`, `:13-21`); everything else uses JSON + zod + `{ error }` + status codes. A password-change endpoint under `/api/auth/` should probably follow the JSON convention so a dialog can render the error inline — but that is a deliberate break from the two files already living there, and should be stated as such.

### 6. React island conventions

- **No data-fetching hook exists.** `src/components/hooks/` holds exactly one file, `useRovingRadioGroup.ts`, and it is a keyboard hook. No SWR, no React Query, no shared fetch wrapper, no typed API client.
- Reads are server-rendered props. The only client-side reads are lazy tab data in `AbsenceStats.tsx:274` and `AbsenceDetailsSubcards.tsx:139,169`, both `useEffect` + `fetch` + AbortController.
- Writes are: inline handler → `fetch` → `if (res.ok)` → toast → **`window.location.reload()`**. This is a recorded project-wide decision (`huge-ui-ux-improvement/plan.md:105` — *"Every dialog keeps `window.location.reload()`"*), not an accident.
- Error surfacing is split: employee dialogs use inline `setError` → `<p className="text-destructive text-sm">`; the balance dialog and the sheet's row actions use `toast.error` from `sonner`. Either is established.
- Reset-on-close is done by **remounting via `key`**, never a resetting `useEffect` (`HolidayBalanceCard.tsx:83-89`, `EmployeeManagementSheet.tsx:179`).
- Role is always passed down as an explicit `currentRole: UserRole` prop from the Astro page; islands never infer it.
- Installed shadcn primitives: `button`, `dialog`, `input`, `label`, `popover`, `select`, `sheet`, `sonner`, `tooltip`. **Not installed**: `form`, `alert-dialog`, `checkbox`, `switch`, `tabs`, `card`, `badge`, `dropdown-menu`, `avatar`. Destructive confirms deliberately use a plain `Dialog` or even `window.confirm` — a `dropdown-menu` for the Topbar account affordance would be a net-new dependency.
- No `dark:` variants — `src/styles/global.css:50-59` deliberately has no dark palette.

## Code References

- `src/db/schema.ts:17-29` — `employees`, no e-mail column
- `src/db/schema.ts:68-88` — `holiday_balances`, the three day-count columns
- `src/components/Topbar.astro:14` — the plain `<span>{user.email}</span>` the request wants clickable
- `src/pages/dashboard.astro:246-253` — `HolidayBalanceCard` hard-wired to `currentEmployee.id` (the whole of feature 2's blocker)
- `src/pages/dashboard.astro:218` — `EmployeeManagementSheet` mount, moderator-gated
- `src/pages/api/holiday-balances/index.ts:105-114` — upsert schema; note the deliberate absence of `.default(0)`
- `src/pages/api/holiday-balances/index.ts:178` — the korekta gate, one line
- `src/pages/api/holiday-balances/index.ts:48-89` — `GET ?employee_id=`, already moderator-capable
- `src/pages/api/employees/[id].ts:20-28` — `EmployeeUpdateSchema`, no `email` key
- `src/pages/api/employees/index.ts:116-129` — the only `auth.admin.createUser` call site
- `src/pages/api/employees/index.ts:157-164` — the compensating-delete pattern for partial auth/DB failure
- `src/lib/supabase-admin.ts:6-16` — service-role client, `null` when unconfigured
- `src/lib/employees.ts:19-26` — `visibleEmployeesFilter()` / `isProtectedAdmin()`
- `src/middleware.ts:19-31` — `locals.userRole`, computed every request, read by nobody
- `src/components/holiday/HolidayBalanceDialog.tsx:68,209-227` — moderator-only Korekta input
- `src/components/employee/EditEmployeeDialog.tsx:17-19` — the dialog an e-mail field would extend
- `src/components/employee/AddEmployeeDialog.tsx:78-88` — a ready-made e-mail field to copy
- `src/tests/api/holiday-balances/korekta-gate.test.ts:32-44` — the route-level test harness template
- `src/tests/helpers/fixtures.ts:13-54` — `createTestEmployee` / `teardownTestEmployee`, real auth users

## Architecture Insights

1. **Authorization is app-code, everywhere, by design.** `DATABASE_URL` uses the service-role key and bypasses RLS (`AGENTS.md:62`). RLS policies exist on `holiday_balances` and `employees` but are documented as defence-in-depth, not the gate. Every new rule is a handler-code rule.
2. **Field-level gates are enforced by omission, not rejection.** The korekta gate returns 200 and silently drops the column. This is the precedent for any new per-field permission, and it exists because dialogs do full-replace saves.
3. **The e-mail is currently write-only.** It is the login credential, typed once at creation, never read back. That asymmetry is the single largest hidden cost in this change.
4. **Auth and data live on separate rails.** `AGENTS.md:30` — Drizzle owns app tables, the Supabase clients are kept *only* for auth operations. An e-mail change is an auth operation; a balance change is a Drizzle operation. A dialog that edits both in one save is writing to two systems with no transaction across them — the `createUser`-then-insert compensating-delete pattern at `employees/index.ts:157-164` is the only precedent for that class of partial failure, and it exists precisely because there is no transaction.
5. **`window.location.reload()` after every mutation closes the sheet.** A moderator editing several people loses their place after each save. Adding two more mutation entry points inside the sheet multiplies that friction, and there is no in-place state-update precedent to follow.

## Historical Context (from prior changes)

- `context/changes/employee-management/plan.md:39` — **"No ability to change an employee's email after creation"**. This change reverses that. House style for reversals (`context/archive/2026-08-07-holiday-balance-valid-until/change.md:20-24`) is that the plan must **open by restating the prior decision and saying what supersedes it**.
- `context/archive/2026-08-07-holiday-balance-valid-until/change.md:133-140` — moderator cross-employee balance editing is the *named next step*: *"the known S-17 row-7.9 blocker … **Confirmed still wanted — it should lead the next change in this area.**"*
- `context/changes/huge-ui-ux-improvement/plan.md:87-92` — deferred: *"Relocating `Korekta` / `Do dnia` into the employee modal, and merging the identity and entitlement dialogs. Coupled to the batch-balance work."* Feature 2 is exactly this deferred work. The **batch-balance endpoint still does not exist** — a per-row `GET` on dialog-open is the cheap alternative and the endpoint already supports it.
- `context/changes/huge-ui-ux-improvement/plan.md:821-853` — the korekta gate's design rationale, including *"Hiding the input is presentation; the server is what makes it a rule."*
- `context/changes/huge-ui-ux-improvement/plan.md:851-853` — the **no-dead-controls rule**: *"The `Edytuj` button stays visible to everyone — only the field inside disappears."* Applies to any new moderator-only affordance.
- `context/changes/admin-bootstrap/plan.md:38` — every employee mutation path must reject `is_system` targets. `plan.md:221` — the entire signup surface was deleted on purpose; do not reintroduce a self-service account-creation path.
- `context/foundation/roadmap.md:250` (S-11 risk) — *"service role key … musi pozostać wyłącznie po stronie API, nigdy nie wyciekać do klienta."* Directly binding on the e-mail change.
- `context/foundation/roadmap.md:283` (S-15) — *"Kartę widzą i edytują zarówno pracownicy, jak i moderatorzy"* — the balance card was deliberately **not** moderator-gated. Feature 2 widens *reach*, not *permission*.
- `context/changes/moderator-absence-management/plan.md:39` — *"No audit trail / created-by tracking."* There is no audit log anywhere in the system.

## Related Research

- `context/changes/huge-ui-ux-improvement/research.md` — §5.4 on balance edit permissions, §on Topbar/chrome layout, and the `locals.userRole` dead-code note (`:245`)
- `context/changes/employee-management/reviews/impl-review-phases-2-4.md` — F1 (orphaned auth user on partial failure), F2 (never leak `user_id` into a `client:load` prop), F4 (fragile duplicate-email string matching)
- `context/changes/crud-integrity/plan.md:441-450` — integration-test placement and cleanup conventions

## Risks and Open Questions

**Verify before planning:**

1. **Is `SUPABASE_SERVICE_KEY` actually set on the production Worker?** It is declared `optional: true` in `astro.config.mjs:38`, and the CI **deploy** job passes only `SUPABASE_URL` / `SUPABASE_KEY` (`.github/workflows/ci.yml:41-42`) — the service key is a secret for the *test* job only. `POST /api/employees` already depends on it, so it is probably set via `wrangler secret put`, but CLAUDE.md's deploy section only documents the first two. If it is missing, every new e-mail feature 503s in production.
2. **Is `secure_password_change` enabled on the production Supabase project?** `supabase/config.toml:210-211` says `false`, but that file governs `supabase start` only. If production has it on, the no-nonce password path breaks for sessions older than 24 h.

**Decisions the plan must make:**

3. **The PRD does not authorize this moderator power.** `context/foundation/prd.md:127` limits moderators to *"dodawac i usuwac pracownikow"*. Changing another user's login credential is strictly larger, and leaves **no audit trace**. The plan should either state it as a deliberate PRD extension (precedent: S-11/S-16 marked *"poza PRD (z makiety)"*) or scope in a minimal record of who changed what.
4. **Read strategy for e-mails**: one paginated `admin.listUsers()` joined on `user_id`, or per-row `getUserById` on dialog-open. The second is N round-trips but avoids widening the dashboard's server-side fetch and avoids shipping every worker's address into the island's props.
5. **Extend `EditEmployeeDialog` vs. a separate `ChangeEmailDialog`.** Extending is cheaper and matches the mock's shape, but it couples an auth-system write to a Drizzle write in one save with no transaction across them (see Architecture Insight 4). A separate dialog keeps the blast radius small at the cost of a third button per row in an already-crowded 560 px sheet.
6. **`POST /api/holiday-balances` has no `is_system` guard.** Surfacing per-employee balance editing makes a crafted `employee_id` pointing at the technical admin reachable. Worth closing in the same change.
7. **`DELETE /api/holiday-balances/[id]` has no role or owner gate at all** (`[id].ts:30-36`) — any valid caller can delete any balance row by id. Surfacing other employees' balance ids in a new UI widens that exposure. Pre-existing, but this change is what makes it reachable.
8. **Which year?** `balanceYear` is pinned server-side to the current calendar year (`dashboard.astro:37`) while the API accepts 2000–2100. A moderator editing someone else's balance may well want a year picker; if not, say so explicitly.

**Testing hazards:**

9. **The E2E account's password is a fixed `.env` value** (`E2E_USER_EMAIL` / `E2E_USER_PASSWORD`, consumed by `tests/e2e/setup/auth.setup.ts`). An E2E test that actually changes it breaks every subsequent run. Use a throwaway account or restore the password.
10. **`getByLabel("Hasło", { exact: true })`** in `auth.setup.ts:27` — a new "Hasło" label rendered on a shared page breaks the locator's uniqueness. `tests/e2e/e2e-rules.md` also notes the CI post-deploy health check asserts the same strings, so copy changes must move both files in one commit.
11. **There is no moderator fixture and no employee-role E2E account.** Route tests get a moderator by creating a second employee and `UPDATE`-ing the role (`korekta-gate.test.ts:66-67`); an E2E test proving a non-moderator *cannot* edit an e-mail is not currently seedable.
12. **`src/tests/api/employees/` does not exist** — the employee endpoints have zero route-level coverage today. `test-plan.md:49` Risk #4 (*"Regular employee reaches moderator-only employee management endpoints"*) is still `not started`; this change would be its first real exercise.
13. **Drizzle does not work in `wrangler dev`** (`AGENTS.md:87`) — the balance and e-mail writes are not locally verifiable. The password flow *is*, since it only touches the Supabase HTTPS auth API. Manual verification goes against the production deployment.

**Stale docs found during the sweep** (flagged, not fixed):

14. `AGENTS.md:9` claims *"There is no Playwright/E2E setup"* — but `playwright.config.ts`, `tests/e2e/`, and three npm scripts exist. An agent obeying AGENTS.md literally will skip E2E.
15. `context/foundation/test-plan.md:152` forbids importing handlers in unit tests — superseded by the `astro:env/server` stub at `vitest.config.ts:32`, which `korekta-gate.test.ts:8` already relies on. `test-plan.md:98,118` ("no E2E planned") is stale the same way; its freshness ledger is stamped 2026-06-03.
16. `context/foundation/roadmap.md` has **no S-17 row** despite every S-17 artifact referencing it, and 15 change folders sit unarchived at `implemented`/`impl_reviewed`.
17. Balance-edit permissions have drifted across three documents without one winning — `roadmap.md:283` and `huge-ui-ux-improvement/research.md:222` both still assert "anyone can edit anyone's balance, no gate", which the korekta gate has since narrowed. **The plan should restate the current truth before changing it.**
