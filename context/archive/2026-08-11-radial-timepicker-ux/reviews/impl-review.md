<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Radial Timepicker UX

- **Plan**: `context/changes/radial-timepicker-ux/plan.md`
- **Scope**: Phases 1-4 of 4 (full plan)
- **Date**: 2026-08-12
- **Verdict**: REJECTED
- **Findings**: 1 critical, 7 warnings, 2 observations

Commits reviewed: `202fa37`, `8580fc9`, `deab4eb`, `eb55a2c`, `347fce0`, `9a838c7`, `1182bd4`, `67b977c`.

All automated success criteria re-verified at review time: `tsc --noEmit` clean, `npm run lint` 0 errors,
`npm run build` complete, 152 unit tests green, `npm run e2e` 5/5 against production, `time-dial.ts`
imports only `@/lib/absence-hours` and `@/lib/hours`, `package.json` untouched across all eight commits.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

Two cross-cutting notes:

- **Scope Discipline** — three revisions requested mid-implementation (single dial trigger, the (?)
  help tooltip, checkbox theming) were never written back into the plan. `plan.md:259,277-279` still
  says "mount a dial trigger per column", so plan and code disagree on the record.
- **Success Criteria** — 2.10 (fits at 390px) and 3.11 (matches the mockup) were ticked at `8580fc9` /
  `deab4eb`, before `9a838c7` added a second icon button to that row. The narrow-viewport check has not
  been re-run since.

## Findings

### F1 — The dial re-commits the anchored handle unconstrained

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/TimeRangeDial.tsx:86-94
- **Detail**: `commit` passes only the moved handle through `constrainHandle`; the anchor is echoed
  verbatim from state, and `startMinutes` is whatever is in the field — legal or not. Reachable without
  legacy data: uncheck "Cały dzień", type `04:00` into „Czas od", leave „Czas do" empty (the blur clamp
  early-returns at `:169`), click the clock button, drag the end handle → the dial emits
  `("04:00", "10:00")`. Focus returns to the trigger, so no blur re-clamps; Zapisz posts `04:00`, the
  API clamps to `06:00`, returns 201, page reloads, user never told. This is the behaviour
  `time-dial.ts:8-12` and the plan's Phase 3 contract say cannot happen. Secondary: with start=04:00,
  `handleBounds("end")` caps at 12:00 while the server's real cap (from the floored start) is 14:00.
- **Fix A ⭐ Recommended**: Constrain the anchor too, inside `commit`.
  - Strength: Keeps the invariant in the geometry layer, so `onChange` output is clamp-stable by
    construction and the bypass comment stays true.
  - Tradeoff: The start handle visibly moves on the first drag of the end handle when the typed start
    was illegal.
  - Confidence: HIGH — `handleBounds` already computes the legal window.
  - Blind spot: Not checked how it reads visually when both handles shift at once.
- **Fix B**: Run the dial's output through `clampAbsenceHours` in the form.
  - Strength: Reuses the existing correction machinery, so the user gets the same toast as typing.
  - Tradeoff: Commit-then-repair — what the plan explicitly forbids for the dial.
  - Confidence: MEDIUM — correct, but moves the invariant out of the layer built to hold it.
  - Blind spot: Toast could fire on every pointermove mid-drag.
- **Decision**: FIXED via Fix A — new `constrainPair` in `time-dial.ts` constrains the pair, not just
  the moved handle; the anchor is clamped without snapping so off-grid rows keep free-minute
  precision, and the end's cap is measured from the floored start. `TimeRangeDial.commit` now calls
  it. Five tests added, including a property test asserting every emitted pair is a fixed point of
  `clampAbsenceHours` (this also covers most of F5).

### F2 — Correction toast fires for a draft that is then discarded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceFormDialog.tsx:168-186
- **Detail**: Blur fires on mousedown, before the click handler. Typing `04:00`-`20:00` then clicking a
  non-training type toasts the correction, then `selectType` clears both fields and the row unmounts.
  Same on re-checking "Cały dzień" and on Anuluj — a toast about values that no longer exist, over a
  closed dialog. The no-op-blur suppression the plan asked for works; this is a different case.
- **Fix**: Skip the toast when the hours row is about to go away — gate on the fields still being live.
- **Decision**: FIXED — the notice is deferred to a one-shot `document` click listener (with a 250 ms
  timer for keyboard blur, which produces no click) and re-checks a `useLayoutEffect`-synced ref for
  mounted / open / row-still-visible / values-unchanged before firing. A 0 ms timer was the obvious
  fix and is wrong: blur fires on mousedown, so it would run before the click handler.

### F3 — aria-valuemin/max/now can be mutually inconsistent

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/time-dial.ts:66-77 → src/components/absence/TimeRangeDial.tsx:260-262
- **Detail**: `handleBounds` returns raw, unordered numbers straight onto the slider. An inverted typed
  range (`14:00`/`09:00`) gives the end handle valuemin=855, valuemax=1320, valuenow=540; a legacy
  `23:50-23:55` gives valuemin=1445 > valuemax=1439. `constrainHandle` refuses to move in these states
  (correct), but the announced range is invalid ARIA. `aria-orientation` is also absent, implying
  "horizontal" for a circular control.
- **Fix**: Normalize bounds before they reach the DOM; when the window is empty expose `aria-disabled`
  with min = max = now.
- **Decision**: FIXED — new `announcedBounds` widens the announced range to contain the value and
  returns `movable: false` for an empty window, which the handle renders as `aria-disabled`. Movement
  still goes through the raw `handleBounds`. Four tests added, including an exhaustive sweep. One
  part dropped: `aria-orientation="undefined"` is valid ARIA 1.2 but absent from React's prop types,
  and both arrow pairs are handled anyway, so the implied horizontal costs nothing.

### F4 — The E2E suite never asserts the hard stops

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/absence-form-dialog.spec.ts:107-149
- **Detail**: The shipped test proves one ArrowUp moves the start 15 minutes and the field follows. It
  does not prove a handle *cannot* pass 06:00 or `start + 8h` — the change's headline behaviour and
  three of the plan's manual steps (4-6). Home on the start handle → `06:00` and End on the end handle
  → `start + 8h` are both deterministic. Nothing covers the correction toast either. CI never runs e2e,
  so this is the only automated signal.
- **Fix**: Add Home/End stop assertions and a toast assertion to the spec.
- **Decision**: PENDING

### F5 — No test binds the dial's output to clampAbsenceHours

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/tests/lib/time-dial.test.ts
- **Detail**: The suite verifies the two modules agree on the *constants*, never that
  `constrainHandle`'s output is `clampAbsenceHours`-stable. A grid property test over
  (start, end, handle, candidate) asserting the emitted pair survives `clampAbsenceHours` unchanged
  would have caught F1 at Phase 1. The "never lands outside the announced window" sweep also runs for
  one range only (`09:00-13:00`), missing the 23:59 edge and the empty-window case behind F3.
- **Fix**: Add the property test alongside F1's fix, so the invariant has a regression net.
- **Decision**: PENDING

### F6 — The dial's popover is an unnamed role="dialog"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceFormDialog.tsx:386
- **Detail**: Radix `PopoverContent` renders `role="dialog"` with no default accessible name, and none
  is passed. A screen reader announces bare "dialog"; axe flags `aria-dialog-name`. The inner SVG's
  `aria-label` names the group, not the dialog.
- **Fix**: `aria-label={DIAL_TRIGGER_NAME}` on `PopoverContent`.
- **Decision**: PENDING

### F7 — The rules tooltip is unreachable on touch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/AbsenceFormDialog.tsx:394-405
- **Detail**: Radix Tooltip deliberately does not open on touch, and unlike every sibling icon button
  here the (?) carries no `title` fallback. On a phone the four rules have no reachable path, so the
  correction toast becomes the only channel — the opposite of stating the rules before they bite.
- **Fix A ⭐ Recommended**: Controlled Tooltip that also opens on click, so hover, keyboard focus and
  tap all work.
  - Strength: Keeps hover and adds touch.
  - Tradeoff: A few lines of open-state wiring.
  - Confidence: HIGH — Radix Tooltip supports `open`/`onOpenChange`.
  - Blind spot: Tap-to-open needs a tap-elsewhere-to-close check.
- **Fix B**: Swap Tooltip for Popover.
  - Strength: Tap and click work with no custom state.
  - Tradeoff: Loses hover.
  - Confidence: HIGH — same primitive the dial uses.
  - Blind spot: None significant.
- **Decision**: PENDING

### F8 — The exemplar spec ignores the repo's own hydration rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/absence-form-dialog.spec.ts:24-42
- **Detail**: `waitForLoadState("networkidle")` then a bare click on "+" is what `e2e-rules.md:36-37,76-80`
  now tells you not to do, citing intermittent failures on this very locator and pointing at
  `auth.setup.ts` as the reference. That rule landed in the concurrent `e2e-auth-locators` work after
  this spec was written, but this file is the declared exemplar, so the deviation propagates.
- **Fix**: Wrap the click and the dialog assertion in a single `toPass()`.
- **Decision**: PENDING

### F9 — Pointer edge cases in the drag handler

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/absence/TimeRangeDial.tsx:130-151, :141-142
- **Detail**: One `dragRef` for two handles — a second finger on the other handle overwrites it, and
  when that finger lifts the first drag is dead until re-pressed. The face's centre is cached at
  pointerdown and never revalidated, so a Radix reposition mid-drag (resize, ancestor scroll, on-screen
  keyboard) skews every angle for the rest of the drag. Neither can commit the wrong handle — every
  move is gated on `pointerId` — and nothing leaks.
- **Fix**: Ignore pointerdown while a drag is live; re-read the bounding rect inside pointermove.
- **Decision**: PENDING

### F10 — Pre-existing gaps this change inherits rather than causes

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: src/components/absence/AbsenceFormDialog.tsx:135, :171; src/components/ui/tooltip.tsx:54
- **Detail**: An inverted range (`14:00`/`09:00`) leaves Save enabled: `saveDisabled` never checks
  `end > start`, `clampAbsenceHours` returns `!ok`, and the blur handler returns silently — the user
  gets a generic 400. Both lines predate this change and the plan kept the `!ok` branch as-is, but the
  dial's ARIA bounds (F3) now expose the same state. Separately `tooltip.tsx` exports three names where
  upstream shadcn and its sibling `popover.tsx` export the full set — `TooltipProvider` is missing.
- **Fix**: Add `end > start` to `saveDisabled`; export `TooltipProvider`.
- **Decision**: PENDING
