<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Drag-to-select a day range in the absence grid

- **Plan**: `context/changes/grid-multicheck/plan.md`
- **Scope**: Phases 1–6 of 6 (full plan)
- **Date**: 2026-08-18
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 5 observations

## Automated verification (re-run at review time)

| Check | Result |
|---|---|
| `npm run lint` | 0 errors (10 pre-existing `no-console` warnings in `packages/code-reviewer`) |
| `npm run test:run` | 21 files, **241 passed, 0 skipped** — DB suites genuinely ran (`.env` supplies `DATABASE_URL_DIRECT`) |
| `npm run build` | success |
| `npx astro check` | 131 files, 0 errors |
| `npm run e2e` | **8/8**, incl. both new range specs |
| `git status` | clean |

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## What is solid

Every planned export exists and matches intent. All four guards in `bulk.ts` run once on shared
fields in the correct order with no bypass path. The upsert's conflict target matches
`UNIQUE (employee_id, date)` and the `set` clause covers every mutable column — no stale values
survive an overwrite. All five `useMemo` dependency arrays are complete. The window-`mouseup`
effect has no stale closure and no listener leak. No scope-guardrail violations: no touch/keyboard
selection, no 2-D selection, no optimistic updates, no bulk delete, no public-holiday or
entitlement logic, dnd-kit listeners still only on the grip. A regular employee cannot write into
another employee's column.

## Findings

### F1 — A stale grid overwrites entries with no confirmation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `src/components/absence/AbsenceFormDialog.tsx:374` · `src/pages/api/absences/bulk.ts:198-209`
- **Detail**: The overwrite confirmation is gated solely on `occupiedDays` (`:333`), computed by the
  grid from `absenceMap` — the absences rendered at page load. If a colleague or another tab wrote
  into the range since then, the confirm step is skipped entirely and those rows are destroyed
  silently. The server already knows: `bulk.ts` pays an extra SELECT round trip specifically to
  produce `overwritten_dates`, justified in its own comment as "the per-day reporting the client
  needs". The only caller does `if (res.ok) { window.location.reload(); }` and never reads the body.
- **Fix A ⭐ Recommended**: Read the response; if `overwritten_dates` contains a day the confirmation
  did not name, toast a warning before reloading.
  - Strength: Closes the gap using data already on the wire — no new query, no new pattern, and it
    makes the extra SELECT earn its cost.
  - Tradeoff: The warning is after the fact; it informs rather than prevents.
  - Confidence: HIGH — the fields exist and are correct; only the client changes.
  - Blind spot: Haven't measured how often two people edit one column concurrently.
- **Fix B**: Drop the pre-write SELECT and accept the feature has no per-day reporting.
  - Strength: Removes a round trip and an inconsistency the plan didn't require.
  - Tradeoff: Gives up the stale-grid signal entirely; silent loss stays silent.
  - Confidence: MEDIUM — simpler, but forecloses the fix rather than making it.
  - Blind spot: The plan explicitly called for created-vs-overwritten reporting.
- **Decision**: **FIXED via Fix A** — `AbsenceFormDialog.tsx`: added `unannouncedOverwrites()` helper; the success path now reads `overwritten_dates` and, when it names a day the confirmation did not, raises a persistent `toast.warning` whose "Odśwież" action performs the reload (a plain toast would be swallowed by `window.location.reload()`). Stays `isSubmitting` so the landed write cannot be repeated.

### F2 — Drag sticks when the button is released outside the document

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/absence/AbsenceGrid.tsx:163-191, :445-457`
- **Detail**: Commit rides on a window `mouseup`. Mouse events carry no implicit capture, so a press
  starting on a cell and releasing over browser chrome, another window, or devtools never delivers
  `mouseup` to the page. `drag` stays non-null, and `onMouseEnter` (`:445`) takes no event argument
  so it cannot test `buttons` — moving back over the grid keeps extending a selection with no button
  held, and the next unrelated mouseup anywhere commits a range dialog the user never asked for.
  Plan criterion 5.7 tests the inside-the-page case, which does work; this is the
  outside-the-document case.
- **Fix A ⭐ Recommended**: Bail out and clear the drag in `onMouseEnter` when `event.buttons === 0`,
  and add window `blur` to the effect's listener set.
  - Strength: Two small edits inside the existing effect; keeps the mouse-event model the whole
    gesture and its E2E spec are built on.
  - Tradeoff: Recovers on the next mouse move rather than at the moment of loss.
  - Confidence: HIGH — `buttons` is exactly the state the handler is missing.
  - Blind spot: None significant.
- **Fix B**: Move the gesture to pointer events with `setPointerCapture` on the anchor cell.
  - Strength: Removes the failure class outright; the browser guarantees delivery.
  - Tradeoff: Rewrites all three handlers and invalidates the E2E drag helper.
  - Confidence: MEDIUM — correct, but a larger change than the defect warrants now.
  - Blind spot: Interaction with dnd-kit's PointerSensor on the header grip.
- **Decision**: **FIXED via Fix A** — `AbsenceGrid.tsx`: `onMouseEnter` now takes the event and clears the drag when `event.buttons === 0`; a window `blur` listener was added to the same effect, abandoning (not committing) the drag. ⚠️ Not verified in a browser — see "Verification status" below.

### F3 — A right- or middle-button drag opens the range dialog

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/absence/AbsenceGrid.tsx:438-444`
- **Detail**: `onMouseDown={clickable ? () => { setDrag({...}) } : undefined}` takes no event
  argument, so `event.button` is never checked, and `mouseup` fires for every button. A right-button
  drag across cells opens the range dialog underneath the context menu; on Linux the middle-button
  paste gesture does the same.
- **Fix**: Take the event and return early unless `e.button === 0`.
- **Decision**: **FIXED** — `AbsenceGrid.tsx`: `onMouseDown` now takes the event and returns early unless `event.button === 0`. ⚠️ Not verified in a browser — see "Verification status" below.

### F4 — bulk.ts has no route tests, on a plan premise that was false

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `context/changes/grid-multicheck/plan.md` (Testing Strategy → Integration Tests) · `src/pages/api/absences/bulk.ts`
- **Detail**: The plan states "There is no integration-test layer in this repo" and routes all bulk-route
  verification to manual checks. That claim was already false when the plan was written: `src/tests/api/`
  holds seven route-level suites across three route families, invoking exported handlers with an
  `APIContext` stub against the real DB — `crud.test.ts` since 2026-06-04, `partial-day-guard.test.ts`
  since 2026-07-22, `korekta-gate.test.ts` since 2026-08-07, all weeks before this plan. The
  highest-risk file in the change shipped untested on a premise a two-minute check would have refuted.
  `grep -rln "absences/bulk" src/tests tests` returns nothing. E2E covers only the happy path, since it
  can only send bodies the dialog can produce. The team recorded this gap in `change.md` (`afaf221`) and
  correctly identified the harness — what that note misses is that the plan asserted the harness did not
  exist. **F2 and F3 are precisely the defect class those tests catch.**
- **Fix A ⭐ Recommended**: Open a follow-up to add `src/tests/api/absences/bulk.test.ts` on the
  `partial-day-guard.test.ts` harness, covering the five rejection paths.
  - Strength: Harness, fixtures and the `role: "employee"` account factory already exist; no new pattern.
  - Tradeoff: Defers closure to another change rather than fixing it here.
  - Confidence: HIGH — the exemplar does exactly this for the single-row routes.
  - Blind spot: None significant.
- **Fix B**: Correct the plan's Testing Strategy paragraph and record the lesson, then close as-is.
  - Strength: Cheapest; keeps the source of truth honest for future readers.
  - Tradeoff: Leaves every rejection path in a privilege-sensitive route untested.
  - Confidence: MEDIUM — accurate documentation, unchanged risk.
  - Blind spot: Whether the gap survives the next refactor unnoticed.
- **Decision**: **QUEUED via Fix A** — `follow-ups/review-fixes.md` item 1, with the five rejection paths enumerated and the harness named. Not fixed in this session.

### F5 — bulk.ts skips the is_system guard every other write path applies

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/absences/bulk.ts:138-154`
- **Detail**: `src/lib/employees.ts:8-11` documents the invariant: RLS is bypassed, so the
  technical-admin rule "must be re-asserted in every read surface and every write path (via
  `isProtectedAdmin`)". Six write paths honour it (`employees/[id].ts:93,:175`, `restore.ts:66`,
  `holiday-balances/[id].ts:75`, `holiday-balances/index.ts:174`, `employee-target-guard.ts:96`). The
  moderator branch here selects only `{ id }` and filters only on `deleted_at`, so a moderator with a
  hand-crafted body can write 31 rows onto the admin — rows then hidden from `GET /api/absences` by
  `visibleEmployeesFilter`, hence not deletable through the UI. This is parity, not a regression:
  `POST /api/absences` has the identical gap, and the plan explicitly specified "exactly as
  index.ts:204-219 does". The plan faithfully propagated an existing hole; bulk multiplies its blast
  radius by 31.
- **Fix**: Add `is_system` to the target select and reject via `isProtectedAdmin` with 403, matching
  `holiday-balances/index.ts:173-176`. Consider the same for the single-row route in a follow-up.
- **Decision**: **QUEUED** — `follow-ups/review-fixes.md` item 2, covering `bulk.ts` and `index.ts` together plus the adjacent `substitute_employee_id` looseness. Not fixed in this session.

### F6 — Bulk DTOs are declared but never used

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/types.ts:14,31`
- **Detail**: `AbsenceBulkCreateCommand` / `AbsenceBulkCreateResult` are exported and imported nowhere.
  The 201 body (`bulk.ts:233-240`) carries no `satisfies`, and the client body
  (`AbsenceFormDialog.tsx:356-361`) is a bare literal, so nothing type-checks the wire contract and the
  three declarations can drift silently. Repo convention is the opposite —
  `holiday-balances/index.ts:230` uses `satisfies HolidayBalanceView`.
- **Fix**: Add `satisfies AbsenceBulkCreateResult` on the response and type the fetch body as
  `AbsenceBulkCreateCommand`.
- **Decision**: **FIXED** — `satisfies AbsenceBulkCreateResult` on the 201 body, `satisfies AbsenceBulkCreateCommand` on the client body. This immediately caught a latent looseness: `absenceTypeId` is `number | null` in component state, so an explicit `if (absenceTypeId === null) return;` guard was added at the top of `submitAbsence` to state the invariant `saveDisabled` was enforcing implicitly.

### F7 — Bulk write is not abortable; the dialog can close mid-flight

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/absence/AbsenceFormDialog.tsx:340-390`
- **Detail**: No `AbortController`, unlike the sibling pattern in `AbsenceGrid.tsx:257-266`. Both
  "Anuluj" buttons are disabled while submitting, but Radix's Escape and overlay click are not — the
  user can believe they cancelled while N rows land.
- **Fix**: `preventDefault()` on `onEscapeKeyDown` / `onInteractOutside` while `isSubmitting`.
- **Decision**: **FIXED** — `onEscapeKeyDown` / `onInteractOutside` on `DialogContent` now `preventDefault()` while `isSubmitting`.

### F8 — MAX_BULK_DATES is a dead export

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/absences/bulk.ts:43`
- **Detail**: Exported, imported nowhere; the client enforces no cap of its own. Unreachable in practice
  (one rendered month yields ≤23 weekdays).
- **Fix**: Make it module-private, or import it into a client-side guard.
- **Decision**: **FIXED** — `export` dropped; `MAX_BULK_DATES` is module-private.

### F9 — E2E uses a real pointer, not the planned synthesized events

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `tests/e2e/absence-grid-range.spec.ts:107-115`
- **Detail**: The plan prescribed dispatching `mousedown`/`mouseenter`/`mouseup`. The spec uses
  `hover()`/`mouse.down()`/`mouse.up()` instead, documented at `:100-102` with a sound reason: React
  derives `onMouseEnter` from delegated `mouseover`/`mouseout` with a `relatedTarget`, so a dispatched
  `mouseenter` reaches no handler. The plan's actual constraint — geometry-free — is honoured; no
  coordinate appears. Mechanism changed, intent preserved. Noted only because `e2e-rules.md:88-89`
  inverts the plan's framing, arguing why a `page.mouse` drag *is* acceptable here.
- **Fix**: None required; accept as a documented deviation.
- **Decision**: **ACCEPTED** — no action. Intent (geometry-free) preserved, mechanism deviation documented in the spec itself with a valid technical reason.

### F10 — Roadmap status for S-21 is stale

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/foundation/roadmap.md:63`
- **Detail**: Still `planned`, which the legend defines as "folder zmiany otwarty, brak planu". The change
  is fully implemented with a 44 KB plan; per the legend it should be `review pending` until archived.
- **Fix**: Set S-21 to `review pending`.
- **Decision**: **FIXED** — `roadmap.md:63` S-21 set from `planned` to `review pending`, matching the legend.

---

## Triage outcome (2026-08-18)

| | Findings |
|---|---|
| **Fixed** | F1, F2, F3, F6, F7, F8, F10 (7) |
| **Queued as follow-up** | F4, F5 (2) — `follow-ups/review-fixes.md` |
| **Accepted, no action** | F9 (1) |

### Verification status of the fixes

Re-run after all edits, against the working tree:

| Check | Result |
|---|---|
| `npm run lint` | 0 errors |
| `npx astro check` | 131 files, 0 errors, 0 warnings |
| `npm run test:run` | 21 files, 241 passed, 0 skipped |
| `npm run build` | success |
| `npm run e2e` | 8/8 |

**Update (2026-08-18, after deploy `1a2451b`).** The table above was produced against a
deployment that predated these fixes. The fixes were then committed, pushed, auto-deployed by CI
(run `32135186522`, both jobs green), and `npm run e2e` was re-run against the deployment that
carries them: **8/8 again**, including both range specs.

That run does verify the fixes are **non-regressive** — F2's `buttons === 0` guard and F3's
`button === 0` guard do not break the real-pointer drag the range specs perform, F1's
response-reading path still writes and still confirms, and F7's dismissal lock does not interfere
with the normal dialog flow.

It does **not** verify their *positive* behaviour, because no test exercises those paths:

- **F2** — releasing the button outside the document and confirming the selection is abandoned.
- **F3** — a right- or middle-button drag doing nothing.

Both are negative-path behaviours with no coverage; they were reasoned about, implemented, and
proven harmless, but not proven effective. Worth a manual pass, or a spec in the follow-up change.
