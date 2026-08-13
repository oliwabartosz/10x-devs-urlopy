# Moderator Edits Worker Data; Workers Change Own Password — Implementation Plan

## Overview

Three independent capabilities, plus a security floor beneath them:

1. **Moderator edits a worker's holiday balance** (Bieżące / Zaległe / Korekta) from the employee sheet — today possible only for oneself.
2. **Moderator changes a worker's login e-mail** — today impossible, and the address is not even *readable* anywhere in the product.
3. **Any worker changes their own password** by clicking their e-mail in the top bar — today no such route, no such affordance.

Before any of that, two pre-existing authorization gaps on the holiday-balance routes get closed, because feature 1 is precisely what makes them reachable from the UI.

### Two prior decisions this plan supersedes

House style requires a reversal to open by restating what it overrides.

- **`context/changes/employee-management/plan.md:39` — "No ability to change an employee's email after creation."** Superseded. Feature 2 grants moderators exactly that ability, immediately and without a confirmation mail to the worker. The rationale for the original decision (creation-time-only identity, no read path to maintain) no longer holds now that moderators are the sole account administrators and there is no self-service signup surface at all (`admin-bootstrap/plan.md:221`).
- **`context/archive/2026-06-22-urlop-balance/plan.md:211` (S-15) — any valid caller may delete any balance row by id.** Partially superseded in Phase 1. Deletion becomes owner-or-moderator. S-15's *other* ruling — that both roles may write `current_entitlement_days` and `carryover_days` for anyone — is **untouched**; only the delete verb narrows.

### A PRD extension, stated deliberately

`context/foundation/prd.md:127` limits moderators to *"dodawac i usuwac pracownikow"*. Changing another user's login credential is strictly larger than that. This plan proceeds as a **deliberate PRD extension**, following the S-11/S-16 precedent for capabilities marked *"poza PRD (z makiety)"*, and **with no audit trail** — a decision taken with eyes open. There is no audit log anywhere in this system (`moderator-absence-management/plan.md:39`), and introducing the first one for this single operation was weighed and rejected as disproportionate. The consequence is explicit: **a moderator can change any worker's login e-mail leaving no record of who did it, when, or from what.** If that ever becomes unacceptable, it is a migration to retrofit.

### Vocabulary correction

The change request says "number of the absence days: bieżące, zaległe, korekta". These are **holiday-balance** fields on `holiday_balances`, not absence-day counts. `absences` is a different table. The fourth visible figure ("Wykorzystane") is computed and never stored (`src/lib/services/holiday-balance.ts:15-59`). Implement against `holiday_balances`.

### Current permission truth, before this plan changes it

Three documents disagree about balance-edit permissions, and none has won. `roadmap.md:283` and `huge-ui-ux-improvement/research.md:222` both still assert "anyone can edit anyone's balance, no gate". That is **stale**. Verified on disk at `src/pages/api/holiday-balances/index.ts:178`, the truth today is:

| Operation | Employee | Moderator |
|---|---|---|
| `GET` any employee's balance | active employees only | any, incl. soft-deleted |
| `POST` `current_entitlement_days` / `carryover_days` | any active employee | any employee |
| `POST` `used_adjustment_days` (Korekta) | **silently dropped**, 200 returned | written |
| `DELETE` any balance row by id | **yes, any row** | yes, any row |

Phase 1 changes only the last line.

## Current State Analysis

**Feature 1 (balances) is a pure UI gap — zero API work, zero migration.**
`POST /api/holiday-balances` already takes `employee_id` in the body, already lets a moderator target any employee including soft-deleted ones (`index.ts:153-156`), and already field-gates Korekta to moderators (`index.ts:178`). `GET /api/holiday-balances?employee_id=&year=` works the same way (`index.ts:48-89`). The only blocker is that `HolidayBalanceCard` is mounted exactly once, hard-wired to `currentEmployee.id` (`dashboard.astro:246-253`), and `EmployeeManagementSheet` (`dashboard.astro:218`) receives no balance data at all. This is the named next step from the last change in this area (`context/archive/2026-08-07-holiday-balance-valid-until/change.md:133-140`) and the work deferred at `huge-ui-ux-improvement/plan.md:87-92`.

**Feature 2 (e-mail) is larger than it looks, because there is no read path.**
`employees` has no `email` column (`src/db/schema.ts:17-29`); the address lives only in `auth.users`, linked by `user_id`. A repo-wide search for `listUsers` / `getUserById` returns zero hits — the only `auth.admin.*` calls anywhere are `createUser` and `deleteUser` in `src/pages/api/employees/index.ts`. `GET /api/employees` selects no e-mail (`index.ts:35-43`). The only address rendered anywhere is the session owner's own, at `Topbar.astro:14`. So a **read** path must be built before an **edit** path. On the write side, `EmployeeUpdateSchema` (`[id].ts:20-28`) is `first_name`/`last_name`/`role` only, and the handler writes `parsed.data` straight into `db.update(employees)` at `[id].ts:116` — an added `email` key would have to be split back out, because it belongs to Supabase Auth, not the table.

**Feature 3 (password) is net-new but small.** Zero prior art: no `updateUser`, no `resetPasswordForEmail`, no `reauthenticate` anywhere in `src/` or `tests/`. `src/pages/api/auth/` holds only `signin.ts` and `signout.ts` (plus inert `.scaffold` files). `supabase.auth.updateUser({ password })` works off the existing SSR cookie session — no service key needed. The real constraint is presentational: `Topbar.astro:14` is a bare `<span>{user.email}</span>` with no class, id, or hook, inside a zero-JS Astro component whose layout S-17 locked (`huge-ui-ux-improvement/plan.md:210-219`).

**Test coverage baseline.** `src/tests/api/employees/` **does not exist** — the employee endpoints have zero route-level coverage. `src/tests/api/holiday-balances/` has three suites (`korekta-gate`, `delete`, `used-computation`) that provide the harness template. `test-plan.md:49` Risk #4 (*"Regular employee reaches moderator-only employee management endpoints"*) is still `not started`; Phase 3 is its first real exercise.

## Desired End State

- A moderator opens **Pracownicy → Edytuj** on any worker and sees, in one dialog, that person's Imię / Nazwisko / Rola **and** their Bieżące / Zaległe / Korekta for the current year. Saving writes both; if one half fails, the dialog says exactly which half landed and keeps the other's values for a retry.
- The same row offers a separate **Zmień e-mail** action showing the worker's current login address and accepting a new one. Saving changes the Auth identity immediately, with no confirmation mail. The worker's existing session keeps working.
- Any signed-in worker clicks **their own e-mail in the top bar** and gets a dialog asking for current password + new password (twice). On success, every *other* session of theirs is signed out and the current one survives.
- A regular employee can no longer delete another person's balance row, and no API path can mutate the technical admin's balance.

Verification: the automated and manual criteria listed per phase below.

### Key Discoveries

- `src/pages/api/holiday-balances/index.ts:178` — the entire Korekta gate is one line; the column is spread-omitted from both `.values()` (`:189`) and `.onConflictDoUpdate().set()` (`:197`). Field-level gates in this codebase are enforced **by omission, not rejection**, because dialogs do full-replace saves. Locked by 8 cases in `korekta-gate.test.ts`.
- `src/pages/api/holiday-balances/index.ts:110-113` — `used_adjustment_days` deliberately has **no `.default(0)`**; two tests exist purely to fail if it comes back.
- `src/pages/api/holiday-balances/[id].ts:30-36` — `DELETE` resolves the caller and then deletes by id with **no role and no owner check**.
- `src/pages/api/holiday-balances/index.ts:153-170` — `POST` checks only that the target employee *exists*; **no `is_system` guard**, unlike every other mutation path.
- `src/pages/api/employees/[id]/restore.ts` exists — a sibling `[id]/email.ts` follows an established sub-resource pattern.
- `src/tests/helpers/astro-env.ts` exports `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY` — **not `SUPABASE_SERVICE_KEY`**. Any route test importing a handler that calls `createAdminClient()` will get `undefined`, hence a `null` client, hence a 503 that looks like a real defect. Must be extended in Phase 3.
- `src/lib/supabase-admin.ts:6-16` — `createAdminClient()` returns `null` when unconfigured; the established response is 503 `"Admin client is not configured"` (`employees/index.ts:117-119`).
- `src/middleware.ts:19-31` — `locals.userRole` is computed on every request and **read by nobody**. `Topbar` receives `role` as a prop instead (`dashboard.astro:213`), which `context/foundation/lessons.md` explicitly names as the wrong pattern.
- `src/components/holiday/HolidayBalanceDialog.tsx:53-55, 111-136` — pre-fills all three fields and sends all three on save (full replace), guarding the stored adjustment. `HolidayBalanceCard.tsx:88-89` resets state by remounting on a `key`, never by a resetting effect (the lint config rejects the latter).
- `src/pages/api/employees/index.ts:137-141` — duplicate-address collisions from Supabase surface as `authError.status === 422`, mapped to 409 + `"Konto z tym adresem email już istnieje."`

## What We're NOT Doing

- **No audit table, no audit log, no `changed_by` column.** Stated above as a deliberate, eyes-open decision.
- **No year picker.** Balance edits are pinned to the current calendar year, matching `dashboard.astro:32-36`'s rule that past years are stale data, not history. A moderator needing to fix a historic year uses direct DB access.
- **No e-mail addresses in the sheet's row list**, and no `listUsers()` anywhere. Addresses are fetched one at a time, on dialog open, and never shipped into a `client:load` prop (`employee-management/reviews/impl-review-phases-2-4.md` F2).
- **No batch-balance endpoint.** Still does not exist; the per-row `GET` is the cheap alternative and the endpoint already supports it.
- **No confirmation e-mail to the worker on an address change**, and no notification. `GOTRUE_MAILER_NOTIFICATIONS_EMAIL_CHANGED_ENABLED` defaults to `false`; leave it.
- **No session revocation on e-mail change.** The worker's cookie session keeps working; the JWT's `email` claim goes stale until refresh. (Password change *does* revoke others — different operation, different answer.)
- **No self-service account creation, no password *reset* by e-mail link.** The signup surface was deleted on purpose (`admin-bootstrap/plan.md:221`); do not reintroduce it. This is password *change* by an already-authenticated user only.
- ~~**No moderator-initiated password reset for a worker.** Not requested.~~ **Reversed mid-implementation (2026-08-13), after Phase 2 landed.** It was subsequently requested — *"Moderator could also change the password if user forgets"* — and is now Phase 3 item 6. The reversal is cheap to build (the same service-role client, the same `[id]` sub-resource, the same guard order as the e-mail write) but it is a materially larger authority grant than the e-mail change, so it is recorded here rather than folded in silently. The consequence, stated with eyes open and compounding the no-audit-trail decision above: **a moderator can set any worker's password, thereby gaining full access to that worker's account, leaving no record of who did it or when.** The worker's remedy is Phase 4's self-service change — which is an argument for keeping Phase 4 in scope, not dropping it now that resets exist. The alternative of a server-generated one-time password (moderator relays it, never chooses it) was offered and declined.
- **No `dropdown-menu`, no `alert-dialog`, no new shadcn primitives.** Work within `button`, `dialog`, `input`, `label`, `popover`, `select`, `sheet`, `sonner`, `tooltip`.
- **No change to `window.location.reload()` after mutations.** It is a recorded project-wide decision (`huge-ui-ux-improvement/plan.md:105`). Its cost is acknowledged under Critical Implementation Details.
- **No shared auth-guard helper extraction.** The ~25-line block is duplicated across five routes; refactoring it is a separate change.
- **No fix for the stale docs** found during research (`AGENTS.md:9`, `test-plan.md:98/118/152`, the missing S-17 roadmap row). Flagged, not in scope.

## Implementation Approach

Four phases, ordered so the security floor lands before the UI that makes the gaps reachable, and so the zero-API-cost feature ships before the expensive one.

Each phase is independently shippable. Phases 3 and 4 do not depend on 1 or 2.

The e-mail write is deliberately kept **out** of the merged dialog. Balance and identity are both Drizzle writes and are merged; the e-mail is a Supabase Auth write and stays in its own dialog, so a single Zapisz never spans two storage rails (Architecture Insight 4 in the research). The merged dialog still spans two *requests* — handled explicitly in Phase 2.

## Critical Implementation Details

**Sequencing of the merged save (Phase 2).** Identity (`PATCH /api/employees/:id`) goes first, balance (`POST /api/holiday-balances`) second. This order is deliberate: `PATCH` is the one that can fail on a *business rule* the moderator can act on (last-moderator demotion → 409, deactivated target → 409), so failing it first leaves nothing to unwind. If `PATCH` fails, the balance request is never sent. If `POST` fails after `PATCH` succeeded, both facts are reported and neither is rolled back — there is no transaction across the two and a compensating `PATCH` can itself fail, producing a worse state with no vocabulary to describe it.

**`window.location.reload()` closes the sheet.** Every mutation in this codebase ends in a full reload, which unmounts the sheet and returns the moderator to the dashboard. Phase 2 adds a second mutation path inside the sheet and Phase 3 a third, multiplying that friction for a moderator editing several people in a row. This is accepted, not fixed — there is no in-place state-update precedent to follow and inventing one here is out of scope. Do not silently "improve" it.

**Reset-on-close is done by remounting via `key`.** `HolidayBalanceCard.tsx:83-89` and `EmployeeManagementSheet.tsx:179` both do this. A resetting `useEffect` is a cascading-render anti-pattern the lint config rejects. Every new dialog in this plan must follow the same idiom.

**`secure_password_change` on production is unknown.** `supabase/config.toml:211` says `false`, but that file governs `supabase start` only — the production project's setting lives in the Supabase dashboard and is not represented in this repo. Rather than gate the plan on checking it, Phase 4 handles the failure: if Supabase returns a reauthentication-required error, the route maps it to a clear Polish message instead of a generic 500. This makes the feature correct under either setting.

**Polish vs English error copy.** Business-rule messages are Polish; plumbing messages are English (`"Unauthorized"`, `"Database error"`, `"Forbidden"`). Lookup failures → 503, final-operation failures → 500. PG codes come from `extractPgErrorCode` and live on `err.cause.code`, not `err.code` (`AGENTS.md:75-83`).

**`isProtectedAdmin(target)` on every new write path.** RLS is bypassed on the service-role connection, so the technical admin's immutability is app-enforced only (`admin-bootstrap/plan.md:38`).

---

## Phase 1: Close the two authorization gaps on holiday-balance routes

### Overview

Add the missing `is_system` guard to the balance upsert, and narrow balance deletion from "any caller, any row" to "owner or moderator". Both are pre-existing; Phase 2's UI is what makes them reachable, so they land first. No UI changes.

### Changes Required:

#### 1. `is_system` guard on the balance upsert

**File**: `src/pages/api/holiday-balances/index.ts`

**Intent**: The `POST` handler's target lookup (`:153-170`) confirms the employee exists but never checks whether it is the protected technical admin — the only mutation path in the codebase that omits this. Close it so a crafted `employee_id` cannot write the admin's balance once the new UI surfaces other people's ids.

**Contract**: Extend the target `select` to include `is_system`, and reject via `isProtectedAdmin(targetRow)` before the upsert. Response: 403 `{ error: "Nie można modyfikować tego konta." }`, matching `employees/[id].ts:93-95` verbatim. Import `isProtectedAdmin` from `@/lib/employees`. Place the check after the not-found 404 and before the Korekta gate.

#### 2. Owner-or-moderator gate on balance deletion

**File**: `src/pages/api/holiday-balances/[id].ts`

**Intent**: Today any authenticated employee can delete any balance row by id (`:30-36`, explicitly ungated per S-15). Narrow it: a caller may delete their own balance; a moderator may delete anyone's; nobody may delete the technical admin's. Replace the existing S-15 comment block with one recording this supersession and its reason.

**Contract**: Extend the caller lookup to `{ id, role }`. Before deleting, read the target row's `employee_id` (join or a second select against `holiday_balances`), then the owning employee's `is_system`. Rules, in order: row not found → 404 `{ error: "Not found" }` (unchanged, and returned *before* any ownership check so the endpoint does not leak which ids exist); target employee `is_system` → 403 `{ error: "Nie można modyfikować tego konta." }`; caller is not the owner and not a moderator → 403 `{ error: "Forbidden" }`; otherwise delete and return 204 as today.

#### 3. Route tests for both gates

**File**: `src/tests/api/holiday-balances/delete.test.ts` (extend) and `src/tests/api/holiday-balances/korekta-gate.test.ts` (extend, or a new `is-system-guard.test.ts` if the existing file's fixtures do not fit)

**Intent**: Lock both new rules so a future refactor cannot quietly reopen them. The `is_system` case needs a fixture that does not exist yet — `createTestEmployee` always inserts a non-system row.

**Contract**: Cases to cover — employee deletes own balance → 204; employee deletes another's → 403; moderator deletes another's → 204; delete of a non-existent id → 404 (asserted for a non-owner caller too, proving 404 precedes the ownership check); `POST` targeting an `is_system` employee → 403 with the Polish message; `POST` targeting an ordinary employee → still 200 (regression guard). For the `is_system` fixture, `UPDATE employees SET is_system = true` on a throwaway test employee inside the test and reset it in cleanup, mirroring how `korekta-gate.test.ts:66-67` manufactures a moderator.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checking passes: `npx astro check`
- Full unit + route suite passes: `npm run test:run`
- The new delete-gate cases pass (employee cannot delete another's balance; moderator can)
- The new `is_system` cases pass on both `POST` and `DELETE`
- All 8 pre-existing `korekta-gate.test.ts` cases still pass — the field-level gate is untouched
- Build succeeds: `npm run build`

#### Manual Verification:

- Signed in as a regular employee against the deployed app, the own-balance Usuń button in the balance dialog still works
- No visible behaviour change anywhere for a moderator

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Moderator edits a worker's holiday balance

### Overview

Turn `EditEmployeeDialog` into a merged identity + entitlement dialog. Opening it fetches the target's balance for the current year; saving writes identity then balance, reporting precisely which half landed if the second fails. No API work — the endpoints already support everything needed.

### Changes Required:

#### 1. Merged edit dialog

**File**: `src/components/employee/EditEmployeeDialog.tsx`

**Intent**: Add a balance section (Bieżące / Zaległe / Korekta) below the existing Imię / Nazwisko / Rola fields, fetched on open. This is the identity+entitlement merge deferred at `huge-ui-ux-improvement/plan.md:87-92`.

**Contract**: New props `year: number` and `currentRole: UserRole`. On mount, `GET /api/holiday-balances?employee_id={employee.id}&year={year}` with an `AbortController`, following the `AbsenceDetailsSubcards.tsx:139,169` idiom — this is the first async read in `src/components/employee/`, which today has no loading state. Three states to render: loading (inputs disabled or skeletoned, Zapisz disabled), loaded, and fetch-failed. **On fetch failure the balance section is not rendered at all and identity editing stays fully usable** — a balance the dialog could not read must never be written, since the save is a full replace and would clobber the stored values with defaults. Field validation copies `HolidayBalanceDialog.tsx:71-76`: non-negative integers, entitlement and carryover required. The Korekta input is moderator-only (`currentRole === "moderator"`), hidden but with its value still submitted, exactly as `HolidayBalanceDialog.tsx:65-68` documents. Reuse `formatDayCount` from `@/lib/hours` for any computed display. Reset-on-close stays a `key` remount at the call site.

#### 2. Sequential save with partial-failure reporting

**File**: `src/components/employee/EditEmployeeDialog.tsx`

**Intent**: One Zapisz fires two requests against two tables with no transaction between them. Make the failure mode legible rather than silent.

**Contract**: `PATCH /api/employees/{id}` first with `{ first_name, last_name, role }`; on non-OK, surface the server's `error` inline via the existing `setError` path and **do not send the balance request**. On OK, `POST /api/holiday-balances` with `{ employee_id, year, current_entitlement_days, carryover_days, used_adjustment_days }` (full replace, all three, per the dialog's existing contract). On the second failing, keep the dialog open and set an inline error naming both outcomes — identity saved, balance not — and preserve the entered balance values for retry. Only when both succeed: `toast.success`, close, `window.location.reload()`.

The two-outcome message is user-facing Polish and must state what to do next, e.g. *"Zapisano dane pracownika, ale nie udało się zapisać wymiaru urlopu: {błąd}. Popraw wartości i zapisz ponownie."* Skipping the balance request when nothing in that section changed is explicitly **not** done — the full-replace semantics exist to protect Korekta.

#### 3. Pass the year and role into the dialog

**File**: `src/components/employee/EmployeeManagementSheet.tsx`, `src/pages/dashboard.astro`

**Intent**: The sheet has neither the balance year nor the caller's role today. Thread both from the page, where `balanceYear` already exists (`dashboard.astro:37`).

**Contract**: `EmployeeManagementSheetProps` gains `balanceYear: number`; `currentEmployee.role` already present on the existing prop supplies `currentRole`. Pass both through to `EditEmployeeDialog`. At the mount (`dashboard.astro:218`), add `balanceYear={balanceYear}`. Do **not** pass `user_id` or any auth data into the island (`impl-review-phases-2-4.md` F2).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checking passes: `npx astro check`
- Existing suite still green: `npm run test:run`
- Build succeeds: `npm run build`

#### Manual Verification:

- Against the deployed app as a moderator: Pracownicy → Edytuj on another worker shows that worker's actual Bieżące / Zaległe / Korekta, not the moderator's own
- Editing only the name saves and the balance is unchanged in the DB
- Editing only the balance saves and the name is unchanged
- Editing both saves both
- Korekta entered by the moderator persists (it is not silently dropped)
- Opening the dialog for a worker with no balance record shows zeros and saving creates the row
- A deliberately invalid save (e.g. demoting the last moderator) shows the 409 message and leaves the balance untouched
- The loading state is visible and does not flash a half-empty form
- Editing one's *own* row through the sheet still works and agrees with the dashboard card

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 3: Moderator reads and changes a worker's login e-mail and password

### Overview

Build the read path that does not exist, then the write. New sub-resource route `src/pages/api/employees/[id]/email.ts` with `GET` and `PATCH`, both service-role. A separate `ChangeEmailDialog` triggered from the sheet row. First route-level tests for the employee endpoint family.

Item 6 (password reset) was **added mid-implementation** — see the reversed entry under *What We're NOT Doing*. It is a second sub-resource, `[id]/password.ts`, sharing item 2's guard order verbatim.

### Prerequisites

**Confirm `SUPABASE_SERVICE_KEY` is set on the production Worker before starting.** It is declared `optional: true` (`astro.config.mjs:38`) and the CI deploy job passes only Cloudflare credentials — Worker secrets are set out-of-band. `POST /api/employees` already depends on it, so it is probably present, but if it is missing every e-mail operation returns 503 in production. Verify with `npx wrangler secret list --name urlopy` (requires an interactive `wrangler login` or `CLOUDFLARE_API_TOKEN`); set with `npx wrangler secret put SUPABASE_SERVICE_KEY` if absent. **Also add it to CLAUDE.md's "Set production secrets" block**, which documents only `SUPABASE_URL` and `SUPABASE_KEY` today.

### Changes Required:

#### 1. Test-harness stub gains the service key

**File**: `src/tests/helpers/astro-env.ts`

**Intent**: The stub exports `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY` but not `SUPABASE_SERVICE_KEY`. Any route test importing a handler that calls `createAdminClient()` gets `undefined` → `null` client → a 503 that reads as a real defect. This must land before the route tests below.

**Contract**: `export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? ""`, mirroring the two existing lines. `.env` and CI's test job already provide the variable (`ci.yml:36`).

#### 2. E-mail read + write route

**File**: `src/pages/api/employees/[id]/email.ts` (new)

**Intent**: Give moderators the ability to see and change a worker's Auth login address. A sibling of the existing `[id]/restore.ts`, deliberately separate from `[id].ts` so the Auth write never enters that handler's `parsed.data → db.update(employees)` path (`[id].ts:116`).

**Contract**: `export const prerender = false` on line 1. Both verbs follow the canonical guard order: no `locals.user` → 401 `"Unauthorized"`; caller lookup by `(user_id, deleted_at IS NULL)`, DB throw → 503 `"Database error"`, no row → 403 `"Employee record not found"`; `caller.role !== "moderator"` → 403 `"Forbidden"`; `z.uuid()` on `params.id` → 400 `"Invalid employee ID"`; target lookup by id (service role sees soft-deleted rows) → 404 `"Employee not found"`; `isProtectedAdmin(target)` → 403 `"Nie można modyfikować tego konta."`. `createAdminClient()` returning `null` → 503 `"Admin client is not configured"`, matching `employees/index.ts:117-119`.

`GET` — resolve `employees.user_id` for the target, call `adminClient.auth.admin.getUserById(user_id)`, return `{ email: string }` at 200. An auth-lookup failure → 503 `"Database error"`. Return **only** the address; never the auth user object, and never `user_id`.

`PATCH` — body `{ email: z.email() }`; malformed JSON → 400 `"Invalid JSON body"`; schema failure → 400 with `parsed.error.issues[0]?.message`. Reject a `deleted_at !== null` target → 409 `"Cannot update a deactivated employee"`, matching `[id].ts:96-98`. Call `adminClient.auth.admin.updateUserById(user_id, { email, email_confirm: true })`. **`email_confirm: true` is load-bearing** — omitting it leaves `email_verified: false`, which with confirmations enabled locks the worker out; this mirrors `createUser({ email_confirm: true })` at `employees/index.ts:128`. Map `authError.status === 422` → 409 `"Konto z tym adresem email już istnieje."`, reusing the exact mapping and copy at `employees/index.ts:137-140`. Any other auth error → 500 `"Failed to update auth user"`. Success → 200 `{ email }`. Wrap failures in `Sentry.captureException` with `tags: { route: "PATCH /api/employees/:id/email" }`.

Note the semantics this relies on: `admin.updateUserById` writes `users.email` directly and does **not** enter the `email_change` double-confirm flow that self-service `updateUser({ email })` uses — which is exactly why the admin API is the right tool for the chosen immediate, no-confirmation behaviour. No session revocation occurs; the worker's cookie session keeps working with a stale `email` JWT claim until refresh.

#### 3. Change-e-mail dialog

**File**: `src/components/employee/ChangeEmailDialog.tsx` (new)

**Intent**: A dedicated dialog so the Auth write stays isolated from the Drizzle writes in the merged edit dialog.

**Contract**: Props `{ open, onOpenChange, employee: Employee }`. On mount, `GET /api/employees/{id}/email` with an `AbortController`; show a loading state, then render the current address as read-only context above an input pre-filled with it. Fetch failure → inline error, save disabled. Save issues the `PATCH`, then on OK: `toast.success`, close, `window.location.reload()`. On non-OK, inline `setError` from the server's `error` field, following `EditEmployeeDialog.tsx:36-40`. Client-side validation is a basic non-empty/`type="email"` check — the server's `z.email()` is the real gate. Labels in Polish; nothing in the top-level app copy changes, so the E2E signin locators are unaffected.

#### 4. Sheet row action

**File**: `src/components/employee/EmployeeManagementSheet.tsx`

**Intent**: Add the trigger. The active-employee row currently carries Edytuj and Dezaktywuj in a 560 px sheet; this is a third action.

**Contract**: New `emailTarget` state mirroring `editTarget`/`deleteTarget` (`:69-70`), a `ghost` Button labelled **"E-mail"** (short, to protect the row layout), and the dialog rendered at the bottom with a `key={emailTarget.id}` remount like `EditEmployeeDialog` at `:177-186`. Show it on active rows only — deactivated rows keep Przywróć alone, consistent with the `PATCH` route rejecting deactivated targets. The whole sheet is already moderator-gated at `dashboard.astro:217`, so no per-button role check is needed; the no-dead-controls rule (`huge-ui-ux-improvement/plan.md:851-853`) is satisfied because every viewer of this sheet is a moderator.

#### 5. Route tests

**File**: `src/tests/api/employees/email.test.ts` (new — creates the directory)

**Intent**: First route-level coverage for the employee endpoint family, and the first real exercise of `test-plan.md:49` Risk #4. Use `korekta-gate.test.ts:32-44` as the harness template — direct handler import, hand-built `APIContext`, `describe.skipIf(!process.env.DATABASE_URL_DIRECT)`.

**Contract**: Cases — unauthenticated → 401; regular employee caller → 403 on both verbs (**this is Risk #4**); moderator `GET` returns the target's real address; moderator `PATCH` changes it, verified by reading it back through `GET`; `PATCH` with a malformed address → 400; `PATCH` to an address already in use → 409 with the Polish message; `PATCH` on an `is_system` target → 403; `PATCH` on a soft-deleted target → 409; `GET`/`PATCH` on a non-existent uuid → 404; a non-uuid id → 400. Moderator fixtures follow `korekta-gate.test.ts:66-67` (`UPDATE employees SET role = 'moderator'`). Every created auth user must go through `teardownTestEmployee` — these tests mutate real Supabase Auth records.

#### 6. Password-reset route, dialog and sheet action

**Files**: `src/pages/api/employees/[id]/password.ts` (new), `src/components/employee/ResetPasswordDialog.tsx` (new), `src/components/employee/EmployeeManagementSheet.tsx`, `src/tests/api/employees/password.test.ts` (new)

**Intent**: Let a moderator set a worker's password when that worker has forgotten it. Added mid-implementation; the reversal it depends on is recorded under *What We're NOT Doing*.

**Contract**: `PATCH` only, on a second sub-resource beside `email.ts` rather than a verb on it — the two are independent operations and a moderator resetting a password must not have to restate an address. Guard order is item 2's, verbatim and in the same sequence: 401 → caller lookup (503 / 403) → `caller.role !== "moderator"` → 403 `"Forbidden"` → `z.uuid()` on `params.id` → 400 → target lookup → 404 → `isProtectedAdmin` → 403 `"Nie można modyfikować tego konta."` → `deleted_at !== null` → 409 `"Cannot update a deactivated employee"` → `createAdminClient()` null → 503.

Body `{ password: z.string().min(8) }`, the same floor as `EmployeeCreateSchema` (`employees/index.ts:76`) and as Phase 4's self-service route — **not** the 6 in `supabase/config.toml:175`. Malformed JSON → 400 `"Invalid JSON body"`; schema failure → 400 with `parsed.error.issues[0]?.message`. Call `adminClient.auth.admin.updateUserById(user_id, { password })`. Any auth error → 500 `"Nie udało się zmienić hasła."`; success → 200 `{ success: true }`. **Never echo the password back.** `Sentry.captureException` with `tags: { route: "PATCH /api/employees/:id/password" }` — and no password in the Sentry payload.

**No session revocation.** Phase 4's self-service change signs out the user's *other* sessions because the actor is the account owner. Here the actor is not; revoking would sign out the worker mid-work with no explanation, and the forgotten-password case means they have no live session to evict anyway. Stated so it does not read as an oversight.

The dialog takes `{ open, onOpenChange, employee }`, holds two `type="password"` inputs (**"Nowe hasło"**, **"Powtórz nowe hasło"** — never a bare `"Hasło"`, per the locator hazard in Phase 4 item 2), validates non-empty + matching + ≥ 8 client-side, and on success shows a toast telling the moderator to pass the password on. **No `window.location.reload()`** — nothing rendered on the page depends on it. Sheet action: a `ghost` Button labelled **"Hasło"** on active rows only, with `emailTarget`-style state and a `key` remount, making three actions plus Edytuj on an active row — re-check the 560 px layout.

Tests mirror `email.test.ts`: unauthenticated → 401; regular employee → 403 (Risk #4 again); moderator sets a password → 200 and the worker can sign in with it (assert by calling `signInWithPassword` through a fresh anon client); too-short password → 400; `is_system` target → 403; soft-deleted target → 409; non-existent uuid → 404; non-uuid → 400.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checking passes: `npx astro check`
- New `src/tests/api/employees/email.test.ts` passes in full: `npm run test:run`
- New `src/tests/api/employees/password.test.ts` passes in full, including a real sign-in with the reset password
- The regular-employee-gets-403 case passes on both verbs (test-plan Risk #4)
- Pre-existing suites still green, including all holiday-balance route tests
- Build succeeds: `npm run build`
- No test leaves an orphaned auth user: a second consecutive `npm run test:run` is green (a leaked address would 409 the duplicate case)

#### Manual Verification:

- `SUPABASE_SERVICE_KEY` confirmed present on the production Worker
- Against the deployed app as a moderator: the E-mail dialog shows the worker's actual current address
- Changing it succeeds; the worker can sign in with the new address and cannot with the old one
- The worker's *existing* browser session keeps working after the change (no forced logout)
- Attempting an address already belonging to another account shows the Polish duplicate message, and the original address is unchanged
- The 560 px sheet row still lays out correctly with four actions (Edytuj / E-mail / Hasło / Dezaktywuj) at the narrowest supported width
- A regular employee (no moderator role) sees no sheet at all, and a direct `PATCH` from the browser console returns 403 on both sub-resources
- The Hasło dialog sets a worker's password; that worker signs in with the new one and not the old
- A password shorter than 8 characters is refused, and mismatched repeats are caught client-side
- Resetting a worker's password does not sign that worker out of a live session

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Worker changes their own password from the top bar

### Overview

New `POST /api/auth/password` gated on the current password, revoking other sessions on success. The Topbar e-mail becomes a button that opens a small React island holding the dialog — the Astro component itself stays zero-JS and its S-17 layout unchanged.

### Changes Required:

#### 1. Password-change route

**File**: `src/pages/api/auth/password.ts` (new)

**Intent**: Let an authenticated user change their own password. Works off the existing SSR cookie session — no service key involved.

**Contract**: `export const prerender = false`. **This route uses JSON + zod + `{ error }` + status codes, deliberately breaking the FormData-plus-redirect convention of its two neighbours** (`signin.ts:7,13-21`, `signout.ts`). Those redirect because they are full page navigations; this one is called from a dialog that must render the error inline. State the break in a file comment so it does not read as an accident.

No `locals.user` → 401 `"Unauthorized"`. Body `{ current_password: z.string().min(1), new_password: z.string().min(8) }` — the floor is 8 to match the app's own `EmployeeCreateSchema` (`employees/index.ts:76`), **not** the 6 in `supabase/config.toml:175`. Malformed JSON → 400 `"Invalid JSON body"`; schema failure → 400 with the zod message. Reject `new_password === current_password` → 400 `"Nowe hasło musi różnić się od obecnego."`

`createClient(request.headers, cookies)` from `@/lib/supabase`; `null` → 503 `"Supabase is not configured"`. Call `supabase.auth.updateUser({ password: new_password, current_password })` — the optional `current_password` argument gives an old-password check without touching any project setting.

Error mapping: a wrong current password → 400 `"Obecne hasło jest nieprawidłowe."` (Supabase surfaces this as a 400-family auth error; match on the error's status/code rather than its English message string, per `impl-review-phases-2-4.md` F4's warning about fragile string matching). A **reauthentication-required** error — which is what production returns if `secure_password_change` is enabled there and the session is over 24 h old — maps to 400 `"Ze względów bezpieczeństwa zaloguj się ponownie, zanim zmienisz hasło."` This is the graceful handling of the unverifiable production setting; without it that case would surface as an opaque 500. Anything else → 500 `"Nie udało się zmienić hasła."`, with `Sentry.captureException`.

On success, call `supabase.auth.signOut({ scope: "others" })` — what Supabase Studio itself does — so the change actually evicts other sessions while the caller's own survives. A failure of *this* call must not turn a successful password change into an error response: log it to Sentry at `warning` and still return 200, mirroring the compensating-delete idiom at `employees/index.ts:157-164`. Return 200 `{ success: true }`.

#### 2. Password dialog

**File**: `src/components/account/ChangePasswordDialog.tsx` (new)

**Intent**: The form itself. Kept out of `src/components/employee/` — this is a self-service account action, not employee management.

**Contract**: Props `{ open, onOpenChange }`. Three `type="password"` inputs: obecne hasło, nowe hasło, powtórz nowe hasło. Client-side: all three non-empty, the two new ones matching, new one ≥ 8 characters, new ≠ current — Zapisz disabled otherwise, with the mismatch surfaced inline rather than only by a disabled button. Submit `POST /api/auth/password`; non-OK → inline `setError` from the server's `error`. On success, `toast.success("Hasło zostało zmienione. Inne sesje zostały wylogowane.")` — the toast must mention the other-session logout, because a worker signed in on their phone will otherwise be logged out with no explanation. Then close. **Do not `window.location.reload()`** — nothing on the page depends on the password, and the reload convention exists for data mutations that change rendered content.

Label copy must avoid a bare `"Hasło"`: use **"Obecne hasło"**, **"Nowe hasło"**, **"Powtórz nowe hasło"**. `tests/e2e/setup/auth.setup.ts:27` resolves `getByLabel("Hasło", { exact: true })`, and the CI post-deploy health check greps for the literal `Hasło` on the signin page (`ci.yml`). Exact-match labels on a different page do not collide, but the distinct copy removes the hazard entirely.

#### 3. Topbar affordance

**File**: `src/components/Topbar.astro`, `src/components/account/AccountMenu.tsx` (new), `src/pages/dashboard.astro`

**Intent**: Make the e-mail clickable without converting the top bar to an island and without changing the S-17 layout (56 px tall, e-mail plus gold role pill on the left, Dashboard and Sign out in white on the right — `huge-ui-ux-improvement/plan.md:210-219`).

**Contract**: Replace the bare `<span>{user.email}</span>` (`Topbar.astro:14`) with a small `client:load` React island rendering a button whose visible content is the e-mail text, styled to be visually identical to the current span except for a hover affordance consistent with the bar's other controls (`hover:text-accent`). The island owns the open state and renders `ChangePasswordDialog`. It takes `email: string` as its only prop — no `user_id`, no role.

While editing this file, **fix the `lessons.md` violation it already contains**: `Topbar` receives `role` as a prop from `dashboard.astro:213`, but `middleware.ts:31` already computes `locals.userRole` on every request and nothing reads it. Read `Astro.locals.userRole` inside `Topbar` and drop the prop from both the component's `Props` interface and the `dashboard.astro` mount. This is the exact case `context/foundation/lessons.md` was written about, it is a two-line change in a file this phase is already touching, and it retires dead middleware code.

Everything else on the bar — the gold pill, the English `Dashboard` / `Sign out` labels, the native sign-out `<form method="POST">` — stays exactly as is.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checking passes: `npx astro check`
- Existing suite still green: `npm run test:run`
- Build succeeds: `npm run build`
- The existing E2E suite still passes: `npm run test:e2e` — in particular `auth.setup.ts`'s `getByLabel("Hasło", { exact: true })` still resolves uniquely on the signin page
- `grep -n 'role=' src/pages/dashboard.astro` shows no `role` prop on the `Topbar` mount, and `Topbar.astro` reads `Astro.locals.userRole`

#### Manual Verification:

- The top bar is visually unchanged at 56 px with the e-mail and gold pill in place; the e-mail now shows a hover affordance
- Clicking the e-mail opens the dialog; the moderator pill still renders for moderators (proving the `locals.userRole` switch works)
- A wrong current password shows the Polish "Obecne hasło jest nieprawidłowe." message and the password is unchanged
- Mismatched new passwords are caught client-side before any request
- A correct change succeeds; signing out and back in with the new password works, and the old password is rejected
- A second browser session of the same user is signed out after the change, and the session that performed the change is not
- **Use a throwaway account, not the E2E account.** `E2E_USER_PASSWORD` is a fixed `.env` value consumed by `tests/e2e/setup/auth.setup.ts`; changing it breaks every subsequent E2E run. If it is used by accident, restore the original password immediately.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests

Nothing in this change is pure enough to warrant new `src/tests/lib/` coverage — the logic lives in route handlers and React components. `src/tests/lib/employees.test.ts` already covers `isProtectedAdmin`, which Phases 1 and 3 both lean on.

### Integration (route-level) Tests

Both new suites follow the `korekta-gate.test.ts` template: import the handler directly (the `astro:env/server` stub at `vitest.config.ts:32` makes this work), hand-build an `APIContext`, and guard the whole `describe` with `skipIf(!process.env.DATABASE_URL_DIRECT)`.

- **Phase 1** — balance delete ownership matrix, `is_system` rejection on both `POST` and `DELETE`, plus regression assertions that the Korekta field gate and the open entitlement/carryover writes are unchanged.
- **Phase 3** — the full guard matrix on `/api/employees/[id]/email`, including the Risk #4 case (regular employee → 403).

Fixture notes: `createTestEmployee` / `teardownTestEmployee` (`src/tests/helpers/fixtures.ts:13-54`) create and destroy **real** Supabase Auth users. A moderator is manufactured with `UPDATE employees SET role = 'moderator'`; an `is_system` employee likewise with `UPDATE employees SET is_system = true`, reset in cleanup. Phase 3's tests mutate real auth e-mails — teardown discipline is what keeps a second run green.

**Phase 4's route is not covered by route tests.** `POST /api/auth/password` needs a real SSR cookie session, which the direct-handler-import harness cannot manufacture. Verification is manual, per the phase's criteria.

### E2E Tests

**No new E2E specs.** Three hazards make them a poor investment here, all documented in the research: the E2E account's password is a fixed `.env` value that a real password-change test would invalidate for every subsequent run; there is no moderator fixture and no employee-role E2E account, so proving "a non-moderator cannot edit an e-mail" is not currently seedable; and Drizzle-backed flows are not exercisable in `wrangler dev` anyway. The existing suite must keep passing unchanged — that is a Phase 4 success criterion.

### Manual Testing Steps

Drizzle queries fail in `wrangler dev` (workerd's TLS layer rejects Supabase's certificate — `AGENTS.md:87` / CLAUDE.md), so **Phases 1-3 must be verified against the production deployment**. Phase 4's flow touches only the Supabase HTTPS auth API and *is* locally verifiable.

1. Deploy, sign in as a moderator.
2. Pracownicy → Edytuj another worker; confirm their real balance loads, not your own. Save name-only, balance-only, and both; verify each in the DB.
3. Enter a Korekta value; confirm it persists rather than being dropped.
4. Pracownicy → E-mail on the same worker; confirm the current address is shown; change it; sign in as that worker with the new address.
5. Attempt a duplicate address; confirm the Polish 409 message and that the original address survives.
6. On a throwaway account, click the top-bar e-mail; change the password with a wrong current password, then a correct one; confirm a second session is evicted and the current one is not.
7. Confirm the top bar renders identically to before, moderator pill included.

## Performance Considerations

Two new per-dialog-open round trips (balance `GET` in Phase 2, e-mail `GET` in Phase 3), each fetching a single record for a single employee. No list-level cost, no N+1: nothing fires until a dialog opens. This is the explicit reason `admin.listUsers()` was rejected — it would add a paginated auth call to every dashboard render for data almost never looked at, and would ship every worker's address into a client island.

`admin.getUserById` is one HTTPS call to Supabase Auth from the Worker; expect latency comparable to the existing `createUser` path in `POST /api/employees`. The dialog's loading state absorbs it.

## Migration Notes

**No migrations.** No schema changes in any phase. The e-mail lives in `auth.users` and is changed through the Admin API; `auth.users.id` is the FK everywhere and an e-mail change never touches it, so employees, absences, balances, and every RLS predicate keep matching. Nothing to roll back at the data layer.

Rollback for any phase is a code revert plus redeploy. The one irreversible effect is an e-mail actually changed in production — reverting the code does not restore the old address; a moderator must change it back through the UI (or, if the code is gone, through the Supabase dashboard).

Two operational notes: `SUPABASE_SERVICE_KEY` must be present on the production Worker before Phase 3 ships (see that phase's Prerequisites), and CLAUDE.md's "Set production secrets" block should be extended to list it alongside `SUPABASE_URL` and `SUPABASE_KEY`.

## References

- Research: `context/changes/workers-data-edit/research.md`
- Superseded: `context/changes/employee-management/plan.md:39` (no e-mail change after creation)
- Superseded in part: `context/archive/2026-06-22-urlop-balance/plan.md:211` (ungated balance delete)
- Deferred work now delivered: `context/changes/huge-ui-ux-improvement/plan.md:87-92`; `context/archive/2026-08-07-holiday-balance-valid-until/change.md:133-140`
- Korekta gate rationale: `context/changes/huge-ui-ux-improvement/plan.md:821-853`
- Topbar layout lock (S-17): `context/changes/huge-ui-ux-improvement/plan.md:210-219`
- Prop-vs-locals rule: `context/foundation/lessons.md`
- `is_system` invariant: `context/changes/admin-bootstrap/plan.md:38`
- Route-test harness template: `src/tests/api/holiday-balances/korekta-gate.test.ts:32-44`
- Fixtures: `src/tests/helpers/fixtures.ts:13-54`
- Prior review findings to respect: `context/changes/employee-management/reviews/impl-review-phases-2-4.md` (F1 orphaned auth user, F2 never leak `user_id` into a `client:load` prop, F4 fragile duplicate-email string matching)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Close the two authorization gaps on holiday-balance routes

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 322a5fa
- [x] 1.2 Type checking passes: `npx astro check` — 322a5fa
- [x] 1.3 Full unit + route suite passes: `npm run test:run` — 322a5fa
- [x] 1.4 New delete-gate cases pass (employee cannot delete another's balance; moderator can) — 322a5fa
- [x] 1.5 New `is_system` cases pass on both `POST` and `DELETE` — 322a5fa
- [x] 1.6 All 8 pre-existing `korekta-gate.test.ts` cases still pass — 322a5fa
- [x] 1.7 Build succeeds: `npm run build` — 322a5fa

#### Manual

- [x] 1.8 Own-balance Usuń still works for a regular employee on the deployed app — 322a5fa
- [x] 1.9 No visible behaviour change for a moderator — 322a5fa

### Phase 2: Moderator edits a worker's holiday balance

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 215984a
- [x] 2.2 Type checking passes: `npx astro check` — 215984a
- [x] 2.3 Existing suite still green: `npm run test:run` — 215984a
- [x] 2.4 Build succeeds: `npm run build` — 215984a

#### Manual

- [x] 2.5 Edytuj on another worker shows that worker's balance, not the moderator's own — 215984a
- [x] 2.6 Name-only save leaves the balance unchanged — 215984a
- [x] 2.7 Balance-only save leaves the name unchanged — 215984a
- [x] 2.8 Saving both writes both — 215984a
- [x] 2.9 Moderator-entered Korekta persists — 215984a
- [x] 2.10 Worker with no balance record shows zeros; saving creates the row — 215984a
- [x] 2.11 An invalid save (last-moderator demotion) shows the 409 and leaves the balance untouched — 215984a
- [x] 2.12 Loading state is visible and does not flash a half-empty form — 215984a
- [x] 2.13 Editing one's own row through the sheet agrees with the dashboard card — 215984a

### Phase 3: Moderator reads and changes a worker's login e-mail and password

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 7119982
- [x] 3.2 Type checking passes: `npx astro check` — 7119982
- [x] 3.3 `src/tests/api/employees/email.test.ts` passes in full: `npm run test:run` — 7119982
- [x] 3.4 Regular-employee-gets-403 case passes on both verbs (test-plan Risk #4) — 7119982
- [x] 3.5 Pre-existing suites still green, including all holiday-balance route tests — 7119982
- [x] 3.6 Build succeeds: `npm run build` — 7119982
- [x] 3.7 A second consecutive `npm run test:run` is green (no orphaned auth users) — 7119982
- [x] 3.8 `src/tests/api/employees/password.test.ts` passes in full, including a real sign-in with the reset password — 7119982

#### Manual

- [ ] 3.9 `SUPABASE_SERVICE_KEY` confirmed present on the production Worker
- [ ] 3.10 E-mail dialog shows the worker's actual current address
- [ ] 3.11 Changed address works for sign-in; the old one does not
- [ ] 3.12 The worker's existing session keeps working after the change
- [ ] 3.13 Duplicate address shows the Polish 409 message; the original address is unchanged
- [ ] 3.14 The 560 px sheet row lays out correctly with four actions
- [ ] 3.15 A regular employee gets 403 from a direct `PATCH` on both sub-resources and sees no sheet
- [ ] 3.16 The Hasło dialog resets a worker's password; that worker signs in with the new one, not the old
- [ ] 3.17 A password under 8 characters is refused; mismatched repeats are caught client-side
- [ ] 3.18 Resetting a worker's password does not sign that worker out of a live session

### Phase 4: Worker changes their own password from the top bar

#### Automated

- [x] 4.1 Lint passes: `npm run lint`
- [x] 4.2 Type checking passes: `npx astro check`
- [x] 4.3 Existing suite still green: `npm run test:run`
- [x] 4.4 Build succeeds: `npm run build`
- [x] 4.5 E2E suite still passes: `npx playwright test` (the `getByLabel("Hasło", { exact: true })` locator still resolves uniquely) — 6/6 green, but note this suite targets the *deployed* app (`playwright.config.ts:23`), so it must be re-run after deploying Phase 4 for the locator check to actually exercise the new dialogs
- [x] 4.6 `Topbar` reads `Astro.locals.userRole`; no `role` prop remains on the `dashboard.astro` mount

#### Manual

- [ ] 4.7 Top bar visually unchanged at 56 px; e-mail shows a hover affordance
- [ ] 4.8 Clicking the e-mail opens the dialog; the moderator pill still renders
- [ ] 4.9 Wrong current password shows the Polish message; the password is unchanged
- [ ] 4.10 Mismatched new passwords are caught client-side
- [ ] 4.11 A correct change works; the old password is rejected on next sign-in
- [ ] 4.12 A second session is evicted; the session that performed the change is not
- [ ] 4.13 Verified on a throwaway account, not the E2E account
