# Radial Timepicker UX — Plan Brief

> Full plan: `context/changes/radial-timepicker-ux/plan.md`
> Frame brief: `context/changes/radial-timepicker-ux/frame.md`

## What & Why

The hours control exposes minute-level granularity and hides its own domain constraints, then
silently corrects the user instead of telling them — so entry is laborious _and_ its result is
untrustworthy. This adds a quarter-hour-snapped radial range dial as a pointer-and-arrow path
alongside the existing typed field, makes the 06:00 floor and 8-hour cap physically unreachable
on the dial, and gives the typed path a correction notice.

## Starting Point

Two native `<input type="time">` fields (`AbsenceFormDialog.tsx:250-281`) with no `step`, `min`,
or `max`. Reaching `:30` by arrow key takes 30 presses. `clampAbsenceHours` corrects out-of-bounds
values on blur (`:92-98`) with zero feedback — `toast` is imported at `:2` but used only for
failures, and the server's corrected row is returned and then discarded by the client's
`window.location.reload()` at `:140-141`.

## Desired End State

Two labelled columns, „Od godziny" and „Do godziny", each a typed field with a clock button. The
button opens a 24-hour dial showing both times as handles with a filled arc between them. Dragging
snaps to quarter hours and stops dead at 06:00 and at 8 hours of span. Handles are arrow-key
operable. Typing an illegal value still corrects on blur — and now says so.

## Key Decisions Made

| Decision            | Choice                                                    | Why (1 sentence)                                                                                            | Source |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| Problem definition  | Granularity + feedback failure, not control shape         | The user enters quarter hours through a control offering 60 values per hour, and corrections are invisible. | Frame  |
| Input model         | Hybrid — field kept, dial added in a popover              | Preserves the 4-keystroke typed path and keeps every existing E2E assertion structurally valid.             | Plan   |
| Granularity         | Quarter-hour on the dial, free minutes when typed         | Matches the values actually entered while keeping `16:27`-style rows editable.                              | Plan   |
| Dial shape          | One 24h face, range arc between two handles               | Makes the 8h cap and 06:00 floor visually self-evident rather than bolting text on.                         | Plan   |
| Bounds handling     | Prevent on the dial — illegal positions unreachable       | No correction is needed on a path that cannot produce an illegal value.                                     | Plan   |
| Typed-path feedback | `toast.info` only when the clamp actually changes a value | Closes the second reported symptom using a channel already imported.                                        | Plan   |
| Popover primitive   | Hand-written, importing from unified `radix-ui`           | `npx shadcn add popover` would install a second Radix copy into a CI-measured bundle.                       | Plan   |
| Verification        | Pure geometry module + Vitest; E2E updated in place       | Puts real coverage on the bug-prone math without standing up a component-test stack.                        | Plan   |
| Sequencing          | Build now, land the E2E phase last                        | `e2e-auth-locators` reserves edit rights on the same spec file.                                             | Plan   |
| Layout              | Adopt the mockup's two-column layout                      | Converges shipped UI onto the design system and makes room for triggers.                                    | Plan   |

## Scope

**In scope:** a new pure geometry module; a hand-written `ui/popover.tsx`; a `TimeRangeDial`
component with full keyboard contract; the two-column hours layout; a correction toast; an updated
E2E spec and locator rule.

**Out of scope:** removing the native input; `step`/`min` on the text field; changes to
`clampAbsenceHours`, the API routes, or the DB; consuming the server's corrected row; a
component-test stack; `data-testid`; e2e in CI; anything owned by `e2e-auth-locators`.

## Architecture / Approach

Three layers, bottom-up. `src/lib/time-dial.ts` holds every numeric decision — angle↔minutes,
quarter-hour snapping, and per-handle bound constraint — derived from `MIN_START_TIME` and
`FULL_DAY_HOURS` rather than restated, and unit-tested in the existing `node` Vitest project.
`TimeRangeDial.tsx` owns rendering and events only, drawing a 24-hour face (one revolution =
1440 minutes, 0.25°/minute) so a 06:00–23:59 domain needs no AM/PM disambiguation and the
sub-06:00 region is one contiguous dead zone. Both the dial and the field write to the same
`startTime`/`endTime` state, so they cannot disagree.

## Phases at a Glance

| Phase                      | What it delivers                              | Key risk                                                           |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| 1. Geometry module         | `time-dial.ts` + unit tests                   | Wraparound and cap-pinning edge cases in the math                  |
| 2. Popover + dial          | `ui/popover.tsx`, `TimeRangeDial.tsx`         | Net-new SVG and pointer capture with no codebase precedent         |
| 3. Form integration        | Two-column layout, triggers, correction toast | Adding `htmlFor` must not create a second matching accessible name |
| 4. E2E update _(deferred)_ | Retargeted spec + locator rule                | Blocked on `e2e-auth-locators` Phase 2; suite has never passed     |

**Prerequisites:** `e2e-auth-locators` Phase 2 must land before Phase 4 starts. Phases 1–3 have no
external dependency. Note the working tree currently has an unrelated in-flight refactor of
`src/lib/type-filter.ts` that leaves `astro check` and `npm run lint` red repo-wide.

**Estimated effort:** ~3–4 sessions; Phase 2 is the bulk.

## Open Risks & Assumptions

- **The dial is net-new on three counts** — no hand-authored SVG, no canvas, and no raw pointer
  handling exist anywhere in `src/`. The only drag precedent is dnd-kit's `PointerSensor`.
- **The design mockup has no dial** (`new-design/10xUrlopy.dc.html:563-575` specifies plain native
  time inputs), so this deliberately extends the design system rather than implementing it.
- **A custom time control was built and reverted here before**, in three minutes, on 2026-06-06
  (`9fcac6f` → `876a89b`). The reason was never recorded outside the commit messages.
- **No automated coverage of the React component.** There is no component-test stack, so the
  keyboard contract and pointer handling rest on manual verification plus Phase 4.
- **Breaking the E2E suite produces no CI signal** — CI never runs `npm run e2e`, and the suite
  targets production by default.
- **Arrow keys on the text field stay coarse.** Since the field keeps free-minute precision, the
  arrow-key path improves only on the dial's handles. Accepted tradeoff, not an oversight.

## Success Criteria (Summary)

- A quarter-hour range can be set entirely by pointer, or entirely by keyboard, without typing.
- The dial cannot be moved into an illegal position — the constraint is felt, not enforced after.
- When a typed value is corrected, the user is told; when nothing changes, they are not.
