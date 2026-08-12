# Radial Timepicker UX Implementation Plan

## Overview

Add a quarter-hour-snapped radial range dial as a pointer-and-arrow-key path for entering
partial-day absence hours, alongside the retained typed field. The 06:00 floor and the 8-hour
duration cap become physically unreachable on the dial, and the typed path gains a correction
notice when the existing blur clamp rewrites a value.

This is not a control swap. The native `<input type="time">` stays and remains the primary
value carrier; the dial is a second, optional path onto the same two state variables.

## Current State Analysis

The hours row (`src/components/absence/AbsenceFormDialog.tsx:250-281`) is two shadcn `Input`
elements with `type="time"`, `lang="pl-PL"`, `aria-label="Czas od"` / `"Czas do"`, and
`onBlur={clampTimesOnBlur}`. Neither carries `step`, `min`, `max`, or `required`.

`clampTimesOnBlur` (`:92-98`) is two setters and an early return. When it changes a value,
nothing tells the user — no toast, no inline text, no `aria-live`, no highlight, no state flag.
`toast` is imported at `:2` and used at four sites (`:144`, `:148`, `:162`, `:166`), all
failure-only. The server clamps too and returns the corrected row
(`api/absences/index.ts:263`, `[id].ts:206`), but the client discards it — `:140-141` calls
`window.location.reload()` and only parses the body on the failure branch.

The domain rule already lives in one dependency-free module: `src/lib/absence-hours.ts` exports
`MIN_START_TIME` (`:29`, `"06:00"`) and `clampAbsenceHours` (`:59-74`), floor-first then
duration-cap, shared by the form and both API routes.

**What does not exist in this codebase**: any hand-authored `<svg>` in `src/` (all icons are
`lucide-react`), any `canvas`, any raw pointer handling (`onPointerDown`, `setPointerCapture`),
and any `popover.tsx` primitive. The only drag precedent is dnd-kit's `PointerSensor` with a 5px
activation constraint (`AbsenceGrid.tsx:110`). There is also no component-test setup at all —
Vitest is `environment: "node"` and globs only `.test.ts`.

## Desired End State

Opening the absence form for a training type with "Cały dzień" unchecked shows two labelled
columns, „Od godziny" and „Do godziny", each a typed `HH:MM` field with a clock button beside it.
Pressing either button opens a 24-hour dial showing both times as handles with a filled arc
between them. Dragging a handle snaps to quarter hours and physically stops at 06:00 and at 8
hours of span. Focusing a handle and pressing arrow keys moves it in quarter-hour steps with the
same stops. Typing an out-of-bounds value into a field still corrects on blur, and now says so.

Verify by: entering `04:00`–`13:00` by typing (start corrects to `06:00`, a toast says so);
opening the dial and attempting to drag the start below 06:00 (it stops); attempting to drag the
end beyond 8 hours from the start (it stops); tabbing to a handle and pressing arrows
(quarter-hour movement, announced by a screen reader).

### Key Discoveries:

- All UI primitives import from the **unified** `radix-ui` package (`select.tsx:3`,
  `label.tsx:2`, `dialog.tsx:3`), not from `@radix-ui/react-*`. `npx shadcn@latest add popover`
  would install a second Radix copy and import from it — bundle size is CI-checked
  (`.github/workflows/ci.yml:47`). Write `popover.tsx` by hand, mirroring `select.tsx`.
- `Dialog` is modal by default and sets no dismissal handlers of its own (`dialog.tsx:8-10`,
  `:46-67`). A portaled Radix popper nests correctly — `SelectContent` is portaled
  (`select.tsx:53-78`) and already used inside dialogs (`AddEmployeeDialog.tsx:49,95`;
  `EditEmployeeDialog.tsx:86`). Escape dismisses the innermost layer only.
- `DialogContent` is `sm:max-w-lg` with `p-6` — roughly 464px usable width. The close button
  occupies `absolute top-4 right-4` (`dialog.tsx:57-65`).
- `useRovingRadioGroup` (`src/components/hooks/useRovingRadioGroup.ts:10-24`) exists because S-17
  replaced Radix Selects with hand-rolled grids and had to rebuild arrow-key navigation. Its
  header comment is the codebase's statement of the bar: a hand-rolled widget must ship the full
  keyboard contract its ARIA role advertises.
- Design mockup (`new-design/10xUrlopy.dc.html:563-575`) specifies two `flex:1` columns, uppercase
  12px bold `.05em` labels „Od godziny" / „Do godziny", each over a full-width native time input
  with `1px solid #c8c8c8`, `border-radius:8px`, `padding:11px 12px`. The shipped single-row
  `w-32` layout diverged from this.
- Palette tokens (`src/styles/global.css:9-46`): `--primary` navy `#072143`, `--accent` gold
  `#c5ac75`, `--ring` `#b4dceb`, `--line` `#c8c8c8`, `--line-strong` `#e8e8e8`,
  `--muted-foreground` `#6f6f6f`, `--destructive` `#e50040`. There is no `.dark` block and its
  absence is deliberate (`global.css:48-58`).
- `absences_time_check` already forbids a range crossing midnight, so the dial never needs to
  model wraparound.
- E2E targets **production** by default (`playwright.config.ts:24`) and **CI never runs it**
  (`.github/workflows/ci.yml` has no `npm run e2e`). Breaking the spec produces no red signal.

## What We're NOT Doing

- Not removing the native `<input type="time">`. It stays the primary value carrier.
- Not adding `step` or `min` to the text field — typed entry keeps free-minute precision so
  existing rows like `16:27` and `16:52` remain editable.
- Not touching `clampAbsenceHours`, the API routes, the DB schema, or `absences_time_check`.
- Not consuming the corrected row the server already returns; `window.location.reload()` stays.
- Not standing up a component-test stack (jsdom / `@testing-library/react`).
- Not adding `data-testid` — the hybrid model keeps accessible names on real form fields.
- Not adding e2e to CI, and not touching `auth.setup.ts` or `ci.yml` (owned by `e2e-auth-locators`).
- Not changing the full-day checkbox, the type picker, the comment field, or the substitute row.

## Implementation Approach

Three layers, built bottom-up so each is verifiable before the next depends on it.

The **geometry** is a pure function of minutes and angles with no React and no DOM, so it can be
unit-tested in the existing `node` Vitest project — this is where the bug-prone math lives, and
it is the half that automated tests can actually reach.

The **component** owns rendering and interaction only, delegating every numeric decision to the
geometry module. It draws a 24-hour face (one revolution = 1440 minutes, 0.25° per minute), which
avoids the AM/PM ambiguity a 12-hour face would introduce for a 06:00–23:59 domain and lets the
sub-06:00 region render as a single contiguous dead zone.

The **form** keeps both paths writing to the same `startTime` / `endTime` state, so the dial and
the field can never disagree, and the existing blur clamp remains the single correction point for
typed input.

Bounds are derived from `absence-hours.ts` rather than restated, so the dial cannot drift from
what the server enforces.

## Critical Implementation Details

**Escape handling.** A Radix `Popover` portals and registers its own dismissable layer, so Escape
closes the dial and leaves the dialog open. This only holds if the dial is rendered inside
`PopoverContent`. If it is ever moved inline into `DialogContent`, a bare Escape keydown will
bubble to the dialog's layer and close the entire form — that path would need explicit
`stopPropagation`.

**Prevention, not correction, on the dial.** The dial must clamp the _candidate_ position before
committing it to state, not commit and then repair. Committing an illegal value and letting
`clampTimesOnBlur` fix it would make the handle visibly jump, which is the exact silent-rewrite
behavior this change exists to remove.

**Which handle moves under the cap.** Dragging the end handle past 8 hours pins the end at
`start + 8h`. Dragging the _start_ handle away from the end past 8 hours must also pin — decide
per-handle which end is anchored, or the user can widen past the cap by dragging the other side.

## Phase 1: Geometry module

### Overview

A dependency-free module holding every numeric decision the dial makes, with unit tests. No React,
no DOM, no imports beyond `absence-hours`.

### Changes Required:

#### 1. Dial geometry

**File**: `src/lib/time-dial.ts`

**Intent**: Convert between clock angles and minutes-since-midnight, snap to the quarter-hour
grid, and compute the legal position a handle may occupy given the other handle and the domain
bounds. Bounds are derived from `MIN_START_TIME` and `FULL_DAY_HOURS`, never restated, so the dial
and the server share one source.

**Contract**: A 24-hour face — one full revolution is 1440 minutes, 12 o'clock is midnight, angles
increase clockwise, 0.25° per minute, 3.75° per quarter-hour step (96 stops). Exports, roughly:
`angleToMinutes(deg)`, `minutesToAngle(min)`, `snapToStep(min)`, and a
`constrainHandle({ handle, candidateMinutes, startMinutes, endMinutes })` returning the permitted
minutes for that handle. `constrainHandle` enforces: start ≥ 06:00; end > start; span ≤ 8h, with
the _opposite_ handle anchored; and end ≤ 23:59 (no midnight crossing, matching
`absences_time_check`). Also export the polar-to-cartesian helper the SVG needs so no trigonometry
lives in the component.

#### 2. Unit tests

**File**: `src/tests/lib/time-dial.test.ts`

**Intent**: Cover the geometry exhaustively, since this is the only layer automated tests reach.

**Contract**: Round-trip `minutes → angle → minutes` across the full day; snapping at boundaries
(`07:07` → `07:00`, `07:08` → `07:15`); the 06:00 floor rejecting a start of `05:45`; the 8h cap
pinning both directions (dragging end past `start+8h`, and dragging start more than 8h before the
end); `23:59` ceiling; and the wraparound guard — an angle just past 12 o'clock must not silently
produce a next-day value. Mirror the existing style in `src/tests/lib/absence-hours.test.ts`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:run`
- Type checking passes: `npx astro sync && npx tsc --noEmit`
- Linting passes: `npm run lint`
- `src/lib/time-dial.ts` imports nothing beyond `@/lib/absence-hours` and `@/lib/hours`

#### Manual Verification:

- The 06:00 and 8h figures appear nowhere as literals in `time-dial.ts` — both derive from the
  existing constants

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 2: Popover primitive and dial component

### Overview

The overlay primitive the repo lacks, then the dial itself: SVG face, range arc, two keyboard-
operable handles, pointer drag with hard stops.

### Changes Required:

#### 1. Popover primitive

**File**: `src/components/ui/popover.tsx`

**Intent**: Add the missing shadcn Popover wrapper by hand, so it imports from the unified
`radix-ui` package like every other primitive instead of pulling in a duplicate Radix copy.

**Contract**: Export `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`. Mirror
`select.tsx:53-78` exactly for the portal-and-position pattern, `data-slot` naming, and the
`data-[state=open]` animation classes. `PopoverContent` must portal.

```tsx
import { Popover as PopoverPrimitive } from "radix-ui"; // NOT @radix-ui/react-popover
```

#### 2. Range dial

**File**: `src/components/absence/TimeRangeDial.tsx`

**Intent**: Render a 24-hour clock face with both times as draggable, keyboard-operable handles and
a filled arc between them, refusing to enter illegal positions. All numeric decisions delegate to
`@/lib/time-dial`; this component owns rendering and events only.

**Contract**: Props `{ startTime: string; endTime: string; onChange: (start: string, end: string) => void }`,
both times `"HH:MM"`. Renders inline SVG sized to fit ~464px of usable dialog width. Each handle is
`role="slider"` with `aria-valuemin`, `aria-valuemax`, `aria-valuenow` (minutes) and `aria-valuetext`
(the Polish `HH:MM` reading), plus an accessible name naming which end it controls. Keyboard
contract per handle: Arrow keys ±1 step, PageUp/PageDown ±1 hour, Home/End jump to that handle's
legal extreme. Pointer drag uses `setPointerCapture` with a 5px activation threshold, matching
`AbsenceGrid.tsx:110`. Every position passes through `constrainHandle` _before_ being committed —
never commit-then-repair. The sub-06:00 region renders as a visually distinct dead zone using
`--line-strong`; the arc uses `--primary`; handles take the `--ring` focus halo via
`focus-visible:ring-ring/50 focus-visible:ring-[3px]`, matching `input.tsx:12`.

Follow `useRovingRadioGroup.ts` for the keyboard-handler shape (a plain handler, no refs held
across render). If the two handles need a shared tab-stop policy, extract it to
`src/components/hooks/` per `CLAUDE.md:39`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- No new dependency added: `git diff package.json` is empty

#### Manual Verification:

- Dragging the start handle below 06:00 stops at 06:00 rather than jumping back
- Dragging either handle to widen past 8 hours stops at the cap, from both directions
- Handles snap to `:00`, `:15`, `:30`, `:45` only
- Tab reaches both handles; arrows move by 15 min, PageUp/PageDown by an hour, Home/End to extremes
- A screen reader announces each handle's name and its time on focus and on change
- The dial fits inside the dialog without horizontal scrolling at 1280px and at 390px wide

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 3: Form integration

### Overview

Adopt the mockup's two-column hours layout, mount a dial trigger per column, and make the typed
path announce its corrections.

### Changes Required:

#### 1. Hours row layout and dial triggers

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Replace the single `w-32` row with the mockup's two-column layout, giving each field a
real `<Label htmlFor>` and a clock button that opens the shared dial.

**Contract**: Two `flex-1` columns per `new-design/10xUrlopy.dc.html:563-575`, labels „Od godziny"
and „Do godziny". Each `<Input type="time">` keeps `id="start-time"` / `id="end-time"`, keeps
`aria-label="Czas od"` / `"Czas do"` **unchanged** (the E2E locators and `e2e-rules.md:43` depend
on them), keeps `lang="pl-PL"`, and keeps `onBlur={clampTimesOnBlur}` as the commit point. Adding
`htmlFor` alongside the existing `aria-label` must not produce two matching accessible names for
one locator — `aria-label` wins over a `<label>` element, so the accessible name stays „Czas od".
The clock button is a `lucide-react` icon button acting as `PopoverTrigger`; both columns' triggers
open the same `TimeRangeDial` bound to both state values. The dial's `onChange` sets both
`startTime` and `endTime` directly, bypassing `clampTimesOnBlur` — the dial cannot produce a value
needing correction.

#### 2. Correction notice on the typed path

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: When the blur clamp actually changes a value, say so. This closes the second reported
symptom; the comment at `:83-91` already claims this transparency without delivering it.

**Contract**: Inside `clampTimesOnBlur`, on the `ok` branch, compare the clamped pair against the
entered pair and fire `toast.info` only when they differ — never on a no-op blur, or every tab
through the field raises a toast. Message names the corrected values and the reason in Polish
(floor vs cap are distinguishable: start changed ⇒ floor, end changed ⇒ cap). Update the stale
comment at `:83-91` to describe what now happens. The `!clamped.ok` early return keeps its existing
behavior — server 400 surfaced through `toast.error`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Existing API and lib suites still pass: `npm run test:run`

#### Manual Verification:

- Typing `04:00`–`13:00` and blurring corrects the start to `06:00` **and** raises a toast
- Typing `08:00`–`20:00` and blurring caps the end to `16:00` **and** raises a toast
- Tabbing through an already-legal range raises no toast
- Setting a range on the dial and saving stores exactly what the dial showed
- Escape with the dial open closes the dial only; the form stays open with values intact
- Escape with the dial closed still closes the form
- Focus returns to the trigger button when the dial closes
- The hours row matches the mockup's two-column layout
- Switching to a non-training absence type still clears both times (`selectType`, `:73-81`)

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 4: E2E update (deferred)

### Overview

Retarget the browser suite. **Do not start this phase until `e2e-auth-locators` Phase 2 has landed**
— that change reserves edit rights on this exact spec file, and its three tests have never executed
successfully, so any failure seen before then is likely theirs, not ours.

### Changes Required:

#### 1. Spec update

**File**: `tests/e2e/absence-form-dialog.spec.ts`

**Intent**: Keep the existing clamp assertions working against the retained text field, and add
coverage for the dial that fails when the dial breaks.

**Contract**: `getByLabel("Czas od")` / `getByLabel("Czas do")` and all four `fill()` +
`toHaveValue()` assertions (`:64-70`, `:82-88`) survive unchanged, because the text field remains a
single `<input>` committing on blur. Add a test that opens the dial from a trigger, asserts the
handles expose `role="slider"` with correct `aria-valuetext`, drives a handle by keyboard, and
asserts the bound field's value changed accordingly — keyboard rather than pointer drag, so the
assertion is deterministic. Every test must still close via "Anuluj" so no DB rows are written
(`:16-17`, `:54`, `:72`, `:90`). No `data-testid` — per `e2e-rules.md:6` and reaffirmed in
`e2e-auth-locators/plan.md:71-73`.

Note the trap: assertions like `:40-41` and `:50-51` pass when a locator resolves to _nothing_, so
a rename produces a misleading green. Any new visibility assertion must be paired with a positive
one.

#### 2. Locator convention

**File**: `tests/e2e/e2e-rules.md`

**Intent**: Record the dial's locators alongside the existing time-input entry.

**Contract**: Extend the entry at `:43` with the trigger button and handle locators. Edit only that
line's entry — `e2e-auth-locators` owns the signin entry at `:49-53` in the same file.

### Success Criteria:

#### Automated Verification:

- Full suite passes against the deployed app: `npm run e2e`
- Linting passes: `npm run lint`

#### Manual Verification:

- Deliberately breaking the dial's snap makes the new test fail (it is not decorative,
  per `e2e-rules.md:31-33`)
- No absence rows were created by the run
- `git diff` on `e2e-rules.md` touches only the time-input entry

---

## Testing Strategy

### Unit Tests:

- `src/tests/lib/time-dial.test.ts` — angle/minute round-trips, quarter-hour snapping at
  boundaries, the 06:00 floor, the 8h cap pinned from both handles, the 23:59 ceiling, and the
  midnight-wraparound guard.
- Existing `src/tests/lib/absence-hours.test.ts` and `src/tests/api/absences/hours-clamp.test.ts`
  are untouched and must stay green — they cover the rule the dial derives from.

### Integration Tests:

- None new. There is no component-test stack, and standing one up is explicitly out of scope.
  The gap this leaves is recorded under Open Risks in the brief: the React component's keyboard
  contract and pointer handling are covered by manual verification and Phase 4's E2E only.

### Manual Testing Steps:

1. Open an absence form for a training type, uncheck "Cały dzień".
2. Type `04:00` in „Od godziny", `13:00` in „Do godziny", tab out — expect `06:00`–`13:00` and a toast.
3. Tab through both fields again — expect no toast.
4. Open the dial; drag the start handle counter-clockwise past 06:00 — expect it to stop.
5. Drag the end handle clockwise past 8 hours — expect it to stop at `start + 8h`.
6. Drag the start handle away from the end past 8 hours — expect it to stop, not to widen.
7. Tab to a handle, press ArrowUp/ArrowDown, PageUp/PageDown, Home, End.
8. Press Escape with the dial open — dial closes, form stays, focus returns to the trigger.
9. Press Escape again — form closes.
10. Save and reload; confirm the stored range matches what the dial showed.
11. Repeat at 390px viewport width.

## Performance Considerations

Pointer drag updates state per `pointermove`. Keep the committed value on the quarter-hour grid so
React re-renders only on an actual step change, not on every pixel — 96 possible values per handle
means most moves are no-ops. Bundle size is checked in CI (`.github/workflows/ci.yml:47`); this
change adds no dependency, and the inline SVG plus the Popover primitive (already in the installed
`radix-ui` package) should be a small delta.

## Migration Notes

No data migration. No stored value changes meaning, and no existing row becomes invalid: the text
field keeps free-minute precision, so `16:27` and `16:52` remain editable by typing even though the
dial cannot land on them. A row whose times are off the quarter-hour grid displays on the dial at
its true angle; only dragging snaps.

## References

- Frame brief: `context/changes/radial-timepicker-ux/frame.md`
- Prior change (the clamp this builds on): `context/changes/absence-hours-window/frame.md:104-107,133-134`
- Native-over-custom precedent and its reversal: `context/changes/absence-hours-range/research.md:245-247`; commits `9fcac6f` → `876a89b`
- Concurrent change (sequencing dependency): `context/changes/e2e-auth-locators/plan.md:171-187`
- Keyboard-contract precedent: `src/components/hooks/useRovingRadioGroup.ts:10-24`
- Portaled-popper-in-dialog precedent: `src/components/ui/select.tsx:53-78`; `src/components/employee/AddEmployeeDialog.tsx:49,95`
- Design mockup: `new-design/10xUrlopy.dc.html:563-575`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Geometry module

#### Automated

- [x] 1.1 Unit tests pass: `npm run test:run` — 202fa37
- [x] 1.2 Type checking passes: `npx astro sync && npx tsc --noEmit` — 202fa37
- [x] 1.3 Linting passes: `npm run lint` — 202fa37
- [x] 1.4 `time-dial.ts` imports nothing beyond `@/lib/absence-hours` and `@/lib/hours` — 202fa37

#### Manual

- [x] 1.5 The 06:00 and 8h figures derive from existing constants, not literals — 202fa37

### Phase 2: Popover primitive and dial component

#### Automated

- [x] 2.1 Type checking passes: `npx astro sync && npx tsc --noEmit` — 8580fc9
- [x] 2.2 Linting passes: `npm run lint` — 8580fc9
- [x] 2.3 Build succeeds: `npm run build` — 8580fc9
- [x] 2.4 No new dependency added: `git diff package.json` is empty — 8580fc9

#### Manual

- [ ] 2.5 Dragging the start handle below 06:00 stops at 06:00
- [ ] 2.6 Widening past 8 hours stops at the cap, from both directions
- [ ] 2.7 Handles snap to `:00`, `:15`, `:30`, `:45` only
- [ ] 2.8 Tab reaches both handles; arrows, PageUp/PageDown, Home/End behave per contract
- [ ] 2.9 Screen reader announces each handle's name and time
- [ ] 2.10 Dial fits without horizontal scrolling at 1280px and 390px

### Phase 3: Form integration

#### Automated

- [x] 3.1 Type checking passes: `npx astro sync && npx tsc --noEmit`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Build succeeds: `npm run build`
- [x] 3.4 Existing API and lib suites still pass: `npm run test:run`

#### Manual

- [x] 3.5 Typing `04:00`–`13:00` corrects the start and raises a toast
- [x] 3.6 Typing `08:00`–`20:00` caps the end and raises a toast
- [x] 3.7 Tabbing through a legal range raises no toast
- [x] 3.8 A dial-set range saves exactly as shown
- [x] 3.9 Escape closes the dial only; a second Escape closes the form
- [x] 3.10 Focus returns to the trigger when the dial closes
- [x] 3.11 Hours row matches the mockup's two-column layout
- [x] 3.12 Switching to a non-training type still clears both times

### Phase 4: E2E update (deferred)

#### Automated

- [ ] 4.1 Full suite passes: `npm run e2e`
- [ ] 4.2 Linting passes: `npm run lint`

#### Manual

- [ ] 4.3 Breaking the dial's snap makes the new test fail
- [ ] 4.4 No absence rows created by the run
- [ ] 4.5 `e2e-rules.md` diff touches only the time-input entry
