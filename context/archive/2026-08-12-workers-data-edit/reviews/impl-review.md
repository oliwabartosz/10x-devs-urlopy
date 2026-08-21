<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Moderator Edits Worker Data; Workers Change Own Password

- **Plan**: `context/changes/workers-data-edit/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-21
- **Verdict**: NEEDS ATTENTION → **all 10 findings triaged and FIXED** (2026-08-21)
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Every planned change is implemented and matches intent — no MISSING items, no major DRIFT,
all scope guardrails held. The warnings are one security gap the plan deliberately left
standing, one over-broad error mapping, one dialog that skips the plan's own reset idiom,
and a plan line that no longer describes the shipped code.

## Automated verification (re-run during this review)

| Check | Result |
|---|---|
| `npm run lint` | PASS — 0 errors (10 pre-existing `no-console` warnings in `packages/code-reviewer`) |
| `npx astro check` | PASS — 0 errors, 0 warnings, 8 hints (134 files) |
| `npm run test:run` | PASS — 23 files, 266/266 tests, 141 s |
| `npm run test:run` (2nd consecutive, criterion 3.7) | PASS — 266/266, 145 s; no orphaned auth users |
| `npm run build` | PASS — server built in 39.6 s |
| Criterion 4.6 | PASS — no `role=` in `dashboard.astro`; `Topbar.astro:9` reads `Astro.locals.userRole`; mount is bare `<Topbar />` |

## Findings

### F1 — Any employee can still rewrite any colleague's leave entitlement

- **Severity**: WARNING
- **Impact**: HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/holiday-balances/index.ts:148-157
- **Detail**: POST gained the `is_system` guard (Phase 1, correct) and keeps the Korekta field
  gate, but has no ownership or role gate on `current_entitlement_days` / `carryover_days`. Any
  authenticated employee can POST `{employee_id: <anyone>, current_entitlement_days: 0,
  carryover_days: 0}` and zero a colleague's entitlement, with no audit trail. This is not drift —
  the plan states it explicitly ("S-15's *other* ruling … is untouched; only the delete verb
  narrows"). The finding is against the plan decision: Phase 1 closed the sibling gap on DELETE on
  reasoning recorded at `[id].ts:33-38` that reads identically for POST, so the two verbs now sit
  on opposite sides of the same rule in adjacent files. Mitigating: exposure did not increase with
  this change — employee ids already ship to every browser via `dashboard.astro:87`, and the new
  sheet is moderator-only.
- **Fix A (Recommended)**: Mirror the DELETE gate on POST — `if (employee_id !== caller.id &&
  caller.role !== "moderator") return json({ error: "Forbidden" }, 403)`, after the 404 and before
  the Korekta gate.
  - Strength: Six lines, an exact copy of a rule this change already wrote and tested one file
    over; removes an asymmetry that reads as an oversight. No UI depends on cross-employee writes
    from a non-moderator.
  - Tradeoff: Reverses S-15 a second time without the plan saying so; needs a supersession comment
    and two test cases.
  - Confidence: HIGH — the DELETE gate at `[id].ts:42-80` is the working template.
  - Blind spot: Not every POST caller audited for a foreign `employee_id`.
- **Fix B**: Leave it; record as a named follow-up change.
  - Strength: Keeps scope as reviewed; the gap is pre-existing and unchanged in exposure.
  - Tradeoff: Asymmetry stays; "deliberate" is discoverable only by reading two plan documents.
  - Confidence: MEDIUM — defensible, but the second consecutive review surfacing an ungated write.
  - Blind spot: No estimate of how long the follow-up would sit.
- **Decision**: FIXED via Fix A — owner-or-moderator gate added at `holiday-balances/index.ts:182-196`, ordered after the `is_system` gate to match DELETE's 404 → is_system → ownership sequence (the first placement broke `is-system-guard.test.ts:86`, which the pre-commit hook caught). Two cases added: employee writes own → 200, employee writes another's → 403.

### F2 — Every 400-family auth error is reported as "wrong current password"

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/password.ts:84
- **Detail**: `if (updateError.status === 400 || 401 || 422)` → "Obecne hasło jest nieprawidłowe."
  The plan asked for status/code matching over English string matching, and the code does match on
  status — but the bucket swallows distinct GoTrue codes. Confirmed against Supabase's published
  auth error registry: `weak_password`, `same_password`, `session_expired`, `session_not_found`,
  `validation_failed`, `over_request_rate_limit` all land in it. The realistic case is
  `weak_password`: production's `minimum_password_length` / `password_requirements` live in the
  Supabase dashboard, not `supabase/config.toml` — the same unverifiable-setting problem this file
  handles correctly for `secure_password_change` two lines above. A user whose *new* password is
  rejected as weak is told their *current* password is wrong. The branch also returns before any
  `Sentry.captureException`, so it is invisible in monitoring.
- **Fix**: Check `updateError.code` first — `"weak_password"` → 400 with a message about the new
  password, `"same_password"` → the existing "Nowe hasło musi różnić się od obecnego." — then keep
  the status bucket as the wrong-password fallback.
- **Decision**: FIXED — `weak_password` and `same_password` code branches added before the status bucket at `auth/password.ts:81-96`.

### F3 — ChangePasswordDialog never remounts; passwords persist after success

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (also Plan Adherence)
- **Location**: src/components/account/AccountMenu.tsx:31
- **Detail**: `<ChangePasswordDialog open={open} onOpenChange={setOpen} />` is mounted
  unconditionally, with no `key` and no state reset in the success branch — and this is the one
  dialog that deliberately skips `window.location.reload()` (`ChangePasswordDialog.tsx:52-54`).
  Closing never unmounts it: all three plaintext passwords stay in React state and in the
  controlled `<Input value=…>` DOM nodes for the rest of the page's life, and reopening the menu
  shows the just-used passwords pre-filled. Re-submitting them fails with "Obecne hasło jest
  nieprawidłowe" — the password just changed. The plan names this idiom as mandatory under
  Critical Implementation Details ("Every new dialog in this plan must follow the same idiom"); the
  other three new dialogs do (`EmployeeManagementSheet.tsx:216-247`).
- **Fix**: In AccountMenu, render `{open && <ChangePasswordDialog key={String(open)} … />}` so
  close unmounts and clears state.
- **Decision**: FIXED — `AccountMenu.tsx:31` now conditionally renders the dialog so close unmounts and clears the password state, matching `EmployeeManagementSheet.tsx:215-245`.

### F4 — Every worker's auth `user_id` ships into client:load islands

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:87
- **Detail**: `empCols` selects `user_id`, and the resulting `allEmployees` / `gridEmployees` go
  straight into `client:load` islands (`:220`, `:265`, `:277`, `:289`). Astro serializes island
  props into the page HTML, so every signed-in browser receives every colleague's Supabase auth id.
  Nothing reads it — a grep of `src/components/` finds zero `employee.user_id` accesses.
  Pre-existing (line 87 unchanged from before `215984a`). Flagged because it is the exact rule this
  change cites and honours everywhere else (`AccountMenu.tsx:9-11`, `email.ts:48-49`, and the
  plan's own guardrail), while `GET /api/employees` (`index.ts:35-43`) already omits it on purpose.
- **Fix**: Drop `user_id` from `empCols` and type the island props as `Omit<Employee, "user_id">[]`.
- **Decision**: FIXED — `EmployeeListItem = Omit<Employee, "user_id">` added to `src/types.ts`; `user_id` dropped from `empCols` in `dashboard.astro`; 10 component files retyped. Wider than first estimated (~7 files, ~40 refs) — re-confirmed with the user before applying.

### F5 — plan.md:259 still specifies a duplicate-detection mechanism that was replaced

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: context/changes/workers-data-edit/plan.md:259 vs. src/pages/api/employees/[id]/email.ts:84-114
- **Detail**: The plan says "Map `authError.status === 422` → 409 … reusing the exact mapping and
  copy at `employees/index.ts:137-140`." The shipped route instead pre-checks with a parameterized
  `select 1 from auth.users where lower(email) = lower($1) and id <> $2` before the write, keeping
  422 only as a dead fallback at `:134`. The deviation itself is correct and well-argued in the
  file: 422 belongs to `createUser`; `updateUserById` returns an opaque
  `{status: 500, code: "unexpected_failure"}` for a duplicate, and mapping that to "duplicate" is
  precisely the fragile matching impl-review-phases-2-4.md F4 warns about. It was verified against
  the live project and the accepted race is stated honestly. The finding is that the plan was never
  corrected — `e2c16ef` corrected three other claims in this document but missed this one, and the
  plan is what the next review reads as ground truth.
- **Fix**: Rewrite plan.md:259's duplicate-detection sentence to describe the pre-check, cite the
  verified `unexpected_failure` behaviour as the reason, and note the 422 branch is retained as a
  fallback.
  - Strength: Restores the plan as an accurate record before archiving; the evidence is already
    written in the route file.
  - Tradeoff: Editing a plan post-hoc; must read as a correction, not a retroactive rewrite.
  - Confidence: HIGH — `e2c16ef` establishes the correction pattern in this exact document.
  - Blind spot: None significant.
- **Decision**: FIXED — plan.md:259 rewritten to describe the shipped `auth.users` pre-check, the verified `unexpected_failure` behaviour, the retained 422 fallback, and the accepted race.

### F6 — PATCH …/email opens two Postgres pools per request

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/pages/api/employees/[id]/email.ts:103
- **Detail**: `resolveModeratorTarget` already built a pool at `employee-target-guard.ts:50`; the
  route builds a second for the duplicate pre-check. Every other route opens exactly one per
  request (verified across all 12 `createDb` call sites), and none is ever `.end()`ed — correct for
  Workers. The Supabase session pooler caps at 15 clients, which is why this same change had to add
  pool bounding and serial test files.
- **Fix**: Have `resolveModeratorTarget` return `{ target, db }` (or take a `db` parameter) so the
  request uses one pool.
- **Decision**: FIXED — `resolveModeratorTarget` now returns `{ target, db }` (`ResolvedModeratorTarget`); `email.ts` reuses that pool instead of calling `createDb` a second time. Both call sites updated; unused imports removed.

### F7 — Global test-runner change landed under Phase 1, unrecorded in the plan

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: vitest.config.ts:23-29, src/tests/helpers/db.ts:8-11
- **Detail**: `322a5fa` added `fileParallelism: false` and bounded the test pool to
  `max=1&idle_timeout=1`. Both are well-reasoned and thoroughly commented — pooler exhaustion was
  surfacing as false 503s — but `fileParallelism: false` is a project-wide test-runner behaviour
  change and the plan has no record of it at HEAD. Measured cost: the suite runs ~145 s serially.
- **Fix**: Add a one-line addendum to the Phase 1 section recording the change and its reason.
- **Decision**: FIXED — recorded as Phase 1 item 4 in the plan, flagged as a project-wide test-runner behaviour change with the measured ~150 s cost.

### F8 — Only place in the repo where Drizzle reads the `auth` schema

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/pages/api/employees/[id]/email.ts:105-107
- **Detail**: The pre-check is correctly parameterized — no injection — and the trade-off is argued
  in the comment above it. But it silently depends on `DATABASE_URL`'s role retaining read access
  to `auth.users`, a dependency invisible to the schema and migration discipline in AGENTS.md. A
  future least-privilege change to that role would turn duplicate detection into the opaque 500 the
  pre-check exists to avoid.
- **Fix**: Note the `auth.users` dependency in AGENTS.md's database section.
- **Decision**: FIXED — AGENTS.md's "Schema and client" section now records both the one-pool-per-request rule and the `auth.users` read dependency.

### F9 — Criterion 4.5's own note says the check was not fully exercised

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress 4.5
- **Detail**: 4.5 is marked `[x]` (6/6 green) with the honest caveat that the suite targets the
  deployed app (`playwright.config.ts:24`) and "must be re-run after deploying Phase 4 for the
  locator check to actually exercise the new dialogs." Phase 4 is on `main` and deployed; there is
  no record of a re-run. Low risk in substance — `auth.setup.ts:27` resolves
  `getByLabel("Hasło", {exact: true})` on the signin page, which the new dashboard dialogs cannot
  reach — but the criterion as written is not yet satisfied by its own terms.
- **Fix**: Re-run `npx playwright test` against the deployed app and stamp the result, or amend 4.5
  to state why the re-run is unnecessary.
- **Decision**: FIXED — `npx playwright test` re-run against the deployed Phase 4 build: 8/8 green. 4.5 stamped with the result and the note that the locator was never actually at risk (it runs on the signin page).

### F10 — The false repo-wide claim lessons.md was written about is still on disk

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/tests/api/holiday-balances/is-system-guard.test.ts:10
- **Detail**: Line 10 still reads "The balance upsert was the last mutation path in the codebase
  without an `is_system` guard." `lessons.md` cites this exact file:line as one of its two worked
  examples of a false universally-quantified claim, and `holiday-balances/index.ts:174-176` now
  explicitly records that it was false when written. The lesson was captured; the line it was
  captured from was never corrected.
- **Fix**: Replace line 10 with the narrower true statement — these cases enforce the technical
  admin's immutability on this route — mirroring the wording already at index.ts:174-176.
- **Decision**: FIXED — the false repo-wide claim replaced with the narrower true statement plus a record of why, mirroring `holiday-balances/index.ts:174-176`.

## What held up well

All 22 planned changes are implemented and match intent — zero MISSING, zero major DRIFT. The
guard order in all three new routes is byte-identical to the canonical `employees/[id].ts`
sequence, and no non-moderator can reach either sub-resource. No password ever reaches Sentry, a
log, or a response body. Both `AbortController` fetches are correctly wired with no reachable
post-abort `setState`. The Korekta omission-not-rejection gate survives untouched, locked by its 8
original cases. Every scope guardrail held: no `listUsers()`, no new shadcn primitives, no
`DialogDescription`, no audit table, no migrations. `src/lib/employee-target-guard.ts` is an
addition the plan does not name, but it is narrower than the "no shared auth-guard helper
extraction" exclusion — two callers, both new, the five pre-existing duplicating routes untouched,
and it states its own scope at `:13-16`.
