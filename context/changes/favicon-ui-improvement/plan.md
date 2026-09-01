# Palm-on-island brand mark, month-bar "today" control, and the `choroba` sub-caption — Implementation Plan

## Overview

Three independent, small sub-changes bundled because they are all user-visible polish on the
dashboard and login surfaces:

1. **A palm-on-island brand mark** in the WRIFboard visual language (open navy ring, flat
   two-colour, a gold element breaking out of the ring), authored once as `public/icon.svg` and used
   both as the favicon and as the login-screen icon tile — replacing the stock 10x-Astro-Starter PNG
   that has never been touched, and the lucide `CalendarCheck` glyph currently standing in for a logo.
2. **A "Wróć do bieżącego miesiąca" control** in the month navigation bar, returning the dashboard to
   the current month and year.
3. **A gray "zwolnienie lub opieka" sub-caption** under `choroba` in the absence-type picker.

A fourth phase runs first: deleting the dead `public/` scaffold artifacts that ship to production
today. It is adjacent debt, already logged and never actioned, and it clears the directory Phase 1
writes into.

## Current State Analysis

**Brand.** `src/layouts/Layout.astro:24` holds the app's only icon tag, pointing at
`public/favicon.png` — 733 bytes, 32×32, the stock starter icon from the initial commit, never
modified. There is no manifest, no apple-touch icon, no Open Graph tag, no SVG favicon, no logo
component, no brand image asset and not a single `<img>` in `src/`. What plays the role of an app
icon is a navy tile holding a lucide `CalendarCheck` glyph, **byte-identical** in
`src/pages/index.astro:20-26` and `src/pages/auth/signin.astro:15-21`. `Layout.astro:12` still
defaults the page title to the scaffold string `"10x Astro Starter"`.

`public/` also carries live dead weight that ships to `dist/client/` and into every offline tarball:
`template.png` (1.27 MB, unreferenced starter cruft) and its `.scaffold` duplicate (another 1.27 MB),
plus `favicon.png.scaffold` and `.assetsignore.scaffold`. These were flagged for deletion at
`context/archive/2026-08-25-sqlite-install/research.md:147-149` and never removed.

**Palette.** `src/styles/global.css:9-46` is a documented NBP brand palette carrying an explicit
do-not-nudge warning. Its navy `--primary: #072143` is effectively identical to the reference
image's `#032041`; its gold `--accent: #c5ac75` is visibly **not** the reference's `#CD9936` —
muted and desaturated where the reference is saturated and dark. There is deliberately no dark mode
(`global.css:48-58`), so the mark needs one light treatment only.

**Month bar.** `src/components/MonthNav.astro` is 25 lines, server-rendered, zero JS: two `<a>`
elements carrying literal `‹` / `›` glyphs around a fixed-width `<h1>`. Month state is a
`?month=YYYY-MM` query param parsed at `src/pages/dashboard.astro:27-33` — and **the
default-to-current-month path already exists** as the ternary there. Navigation is full page loads
by design; URLs are query-only relative strings computed in Astro
(`dashboard.astro:201-216`), preserving the sibling `tab` and `subcard` params.

**Absence types.** The catalogue is 100% database-driven (`src/db/schema.ts:68-82`, seeded from
`src/db/seed.ts:18-32`); there is no `description` column and no code-side label map anywhere. The
schema comment at `:76-78` states the principle — _"Types stay data, never a name-keyed code map"_ —
while `src/lib/absence-types.ts` is the sanctioned exception, already carrying two such rules with a
header documenting the drift hazard. The rendered label is lowercase `choroba`.

**Test surface.** No `.astro` component tests exist. The E2E suite has 8 `choroba` references in
`tests/e2e/absence-grid-range.spec.ts`, and the locator policy forbids testids
(`tests/e2e/e2e-rules.md:5-7`) — rendered copy _is_ the test contract.

## Desired End State

- Every page emits a favicon showing a palm on an island inside a broken navy ring, drawn in the
  app's own navy and gold. Both login pages show the same mark, at 80px, in place of the calendar
  glyph — sourced from one file so favicon and login mark cannot drift.
- On the dashboard, a third button sits to the right of the next-month arrow whenever the user has
  navigated away from the current month. Hovering it reads _"Wróć do bieżącego miesiąca"_; clicking
  it reloads the dashboard on today's month and year with the active tab and subcard intact. On the
  current month the button is not in the DOM.
- In the add-absence dialog's type picker, `choroba` carries a small gray second line reading
  _zwolnienie lub opieka_. No other surface changes.
- `dist/client/` no longer carries ~2.5 MB of scaffold artifacts.

Verify by: loading `/auth/signin` (mark in the tab and in the tile), navigating the dashboard two
months back and clicking the return button, and opening the add-absence dialog.

### Key Discoveries:

- **`href="/…"` literals fail the test suite.** `src/tests/lib/base-path-coverage.test.ts:22-29` is a
  source-text scan over every `.ts/.tsx/.astro` under `src/` that forbids `href="/…"` and `src="/…"`.
  The icon link must stay in the `href={withBase("/icon.svg")}` form (`src/lib/base-path.ts:30-32`).
- **No rasterizer, and none may be added.** `scripts/pack-artifact.mjs:31-35` documents that `sharp`
  and `@img` are build-only and absent from the tarball, and that the app uses no `astro:assets` at
  all. An SVG in `public/` is the only zero-tooling path.
- **`public/` gets no cache headers.** `deploy/nginx/urlopy.conf:51-63` applies `immutable` caching to
  `/_astro/` only, so replacing `favicon.png` in place is subject to browser heuristic caching. A new
  filename sidesteps it entirely.
- **The month heading must not shift.** A verified success criterion from
  `context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:278` — _"Month nav heading does not shift
  horizontally when stepping between months"_ — which is why the new control goes outside the
  `‹ heading ›` triplet.
- **Unmount, do not disable.** Three prior changes settled this
  (`priority-absence-flag/plan.md:434-436`, `grid-multicheck/research.md:391-394`,
  `grid-bulk-delete/plan-brief.md:46`).
- **The E2E `choroba` radio locators survive.** `getByRole("radio", { name: "choroba" })` matches by
  case-insensitive substring, so growing the accessible name to `choroba zwolnienie lub opieka` keeps
  them passing and unique. The two `getByText("choroba", { exact: true })` assertions at
  `absence-grid-range.spec.ts:203,274` target the confirm-list row
  (`AbsenceFormDialog.tsx:665-676`), a **different** render site that this change does not touch.
- **There are 45 `.scaffold` files repo-wide**, not the six the research listed — but only three sit
  under `public/` and therefore reach `dist/client/`. The other 42 are source-tree siblings that
  never ship (the tarball's `CONTENTS` at `scripts/pack-artifact.mjs:60` is `dist`, `node_modules`,
  `package.json`, `deploy`, the installers and `INSTALL.md`).
- **This is consistent with a recorded brand decision, not a reversal of one.**
  `context/archive/2026-08-06-main-page-redesign/frame.md:22` and `plan.md:125-127` chose to adopt the
  WRIFboard _visual style_ while keeping our own identity — _"not the mockup's market chart"_. A palm
  on an island is exactly that: the same visual language, a subject appropriate to a leave app.

## What We're NOT Doing

- **Not changing `--accent`.** The mark uses the app's existing gold `#c5ac75`, not the reference
  image's `#CD9936`. Retuning the token would be a repo-wide visual change to a documented corporate
  palette.
- **Not shipping a PNG fallback, an apple-touch icon, a manifest, or Open Graph tags.** SVG only. See
  Migration Notes for the browser-support consequence.
- **Not adding a brand mark to the top bar.** `src/components/account/AccountMenu.tsx:14-15` locks that
  bar's layout, and the brief did not ask.
- **Not touching the `‹` / `›` glyphs.** Converting them to lucide chevrons is a defensible
  improvement and explicitly out of scope here.
- **Not adding a Radix tooltip to `MonthNav`.** Native `title` + `aria-label` — see Implementation
  Approach.
- **Not adding a `description` column to `absence_types`,** and not adding a `code`/`slug` column
  (proposed and declined three times, `priority-absence-flag/plan.md:143-152`).
- **Not putting the caption on the grid legend, the details chip, the grid cell, tooltips,
  aria-labels, stats, or the XLSX export.** The form-dialog picker only. This keeps
  `src/lib/export-workbook.ts` and its legend assertions out of scope.
- **Not deleting the 42 source-tree `.scaffold` files** listed above, and **not deleting
  `public/.assetsignore`** — see the deviation note in Phase 0.
- **No client-side navigation.** The month control is an `<a href>`, consistent with
  `huge-ui-ux-improvement/plan.md:238-239` (_"a restyle of anchors, not a move to client state"_).

## Implementation Approach

Four independent phases, ordered cheapest-first within each risk tier. Phase 0 clears `public/`
before Phase 1 writes into it. Phases 2 and 3 touch entirely separate files and could be reordered
freely.

Two mechanism decisions were made from codebase evidence rather than put to the user:

**Tooltip: native `title` + `aria-label`.** Five sibling icon-only controls already pair both
deliberately (`EmployeeManagementSheet.tsx:163-164,175-176`, `AccountMenu.tsx:26`,
`AbsenceDetailsTable.tsx:246`, `AbsenceGrid.tsx:518`). The Radix primitive at
`src/components/ui/tooltip.tsx` exists but has never been used from an `.astro` file — adopting it
here would make `MonthNav` the first React island in that region, an architectural step out of
proportion to a hover string. (This supersedes `huge-ui-ux-improvement/plan.md:534-537`, whose
stated reason — "no tooltip primitive is installed" — is now stale; the conclusion still holds for a
different reason.)

**Mark design.** Two flat colours, no gradients, transparent background, mirroring the reference's
structure: navy carries the static frame, gold carries the single dynamic element that escapes the
ring. Concretely — navy open ring with the gap in the upper-right quadrant, navy island mound on the
lower ring interior; gold palm trunk curving up and to the right out of the mound, gold fronds
crowning it, with the upper-right frond crossing the ring gap the way the reference's arrow does.

## Critical Implementation Details

**Selected-state bold bleeds into the caption.** The type-picker button applies `font-bold` to the
whole button when selected (`AbsenceFormDialog.tsx:709`). A caption nested inside it inherits that,
which defeats the visual hierarchy. The caption span needs an explicit `font-normal`.

**The caption changes row height in a 2-column grid.** The picker is `grid grid-cols-2`
(`AbsenceFormDialog.tsx:692`) and `choroba` is seed order 4 — the right-hand cell of row 2. Grid
items stretch, so its row partner (`szkolenie w miejscu pracy`) grows to match. This is expected and
acceptable; do not fight it with fixed heights.

**The sign-in page carries a CI copy assertion.** `.github/workflows/ci.yml:90,108` greps the rendered
sign-in HTML for `Użytkownik / ID`, `Hasło`, `for="email"`, `for="password"`, and **counts** at least
two occurrences of `Zaloguj się`. Phase 1 edits `src/pages/auth/signin.astro`; none of those strings
may be disturbed.

**The new month control's accessible name must not collide.** `tests/e2e/setup/auth.setup.ts:48`
resolves `getByRole("link", { name: "Siatka" })` as the readiness check for the whole suite, and
Playwright's `name` matches by substring. `Wróć do bieżącego miesiąca` contains neither `Siatka`,
`Poprzedni miesiąc`, nor `Następny miesiąc`, so it is clear — verify this holds if the copy is
reworded.

---

## Phase 0: Clear the dead `public/` artifacts

### Overview

Delete the unreferenced starter files under `public/` that are copied verbatim into `dist/client/`
and served publicly today. Removes ~2.5 MB from every build and every offline tarball, and clears the
directory Phase 1 writes into.

### Changes Required:

#### 1. Dead assets under `public/`

**Files**: `public/template.png`, `public/template.png.scaffold`, `public/favicon.png.scaffold`,
`public/.assetsignore.scaffold`

**Intent**: Delete all four. `template.png` (1.27 MB) is unreferenced starter cruft with zero hits
across `src/`, `tests/`, `deploy/`, `README.md`, `INSTALL.md` and `install.sh`; the three `.scaffold`
siblings are `/10x-bootstrapper` conflict-preservation artifacts whose review step never happened.
Nothing in build config, eslint, prettier, `.gitignore` or any script references them.

**Contract**: Pure deletion — no file gains or loses a reference. `public/favicon.png` stays in place
for now and is removed in Phase 1, after the icon link has been swapped.

**Deviation from the option as worded**: `public/.assetsignore` itself is **kept**. It is a
Cloudflare Workers static-assets directive, inert under the Node adapter (`astro.config.mjs:85`), but
`CLAUDE.md` explicitly batches the removal of Cloudflare artifacts (`@astrojs/cloudflare`,
`wrangler`, `wrangler.jsonc`, `supabase/`) into a separate follow-up change after the demo. Removing
one of that set here, at 24 bytes, would fragment that cleanup for no gain. Its `.scaffold` duplicate
is deleted as scaffold debt.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`
- Production build succeeds: `npm run build`
- No deleted file survives in the build output: `ls dist/client/` shows no `template.png` and no `*.scaffold`
- Offline artifact still packs: `npm run pack`

#### Manual Verification:

- `npm run dev` — the dashboard and both login pages render unchanged, and the old favicon still appears in the browser tab (Phase 1 has not run yet)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 1: The palm-on-island brand mark

### Overview

Author the mark once as an SVG in `public/`, point the favicon at it, wrap it in a component, and
render that component in both login pages. Retire the starter PNG and the stale default title.

### Changes Required:

#### 1. The mark itself

**File**: `public/icon.svg` (new)

**Intent**: Hand-author the palm-on-island mark, in the reference image's visual language, using the
app's own palette. This one file is the source for both the favicon and the login tile.

**Contract**: A standalone SVG, `viewBox="0 0 512 512"`, transparent background, exactly two fill/stroke
colours as literal hex (a `public/` asset cannot read CSS custom properties):

- Navy `#072143` — the open ring and the island mound.
- Gold `#c5ac75` — the palm trunk and fronds.

Geometry, matched to the measurements taken from the reference:

- **Ring**: centred, radius ≈ 238, `stroke-width` ≈ 19 — i.e. 3.6% of the icon width, the measured
  reference ratio (~18px on a ~495px diameter). `fill="none"`, round caps. **Open**, with the gap in
  the upper-right quadrant.
- **Island**: a navy mound sitting on the lower interior of the ring, flat-bottomed, spanning roughly
  the middle half of the diameter. Solid fill, no outline, no gradient.
- **Palm**: a gold trunk rising from the mound and curving up and to the right, crowned with fronds.
  The upper-right frond **crosses the ring gap and extends past the ring**, the structural analogue of
  the reference's escaping arrow. Nothing else breaks the ring.
- No text, no third colour, no gradients, no filters, no embedded raster.

Legibility check the shape must survive: at 16 × 16 it should still read as a dark ring with a gold
form inside it. Simplify frond count until it does.

#### 2. The favicon link

**File**: `src/layouts/Layout.astro`

**Intent**: Point the single `<link rel="icon">` at the new SVG, and replace the stale scaffold
default title.

**Contract**: Line 24 becomes `type="image/svg+xml"` with `href={withBase("/icon.svg")}` — the
`withBase()` form is mandatory (see Key Discoveries). Line 12's default title changes from
`"10x Astro Starter"` to `"Nieobecności"`; no page relies on the default today
(`index.astro:16`, `auth/signin.astro:11` and `dashboard.astro:230` all pass an explicit title), but
it is the fallback any new page inherits.

#### 3. The shared mark component

**File**: `src/components/BrandMark.astro` (new)

**Intent**: Hold the mark inline as SVG markup for the login tile, so the tile and the favicon are
authored once. Extracting a component reverses the decision at
`huge-ui-ux-improvement/plan.md:309-310` (which accepted duplicating ~20 lines across the two login
pages) — the balance tipped because that decision weighed duplicating a one-line lucide _import_,
whereas this is a multi-path SVG body that would have to be kept in sync by hand.

**Contract**: Takes an optional `class` prop forwarded to the root `<svg>` so the caller sets the
size. The SVG is decorative — the adjacent `<h1>Nieobecności</h1>` already names it — so it carries
`aria-hidden="true"` and no `role`/`<title>`. Its markup must stay byte-equivalent to
`public/icon.svg`'s shapes; add a comment naming that file as the twin so a future edit updates both.

#### 4. Both login pages

**Files**: `src/pages/index.astro`, `src/pages/auth/signin.astro`

**Intent**: Swap the lucide `CalendarCheck` glyph inside the navy tile for `BrandMark`, and drop the
now-unused import.

**Contract**: The surrounding tile keeps its existing classes verbatim — `bg-primary mb-4 inline-flex
size-20 items-center justify-center rounded-2xl shadow-lg shadow-slate-200` — so the login card's
geometry does not move. `BrandMark` renders at `size-10` in place of the glyph. Because the mark's
navy ring sits on the navy tile, the ring must read: either render the mark's navy strokes as white
on the tile (a `class`-driven variant) or keep the tile and let the gold palm carry the contrast —
decide by looking at it, and record which in the phase's manual verification. Remove the
`CalendarCheck` import at `index.astro:4` and `signin.astro:4`. Do not touch any other copy on
`signin.astro` — the CI grep asserts on it.

#### 5. Retire the starter PNG

**File**: `public/favicon.png`

**Intent**: Delete, now that nothing links to it.

**Contract**: Pure deletion. Requests for `/favicon.png` from a stale bookmark 404 harmlessly through
`try_files $uri @app` (`deploy/nginx/urlopy.conf:65-68`).

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Formatting is clean: `npm run format`
- No app-absolute path bypasses `withBase()`: `npm run test` (`src/tests/lib/base-path-coverage.test.ts` specifically)
- Production build succeeds and emits the asset: `npm run build` then `ls dist/client/icon.svg`
- Offline artifact packs: `npm run pack`
- Sign-in copy assertions still pass: the CI `ci` job's smoke-test step

#### Manual Verification:

- The new mark appears in the browser tab on `/`, `/auth/signin` and `/dashboard`
- The mark is legible in the tab strip at favicon size — the palm is distinguishable, not a blur
- Both login pages show the mark in the navy tile, vertically aligned as the calendar glyph was, with the card geometry unchanged
- The chosen tile treatment (white ring vs navy ring on navy) is recorded in the phase notes
- The page title on a bare load reads `Nieobecności`, not `10x Astro Starter`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 2: "Wróć do bieżącego miesiąca"

### Overview

Add a third button to the month bar that returns to the current month, rendered only when the user
has navigated away from it.

### Changes Required:

#### 1. The control

**File**: `src/components/MonthNav.astro`

**Intent**: Render a return-to-today button to the right of the next-month arrow when a URL for it is
supplied, and nothing at all when it is not.

**Contract**: A new optional prop `currentMonthUrl?: string | null` on the existing `Props` interface.
When it is a non-empty string, render a third `<a>` **after** the next-month arrow, inside the same
`flex items-center gap-4` wrapper — outside the `‹ heading ›` triplet, so the heading's `min-w-[220px]`
no-shift criterion is untouched. When it is null/absent, render nothing (unmount, do not disable —
an `<a>` cannot be disabled anyway).

The button reuses the existing `navButton` class string verbatim, so its 36 × 36 geometry,
`rounded-[10px]`, hairline border and navy-fill hover behaviour match its two siblings exactly. Its
content is a lucide `RotateCcw` at `className="size-4"` — lucide already renders unhydrated from
`.astro` files (`index.astro:4`), and `size-4` is the established sizing inside a `size-9` button. It
carries **both** `title="Wróć do bieżącego miesiąca"` and `aria-label="Wróć do bieżącego miesiąca"`
(note the diacritic — the brief's `Wróc` is a typo; UI copy is never ASCII-folded).

#### 2. Computing the URL and the condition

**File**: `src/pages/dashboard.astro`

**Intent**: Derive today's month string, compare it against the browsed month, and pass a URL only
when they differ.

**Contract**: Alongside the existing `prevMonthUrl` / `nextMonthUrl` construction at `:201-216`, add a
current-month string built from the `now` already in scope at `:29`, and a `currentMonthUrl` that is
`null` when it equals the existing `monthStr` (`:199`). When non-null it follows the identical
query-only relative form as its siblings — including the `currentTab === "details"` branch that
carries `&subcard=${currentSubcard}` forward. Query-only relative URLs inherit the mount prefix
automatically, which is why `withBase()` is deliberately _not_ used here. Pass it into `<MonthNav>`
at `:263`.

Note that `?month=<current>` is emitted explicitly rather than omitting the param: the app would
default to the current month either way (`:31-33`), but an explicit param keeps the produced URL
self-describing and identical in shape to the two sibling links.

### Success Criteria:

#### Automated Verification:

- Linting and type-checked rules pass: `npm run lint`
- Unit tests pass: `npm run test`
- Production build succeeds: `npm run build`
- E2E suite passes: `npm run seed:e2e` then `BASE_URL=http://localhost:4321 npm run e2e` (the default `baseURL` still points at `main`'s deployment — do not run it bare)

#### Manual Verification:

- On `/dashboard` with no `month` param the button is absent from the DOM, not merely invisible
- After stepping back two months the button appears; hovering it shows _"Wróć do bieżącego miesiąca"_
- Clicking it lands on the current month and year
- The active tab survives the click on all three tabs, and on `Szczegóły` the active subcard survives too
- Stepping between a long month name and a short one still does not shift the heading horizontally
- The button's border, radius, size and navy-fill hover are indistinguishable from the `‹` and `›` buttons
- Keyboard: the button is reachable by Tab and activates on Enter

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 3: The `choroba` sub-caption

### Overview

Add _zwolnienie lub opieka_ as a gray second line under `choroba` in the add-absence dialog's type
picker, sourced from a name-keyed map beside the two rules that already live there.

### Changes Required:

#### 1. The caption source

**File**: `src/lib/absence-types.ts`

**Intent**: Add a third name-keyed rule — a caption lookup — beside `PARTIAL_DAY_TYPE_NAMES` and
`PRIORITY_TYPE_NAMES`.

**Contract**: A `SICK_LEAVE_TYPE_NAME = "choroba"` constant (verbatim from `src/db/seed.ts:25`), a
`TYPE_CAPTIONS` readonly map keyed by seed name, and a `captionFor(typeName): string | undefined`
accessor that tolerates `null`/`undefined` like its two siblings. Extend the module header comment:
it currently says the file carries _"two independent rules"_ — that count and the rename-mirroring
warning must both cover the new one.

This is the **fourth** sanctioned name-keyed exception. The alternative — a nullable `description`
column on `absence_types` — honours the _"types stay data"_ principle at `src/db/schema.ts:76-78`
more directly, but pulls in a drizzle migration (with the SQLite CHECK/`COLLATE NOCASE`
regeneration hazard `CLAUDE.md` warns about), `src/db/seed.ts`, `scripts/export-sample.ts` and roughly
five test files, for one string. Recorded here so the trade is explicit rather than accidental.

#### 2. Rendering it

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Render the caption as a second line under the type name inside the picker's radio button,
for the types that have one.

**Contract**: The `<span className="min-w-0 flex-1">{type.name}</span>` at `:726` becomes a column
stack: the name on the first line, and — only when `captionFor(type.name)` returns a value — a second
line. The caption span is `text-muted-foreground text-[11px] font-normal`; `font-normal` is
load-bearing because the selected button applies `font-bold` to its whole subtree (see Critical
Implementation Details), and `text-[11px]` against the button's `text-[13px]` keeps the same size
ratio the repo's two stacked-caption precedents use (`AbsenceDetailsTable.tsx:224-227`,
`AbsenceStats.tsx:209`). Use `text-muted-foreground`, not `text-gray-*` — the repo has 68 usages of
the token and effectively none of the raw utility.

The button's own classes, the icon chip, the `✓` span and the roving-tabindex wiring are untouched.
No other renderer of `type.name` changes.

#### 3. Unit coverage for the map

**File**: `src/tests/lib/absence-types.test.ts`

**Intent**: Guard the same drift the file's two existing rules are guarded against — a seed rename
that silently drops the caption.

**Contract**: A new `describe` block asserting every key of `TYPE_CAPTIONS` exists in
`ABSENCE_TYPE_SEED` (the pattern already used at `:12-17`), that `captionFor("choroba")` returns the
exact string `"zwolnienie lub opieka"`, and that `captionFor` returns `undefined` for an uncaptioned
seed type, an unknown name, `null` and `undefined`.

#### 4. Recording the copy change in E2E

**File**: `tests/e2e/absence-form-dialog.spec.ts`

**Intent**: Assert the new content explicitly, so the copy growth is recorded as intentional rather
than silently absorbed by substring matching.

**Contract**: One added assertion inside the existing dialog-open flow, checking that the `choroba`
radio is visible by its grown accessible name. Add a `Risk:` line to the file's header comment block
in the established style.

The eight `choroba` locators in `tests/e2e/absence-grid-range.spec.ts` need **no change**: the six
`getByRole("radio", { name: "choroba" })` uses match by case-insensitive substring and stay unique,
and the two `getByText("choroba", { exact: true })` uses at `:203,274` target the confirm-list row
(`AbsenceFormDialog.tsx:665-676`), a different render site this change does not touch. Confirm both
claims by running the suite rather than by reading.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Unit tests pass, including the new `absence-types` block: `npm run test`
- Production build succeeds: `npm run build`
- E2E suite passes unchanged apart from the added assertion: `BASE_URL=http://localhost:4321 npm run e2e`

#### Manual Verification:

- The add-absence dialog shows _zwolnienie lub opieka_ in gray beneath `choroba`
- The caption does **not** turn bold when `choroba` is the selected type
- The caption appears on `choroba` only — no other type gains a second line
- The picker's two-column layout still aligns; the taller row is even and nothing overflows the dialog
- The grid legend, the details table, the grid cells, the stats view and the XLSX export are unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- `src/tests/lib/absence-types.test.ts` — caption keys exist in the seed catalogue; `captionFor`
  returns the exact string for `choroba` and `undefined` for everything else, including `null`,
  `undefined` and an unknown name.
- `src/tests/lib/base-path-coverage.test.ts` — already exists; it is the gate on Phase 1's icon link
  and needs no change, only to keep passing.

### Integration Tests:

None. There is no API surface, no database change, and no `.astro` component test harness in this
repo.

### Manual Testing Steps:

1. `npm run dev`, load `/auth/signin` — the palm mark is in the tab and in the navy tile; the card
   geometry has not moved; the sign-in form is untouched.
2. Sign in, land on `/dashboard` — no return button is present on the current month.
3. Click `‹` twice — the return button appears; hover it and read _"Wróć do bieżącego miesiąca"_.
4. Click it — the dashboard is back on the current month; the button is gone again.
5. Repeat step 3–4 on the `Szczegóły` tab with a non-default subcard — both survive the round trip.
6. Step between `luty` and `wrzesień` — the heading does not move horizontally.
7. Open the add-absence dialog on an empty cell — `choroba` carries a gray second line; select it and
   confirm the caption stays non-bold; check no other type has one.
8. Switch to `Statystyki` and to `Szczegóły`, and export the XLSX — no caption appears anywhere else.

## Performance Considerations

Negligible, and one small improvement. Phase 0 removes ~2.5 MB from `dist/client/` and every offline
tarball. The SVG mark is a few hundred bytes against the 733-byte PNG it replaces, inlined once more
on each login page. Phase 2 adds one anchor and one static lucide glyph to a server-rendered
component, with no hydration and no new request. Phase 3 adds one text node inside an already-mounted
dialog.

## Migration Notes

**No data migration.** No schema change, no seed change, no drizzle migration — a direct consequence
of the caption-storage decision.

**Favicon caching.** `public/` assets carry no cache headers (`deploy/nginx/urlopy.conf:51-63`), so a
replaced `favicon.png` would have been subject to browser heuristic caching. Shipping under the new
name `icon.svg` sidesteps that; returning users pick the new mark up on their next load.

**SVG favicon browser support.** Chrome 80+, Firefox 41+, Edge 80+ and Safari 16+ render an SVG
favicon; older Safari shows the browser's default placeholder rather than a wrong icon. Accepted
deliberately — the alternative fallback would be the stock 10x-Astro-Starter PNG, which is worse than
none. If a PNG fallback is wanted later, rasterize it out-of-band with ImageMagick and add a second
`<link>`; `sharp` must not become a dependency (`scripts/pack-artifact.mjs:31-35`).

**Deployment.** Nothing changes. `astro build` copies `public/**` into `dist/client/` verbatim,
`scripts/build-artifact.mjs` is purely additive, `scripts/pack-artifact.mjs:60` excludes nothing under
`dist/`, and nginx serves it through `try_files $uri @app`. No build-script, packaging or nginx edit
is required by any phase.

**Rollback.** Every phase is a self-contained commit and reverts cleanly. Phase 0 and Phase 1 delete
files, so a revert restores them from git; nothing is destroyed outside version control.

## References

- Research: `context/changes/favicon-ui-improvement/research.md`
- Change identity: `context/changes/favicon-ui-improvement/change.md`
- Style reference: `context/changes/favicon-ui-improvement/reference-icon.webp`
- Brand decision this follows: `context/archive/2026-08-06-main-page-redesign/frame.md:22`, `plan.md:125-127`
- Month-bar geometry and the no-shift criterion: `context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:237-253`, `:278`
- Login-tile duplication decision this reverses: `context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:309-310`
- Name-keyed rules as the sanctioned exception: `context/archive/2026-08-31-priority-absence-flag/plan.md:143-152`
- Unmount-do-not-disable: `context/archive/2026-08-31-priority-absence-flag/plan.md:434-436`
- Copy-change discipline in tests: `context/archive/2026-08-11-e2e-auth-locators/plan.md:72-73`
- Debt already logged: `context/archive/2026-08-25-sqlite-install/research.md:147-149`
- Stacked-caption precedents: `src/components/absence/AbsenceDetailsTable.tsx:224-227`, `src/components/absence/AbsenceStats.tsx:209`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 0: Clear the dead `public/` artifacts

#### Automated

- [x] 0.1 Linting passes: `npm run lint` — 3c45191
- [x] 0.2 Unit tests pass: `npm run test` — 3c45191
- [x] 0.3 Production build succeeds: `npm run build` — 3c45191
- [x] 0.4 No deleted file survives in the build output — 3c45191
- [x] 0.5 Offline artifact still packs: `npm run pack` — 3c45191

#### Manual

- [x] 0.6 Dashboard and both login pages render unchanged; old favicon still in the tab — 3c45191

### Phase 1: The palm-on-island brand mark

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 9eed7df
- [x] 1.2 Formatting is clean: `npm run format` — 9eed7df
- [x] 1.3 No app-absolute path bypasses `withBase()` — 9eed7df
- [x] 1.4 Production build succeeds and emits `dist/client/icon.svg` — 9eed7df
- [x] 1.5 Offline artifact packs: `npm run pack` — 9eed7df
- [x] 1.6 Sign-in copy assertions still pass — 9eed7df

#### Manual

- [x] 1.7 The new mark appears in the browser tab on all three pages — 9eed7df
- [x] 1.8 The mark is legible at favicon size — 9eed7df
- [x] 1.9 Both login pages show the mark in the navy tile with card geometry unchanged — 9eed7df
- [x] 1.10 The chosen tile treatment is recorded in the phase notes — 9eed7df
- [x] 1.11 Default page title reads `Nieobecności` — 9eed7df

### Phase 2: "Wróć do bieżącego miesiąca"

#### Automated

- [x] 2.1 Linting and type-checked rules pass: `npm run lint`
- [x] 2.2 Unit tests pass: `npm run test`
- [x] 2.3 Production build succeeds: `npm run build`
- [x] 2.4 E2E suite passes against localhost

#### Manual

- [x] 2.5 Button absent from the DOM on the current month
- [x] 2.6 Button appears after navigating away; hover text reads correctly
- [x] 2.7 Clicking it lands on the current month and year
- [x] 2.8 Active tab and subcard survive the click
- [x] 2.9 Month heading still does not shift horizontally
- [x] 2.10 Button styling is indistinguishable from `‹` and `›`
- [x] 2.11 Button is Tab-reachable and activates on Enter

### Phase 3: The `choroba` sub-caption

#### Automated

- [ ] 3.1 Linting passes: `npm run lint`
- [ ] 3.2 Unit tests pass, including the new `absence-types` block
- [ ] 3.3 Production build succeeds: `npm run build`
- [ ] 3.4 E2E suite passes with the added assertion

#### Manual

- [ ] 3.5 Gray caption renders beneath `choroba` in the type picker
- [ ] 3.6 Caption does not turn bold when `choroba` is selected
- [ ] 3.7 No other type gains a second line
- [ ] 3.8 Two-column picker layout still aligns; nothing overflows
- [ ] 3.9 Legend, details, grid cells, stats and XLSX are unchanged
