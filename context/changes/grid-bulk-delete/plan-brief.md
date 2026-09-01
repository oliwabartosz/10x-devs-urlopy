# Bulk Delete of Absences from the Grid Selection — Plan Brief

> Full plan: `context/changes/grid-bulk-delete/plan.md`
> Research: `context/changes/grid-bulk-delete/research.md`

## What & Why

The monthly grid's drag selection can write N days at once but cannot clear them. Users who can bulk
add and bulk change type have to delete day by day. This adds the gesture's genuine second verb: a
`Usuń` action on the range dialog backed by a new `DELETE /api/absences/bulk`.

The option is unavailable because it was never in scope — `grid-multicheck` (S-21) excluded it three
times on scope-discipline grounds and encoded the exclusion in the type system. No safety objection
to bulk delete is recorded anywhere.

## Starting Point

The gesture is finished and needs no work: a selection is always a contiguous weekday run inside one
employee column, and `partitionRange` already hands the dialog every occupied day carrying its whole
`Absence` row — so a delete confirmation costs no request and the ids are already client-side. The
dialog already renders exactly that per-day list in the overwrite confirmation. What's missing is a
server route and a button.

The complication is where the button's nearest server template lives: `DELETE /api/absences/:id` has
no `is_system` guard (the only absence write path without one) and **zero** route-level test coverage
— only `PATCH` is imported from that module anywhere in the test suite. Copying it is the exact
mechanism `absence-write-hardening` was opened to fix, and which `lessons.md` records.

## Desired End State

A user drags a run of days over cells that hold absences and the range dialog offers `Usuń` beside
`Zapisz`. Pressing it shows the same per-day list the overwrite flow shows — each day named with its
type and hours, not counted — and confirming removes exactly those rows in one statement. If someone
else already deleted one of those days, the user is told which before the page refreshes. A drag over
entirely free days shows no `Usuń` at all.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Gesture | `Usuń` in the existing range dialog | Reuses the confirm-step machine and the per-day list already built; no new affordance exists in the grid to hang one on. | Plan |
| Body shape | `{ employee_id?, dates[] }` | Composes with `resolveAbsenceWriteTarget`, so the ownership gate and the `is_system` 403 are inherited rather than re-implemented — the ids-based shape needs a hand-rolled guard. | Plan |
| Partial match | Best-effort, `200 { deleted_dates, missing_dates }` | The delete analogue of `created_dates`/`overwritten_dates`; it is what makes the F1 staleness class detectable at all. | Plan |
| `is_system` gap | New route only | The new route is guarded by construction; `[id].ts` cannot retarget a row, so no admin absence exists to delete. | Plan |
| Test scope | New route in full **plus** backfilling the existing single-row DELETE | Bulk delete must not arrive on top of an untested foundation — `lessons.md` records that exactly this omission shipped `bulk.ts` untested. | Plan / Lessons |
| Empty run | `Usuń` hidden, not disabled | Mirrors the single-day rule so one rule covers both modes; the repo withholds affordances rather than no-op'ing them. | Plan |
| Confirmation | Shared confirm step, days named not counted | Inherited constraint from `grid-multicheck`; the shared step keeps one Radix dialog and one focus trap. | Research / Frame lineage |
| Weekend guard on delete | **None**, deliberately | A weekend row can only be legacy data, and refusing to delete it would make it undeletable through the UI — the same bug class as the unguarded admin row. | Plan |

## Scope

**In scope:** `AbsenceBulkDeleteCommand`/`Result` DTOs; a `DELETE` export on `bulk.ts`; a `Usuń`
action and delete-confirm branch in `AbsenceFormDialog`; a staleness warning inverting
`unannouncedOverwrites`; route-level suites for both the new route and the existing single-row DELETE;
one E2E spec; one `e2e-rules.md` heading registration.

**Out of scope:** an `is_system` guard on `DELETE /api/absences/:id`; a confirmation on the single-day
`Usuń`; any new gesture, toolbar, context menu or modifier-key drag; optimistic updates;
multi-employee or discontiguous selection; deleting by id; a new PRD FR.

## Architecture / Approach

```
drag (unchanged)  →  partitionRange  →  occupiedDays  →  dialog
                                                            │ Usuń  (only if occupiedDays > 0)
                                                            ▼
                                                     confirm step (shared)
                                                            │
                                        DELETE /api/absences/bulk { employee_id?, dates[] }
                                                            │
                              resolveAbsenceWriteTarget  →  403 admin / 404 unknown / targetEmployeeId
                                                            │
                    one DELETE … WHERE employee_id = ? AND date IN (…) RETURNING date
                                                            │
                              200 { deleted_dates, missing_dates }  →  staleness warning → reload
```

The authorization insight that keeps this small: because the shared guard silently ignores a
non-moderator's `employee_id` and resolves to the caller's own, `employee_id = <resolved>` *is* the
ownership gate. No ternary, no hand-rolled check, and the `is_system` 403 falls out of the same call.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backfill DELETE tests | Route-level coverage for `DELETE /api/absences/:id` (Nov 2026 window) | None to production — pure addition; risk is only that it reveals the existing route misbehaves |
| 2. Server route | `DELETE /api/absences/bulk` + DTOs + its own suite (Oct 2026 window) | Getting the three deliberate asymmetries with `POST` (no weekend guard, no pre-read, single catch arm) read as omissions by a later reviewer |
| 3. Client action | `Usuń`, delete-confirm branch, staleness warning, fourth dialog title | The confirm step becomes shared by two verbs — a copy or footer branch that leaks into the overwrite path |
| 4. E2E + rules | Playwright drag → `Usuń` → confirm spec; heading registered | E2E does not run in CI, so this is developer-run coverage only |

**Prerequisites:** none — no migration, no schema change, no new dependency. Local `npm run dev` with
a seeded SQLite file and a moderator plus two employees is enough. Phase 4 needs a locally built
server and `BASE_URL` overridden (`playwright.config.ts:24` still defaults to the stale `main`-branch
Cloudflare URL).

**Estimated effort:** ~2 sessions across 4 phases — Phase 2 is the largest (route + 16-case suite),
Phases 1 and 4 are mechanical.

## Open Risks & Assumptions

- **Astro's origin check is content-type dependent** (verified in `middlewares.js`): a JSON-bodied
  `DELETE` skips it, while today's bodyless one requires an `Origin` header. Not a hole — a
  cross-origin JSON `DELETE` needs a preflight Astro never grants — but the E2E teardown convention
  must keep sending `Origin` so specs don't depend on which middleware branch they land in.
- **The client sends only the occupied subset**, so `missing_dates` is a clean staleness signal.
  Sending all `rangeDays` instead would fill it with expected noise and silently defeat the warning.
- **Best-effort breaks the 404-on-no-match convention** for the delete surface: an all-missing request
  answers 200 with an empty `deleted_dates`, so the client must read the body to know nothing
  happened. Accepted deliberately; the single-row route keeps its 404.
- **Legend copy may not need changing.** The plan asks the implementer to verify rather than assume —
  the existing hint describes selecting a range, which stays true.
- The three fetch-once `useRef` caches stay correct only because this flow ends in
  `window.location.reload()`, as every other mutation does.

## Success Criteria (Summary)

- Dragging over occupied days offers `Usuń`, names each affected day with its type and hours, and
  removes exactly those rows — neighbouring days untouched.
- A run over entirely free days offers no delete, and the existing save path is byte-identical.
- The whole absence delete surface — old route and new — has route-level tests asserting database
  state on every path, including that nothing is deleted on every refusal.
