# Moderator Edits Worker Data; Workers Change Own Password — Plan Brief

> Full plan: `context/changes/workers-data-edit/plan.md`
> Research: `context/changes/workers-data-edit/research.md`

## What & Why

Three capabilities the product is missing. A moderator can add and remove workers but cannot fix either of the two things that most often need fixing: a worker's login e-mail (typed once at account creation and never readable again) and their holiday-balance day counts (Bieżące / Zaległe / Korekta — editable only for oneself). Separately, no worker can change their own password, because no such route exists.

**Vocabulary correction carried from research:** the request says "absence days"; these are **holiday-balance** fields on `holiday_balances`, not `absences`. Implementing against the wrong table is the single likeliest way to get this wrong.

## Starting Point

- **Balances** — `POST`/`GET /api/holiday-balances` already accept `employee_id`, already let a moderator target anyone, and already field-gate Korekta to moderators. The *only* blocker is that `HolidayBalanceCard` is mounted once, hard-wired to `currentEmployee.id` (`dashboard.astro:246-253`). Zero API work.
- **E-mail** — `employees` has no `email` column; the address lives only in `auth.users`. A repo-wide search finds no `listUsers`/`getUserById` anywhere. **A moderator cannot see any worker's e-mail today**, so a read path must be built before an edit path.
- **Password** — zero prior art. `src/pages/api/auth/` holds only `signin.ts` and `signout.ts`. `Topbar.astro:14` is a bare `<span>` in a zero-JS Astro component whose layout S-17 locked.
- **Coverage** — `src/tests/api/employees/` does not exist; the employee endpoints have no route-level tests at all.

## Desired End State

A moderator opens **Pracownicy → Edytuj** on any worker and edits their name, role, and holiday balance in one dialog; a separate **E-mail** action on the same row shows and changes that worker's login address, effective immediately. Any signed-in worker clicks **their own e-mail in the top bar** and changes their password behind a current-password check, which signs out their other sessions but not the one they are using. Along the way, a regular employee can no longer delete someone else's balance row, and no API path can touch the technical admin's balance.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| PRD authority for the e-mail power | Deliberate PRD extension, **no audit trail** | Follows the S-11/S-16 "poza PRD" precedent; a first audit table for one operation was judged disproportionate. Consequence stated explicitly in the plan. | Plan |
| E-mail read strategy | Per-row `GET` on dialog-open | Keeps every worker's address out of a `client:load` prop (impl-review F2) and avoids a paginated auth call on every dashboard render | Plan |
| E-mail edit location | Separate `ChangeEmailDialog` | Keeps the Supabase Auth write off the same Zapisz as the Drizzle writes — no single save spans two storage rails | Plan |
| Balance edit location | Merged into `EditEmployeeDialog` | Delivers the identity+entitlement merge deferred at `huge-ui-ux-improvement/plan.md:87-92` | Plan |
| Merged-save failure handling | Sequential `PATCH` → `POST`, report what landed | No transaction exists across the two; a compensating rollback can itself fail and produce a worse, undescribable state | Plan |
| Pre-existing security gaps | Close both, in Phase 1 | This change's UI is exactly what makes them reachable; partially supersedes S-15 on the delete verb only | Plan |
| Balance year | Current calendar year, no picker | Matches the existing rule that past years are stale data, not history (`dashboard.astro:32-36`) | Plan |
| Password gate | Require `current_password` | An old-password check with no project setting touched; blocks walk-up takeover of an unlocked screen | Plan |
| Other sessions on password change | `signOut({ scope: "others" })` | What Supabase Studio does; a password change that evicts nobody defeats its purpose | Plan |
| Topbar affordance | Small React island beside the zero-JS Astro bar | Preserves the S-17 layout, adds no shadcn dependency (`dropdown-menu` is not installed) | Plan |
| E-mail write mechanism | `admin.updateUserById` with `email_confirm: true` | Bypasses the double-confirm flow (the chosen immediate behaviour); omitting the flag would lock the worker out | Research |
| Korekta permission model | Unchanged — field-level gate by omission | 8 existing tests lock it; returning 403 would break the dialog's full-replace save | Research |

## Scope

**In scope**

- `is_system` guard on `POST /api/holiday-balances`; owner-or-moderator gate on `DELETE /api/holiday-balances/[id]`
- Merged identity + balance editing in `EditEmployeeDialog`, fetched on open, saved sequentially
- New `src/pages/api/employees/[id]/email.ts` (`GET` + `PATCH`) and a `ChangeEmailDialog`
- New `POST /api/auth/password` and a `ChangePasswordDialog` opened from the top bar
- First route-level tests for the employee endpoint family (exercises `test-plan.md` Risk #4)
- Two incidental fixes in files already being touched: `SUPABASE_SERVICE_KEY` missing from the test env stub, and `Topbar`'s `role` prop replaced by `Astro.locals.userRole` (the exact case `lessons.md` was written about)

**Out of scope**

- Any audit log or `changed_by` column; any migration at all
- Year picker; batch-balance endpoint; e-mail addresses listed in the sheet rows; `listUsers()`
- Confirmation or notification mail on e-mail change; session revocation on e-mail change
- Moderator-initiated password reset; any reintroduction of self-service signup
- New shadcn primitives; changes to the `window.location.reload()` convention; extracting the duplicated auth guard
- Fixing the stale docs found in research (`AGENTS.md:9`, `test-plan.md`, the missing S-17 roadmap row)

## Architecture / Approach

Two storage rails, kept apart. Balance and identity are both Drizzle writes and are merged into one dialog; the e-mail is a Supabase Auth write (service role) and stays in its own. The merged dialog still spans two *requests* with no transaction, so it saves sequentially — identity first, because that is the one that can fail on a business rule the moderator can act on — and on a second-stage failure reports exactly which half landed rather than attempting a rollback that can itself fail.

The password route is the only one that uses the caller's own SSR cookie session rather than the service role, and the only new route under `/api/auth/`. It deliberately breaks that folder's FormData-plus-redirect convention in favour of the JSON + zod + `{ error }` idiom used everywhere else, because it is called from a dialog that must render errors inline.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Close authorization gaps | `is_system` guard on balance upsert; owner-or-moderator balance delete + tests | Partially reverses an S-15 ruling; needs an `is_system` fixture that does not exist yet |
| 2. Moderator edits balances | Merged identity + entitlement dialog, `GET` on open, sequential save | First async read in `src/components/employee/` — a failed fetch must disable balance saving, or a full-replace save clobbers real values with defaults |
| 3. Worker e-mail read + write | `[id]/email.ts` route, `ChangeEmailDialog`, first employee-route tests | Blocked entirely if `SUPABASE_SERVICE_KEY` is absent on the production Worker; tests mutate real Supabase Auth records |
| 4. Self-service password | `POST /api/auth/password`, top-bar affordance | Production's `secure_password_change` setting is unknowable from this repo — handled by mapping the reauth error rather than by checking |

**Prerequisites:** Phase 3 requires `SUPABASE_SERVICE_KEY` confirmed on the production Worker (`npx wrangler secret list --name urlopy`). Phases 1–3 can only be verified against the production deployment — Drizzle does not work in `wrangler dev`. Phases 3 and 4 do not depend on 1 or 2; each phase is independently shippable.

**Estimated effort:** ~4 sessions, one per phase. Phase 2 is the largest UI change; Phase 3 the largest test investment; Phase 1 the smallest.

## Open Risks & Assumptions

- **The e-mail power ships with no audit trail.** A moderator can change any worker's login credential leaving no record of who, when, or from what. Accepted deliberately; retrofitting is a migration.
- **`SUPABASE_SERVICE_KEY` on production is unverified.** `POST /api/employees` already depends on it so it is probably set, but this could not be confirmed (wrangler is not authenticated non-interactively). If absent, every e-mail operation 503s.
- **`secure_password_change` on the production Supabase project is unknowable from this repo.** Handled by mapping the reauthentication error to a clear Polish message rather than gating the plan on checking a dashboard.
- **`window.location.reload()` after every mutation closes the sheet.** Phases 2 and 3 add a second and third mutation path inside it, multiplying that friction for a moderator editing several people. Accepted, not fixed.
- **An e-mail changed in production is not undone by a code revert.** The only irreversible effect in the change.
- **Phase 4's route has no automated coverage** — it needs a real SSR cookie session the test harness cannot manufacture. Manual verification only, on a throwaway account (the E2E account's password is a fixed `.env` value).

## Success Criteria (Summary)

- A moderator can, from one place, correct any worker's name, role, holiday balance, and login e-mail — and a partial failure says precisely what saved and what did not.
- Any worker can change their own password from the top bar behind a current-password check, and doing so evicts their other sessions but not the current one.
- A regular employee cannot delete another person's balance, cannot reach the e-mail endpoints, and no path can mutate the technical admin — each proven by a route test rather than by inspection.
