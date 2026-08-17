# Frame Brief: Radial timepicker UX for absence hours

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

Entering partial-day absence hours in `AbsenceFormDialog` is slow and fiddly, and
entered values get rewritten to something the user did not type. Friction occurs on
**desktop with a keyboard**. Scope of concern: the two time inputs only.

## Initial Framing (preserved)

- **User's stated cause or approach**: not stated as a cause — the change-id names a
  solution outright (`radial-timepicker-ux`). Reaffirmed during narrowing: _"I need
  radial timepicker, its quicker and more convinient, both for start and the end day."_
- **User's proposed direction**: replace the two native `<input type="time">` fields
  with a radial (clock-dial) picker.
- **Pre-dispatch narrowing**: two symptoms selected, not one — "entry is slow / fiddly"
  **and** "values get rewritten". Context: desktop keyboard. Scope: just the two time
  inputs.
- **Post-dispatch narrowing**: field renders 24h `HH:MM` (no AM/PM); the user enters
  times by **typing digits, arrow keys/scroll, and clicking the clock icon** — all
  three; entered values are **quarter-hour granular** (`:00 :15 :30 :45`).

## Dimension Map

The observation could originate at any of these dimensions:

1. **Input mechanics** — the control's granularity and affordances during entry
2. **Silent correction** — `clampAbsenceHours` rewriting values without saying so ← "values get rewritten"
3. **Constraint invisibility** — the 06:00 floor / 8h cap never shown until violated
4. **Component layer** — native control vs custom/styled picker ← initial framing
5. **Locale rendering** _(added in Step 5)_ — `lang` attribute churn producing a 12h AM/PM control

## Hypothesis Investigation

| Hypothesis                                                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Verdict                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **D1 Input mechanics** — control granularity mismatches the data | `step` **absent** on both inputs (`AbsenceFormDialog.tsx:254-278`). Default step is 60s → the minute segment exposes **60 values**; user enters only **4 per hour**. Arrow entry from `00:00` to `08:30` = 8 + **30** presses; `step={900}` makes it 2. User confirmed they use arrows/scroll and the clock icon. Typed entry is already only 4 keystrokes/field.                                                                                                | **STRONG** (as granularity, not typing speed) |
| **D2 Silent correction** — clamp rewrites with zero feedback     | `clampTimesOnBlur` (`AbsenceFormDialog.tsx:92-98`) is two setters and nothing else. No toast, no inline text, no `aria-live`, no `aria-invalid`, no "was corrected" flag in state. `toast` is **already imported** (`:2`) and used at `:144,:148,:162,:166` — failure-only. Server returns the corrected row (`api/absences/index.ts:263`, `[id].ts:206`) and the client **discards it**: `window.location.reload()` at `:140-141`, body parsed only on failure. | **STRONG**                                    |
| **D3 Constraint invisibility** — legal window never surfaced     | `min`/`max` **absent** on both inputs, though `MIN_START_TIME = "06:00"` is already exported (`src/lib/absence-hours.ts:29`) and used only server-side and in the blur clamp. `<Label>Godziny</Label>` (`:252`) has no `htmlFor`. The 8h cap appears nowhere in the UI.                                                                                                                                                                                          | **STRONG**                                    |
| **D4 Component layer** — the control type is the problem         | `src/components/ui/input.tsx:5-18` passes `type` through with no time-specific CSS; zero `::-webkit-*` rules in `src/`. No timepicker/clock/date library installed at all (`package.json`). `radix-ui ^1.4.3` ships Popover/Slider already. Native was a **recorded decision** (`absence-hours-range/research.md:245-247`, `plan-brief.md:28`) and the ported design mockup itself uses native inputs (`new-design/10xUrlopy.dc.html:566,570`).                  | **WEAK**                                      |
| **D5 Locale rendering** — 12h AM/PM segment slowing entry        | `lang` churned `pl` → `en-GB` ("for 24h picker", `876a89b`) → `pl-PL` (`be75d00`, as a locale-correctness cleanup that undid the reason it was set). No test asserts the format. **User confirmed the field renders 24h `HH:MM`.**                                                                                                                                                                                                                               | **NONE** — ruled out                          |

## Narrowing Signals

- **Quarter-hour values + arrow/picker usage.** The single most decisive pair. The
  control offers 60 minute-values per hour; the user needs 4. This is a _granularity_
  defect, and it is invisible in the typed-entry path (4 keystrokes) that the initial
  investigation measured — it only bites via arrows, scroll, and the native dropdown.
- **24h render confirmed.** Kills D5 outright and removes the cheapest possible fix
  from the table.
- **Two symptoms, not one.** "Slow" (D1/D3) and "rewritten" (D2) have disjoint causes.
  A picker change addresses at most the first.
- **Silent clamping was a decision, not an oversight.** `absence-hours-window/frame.md:104-107`
  accepted it explicitly; `frame.md:133-134` logged "Silent-rewrite visibility" as an
  open item with "return the stored row" as the mitigation — which shipped server-side
  and is dropped by the client. The user hit the predicted cost one day after it landed.

## Cross-System Convention

The project has already run this exact loop once. On 2026-06-06, `9fcac6f` replaced the
native picker with a **custom text input** ("native `<input type="time">` format is
locale-controlled"); **three minutes later** `876a89b` deleted it and returned to native
with a one-attribute fix. The custom control's rationale evaporated once the real cause
was found. No record of _why_ survives outside the commit messages.

`AbsenceFormDialog.tsx` has churned on the hours area across four changes (S-09, S-14,
S-17, S-18). Convention for interactive controls is documented: shadcn primitives in
`src/components/ui/` (`CLAUDE.md:37`), hooks extracted to `src/components/hooks/`
(`CLAUDE.md:39`). shadcn has no canonical time-picker primitive, so `npx shadcn add`
does not cover this. Precedent for hand-rolling: `useRovingRadioGroup`
(`src/components/hooks/useRovingRadioGroup.ts:10-24`) exists _because_ S-17 replaced
Radix Selects with hand-rolled grids and had to rebuild the keyboard contract by hand.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the hours control exposes minute-level
> granularity and hides its own domain constraints, then silently corrects the user
> instead of telling them — so entry is laborious _and_ its result is untrustworthy.

The initial framing named a control shape; the evidence names a **granularity and
feedback** failure. The user enters quarter hours through a control offering 60 values
per hour with no `step`, no `min`, and no visible 06:00/8h window, and when the clamp
fires it changes the value on screen with nothing marking it as a change — the code
comment at `AbsenceFormDialog.tsx:85-86` claims this transparency, but nothing ships it.

**This does not veto the radial picker.** A dial snapped to quarter hours is a coherent
fit for this data, and the user has reaffirmed wanting one. But it is a _design choice
that must satisfy the reframed problem_, not a fix in itself: a radial picker that
doesn't snap to quarter hours, doesn't surface the legal window, and doesn't announce
corrections would reproduce both symptoms in a rounder shape — and would be the second
custom control this component has grown and possibly shed.

## Confidence

**HIGH** — every dimension carries file:line evidence; two decisive narrowing signals
(quarter-hour values, 24h render) ruled one dimension out entirely and reframed another;
the leading conclusion survived a pressure-test that independently surfaced the
2026-06-06 build-then-revert precedent.

## What Changes for /10x-plan

The plan is not "swap the control." It must resolve three things, and may resolve them
with a radial picker if that design satisfies all three:

1. **Granularity** — entry must match quarter-hour reality across _all three_ input paths
   the user actually uses (typing, arrows/scroll, pointer picker). Whatever ships must
   not regress the current 4-keystroke typed path.
2. **Constraint visibility** — the 06:00 floor and 8h cap must be apparent _during_
   entry, not enforced after it. `MIN_START_TIME` already exists to wire up.
3. **Correction feedback** — when the clamp changes a value, say so. The channel already
   exists (`toast`, imported at `:2`); the server already returns the corrected row and
   the client throws it away at `:140-141`.

**Blocking constraint the plan must account for**: the E2E suite is **currently red at
the setup project** (`context/changes/e2e-auth-locators/change.md:19-21`), so the three
specs that drive these inputs are not running. `absence-form-dialog.spec.ts:62-70,80-88`
uses `.fill("04:00")` + `toHaveValue("06:00")`, which assumes one focusable element
holding an `HH:MM` string — a segmented or dial control breaks these even though the
`getByLabel("Czas od")` locators survive. `tests/e2e/e2e-rules.md:40` codifies those
locators as convention and would need editing. **A control swap cannot be verified today.**

## References

- Control: `src/components/absence/AbsenceFormDialog.tsx:250-281` (markup), `:92-98` (clamp), `:140-141` (response discarded), `:66` (save gate)
- Domain rule: `src/lib/absence-hours.ts:29` (`MIN_START_TIME`), `:59-74` (`clampAbsenceHours`)
- Server: `src/pages/api/absences/index.ts:234-263`, `src/pages/api/absences/[id].ts:151-206`
- Prior decisions: `context/changes/absence-hours-window/frame.md:104-107,133-134`; `context/changes/absence-hours-range/research.md:245-247`
- Build-then-revert precedent: `9fcac6f` → `876a89b` (2026-06-06, 3 min apart); `be75d00` (`lang` repurposed)
- Test blast radius: `tests/e2e/absence-form-dialog.spec.ts:38-88`, `tests/e2e/e2e-rules.md:40,49`, `context/changes/e2e-auth-locators/change.md:19-33`
- Investigations: 3 parallel sub-agents (input mechanics; clamp feedback path; prior art & conventions), plus a git-history pressure-test
