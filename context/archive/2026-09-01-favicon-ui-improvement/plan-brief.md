# Palm-on-island brand mark, month-bar "today" control, and the `choroba` sub-caption — Plan Brief

> Full plan: `context/changes/favicon-ui-improvement/plan.md`
> Research: `context/changes/favicon-ui-improvement/research.md`

## What & Why

Three small, independent pieces of user-visible polish. The app still ships the stock
10x-Astro-Starter favicon and uses a generic lucide calendar glyph where a logo should be — it has no
brand mark of its own. Users browsing the dashboard months back have no way home except clicking the
arrow repeatedly. And `choroba` is ambiguous in the type picker: it covers both sick leave and
caring for a dependant, which the label does not say.

## Starting Point

`src/layouts/Layout.astro:24` is the app's only icon tag, pointing at a 733-byte starter PNG never
touched since the initial commit; the "app icon" on both login pages is a lucide `CalendarCheck`
duplicated byte-for-byte. `public/` additionally carries ~2.5 MB of dead scaffold artifacts that ship
to production. `MonthNav.astro` is 25 lines of JS-free Astro with two arrows and no third control.
Absence-type labels are 100% database-driven with no code-side label map, and the `choroba` label is
bound by eight E2E locators.

## Desired End State

Every page carries a palm-on-island mark — an open navy ring with a gold palm breaking through the
gap — in the tab and, at 80px, on both login screens, authored from one file. On the dashboard, a
third button appears beside the month arrows whenever you have navigated away from the current
month; hovering reads *"Wróć do bieżącego miesiąca"* and clicking returns you there with your tab and
subcard intact. In the add-absence dialog, `choroba` carries a small gray second line: *zwolnienie
lub opieka*.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Mark's gold | App token `#c5ac75`, not the image's `#CD9936` | The icon matches the moderator badge and hover states rather than introducing a second gold, and the NBP palette carries a documented do-not-nudge warning. | Plan |
| Icon format | SVG only, new filename `icon.svg` | Zero tooling (no `sharp`, which would break the offline tarball), crisp at every size, and a new name sidesteps `public/`'s absent cache headers. | Plan |
| Login tile | Extract `BrandMark.astro` | A multi-path SVG body is materially worse to duplicate than the one-line lucide import the prior decision weighed. | Plan |
| Month control | Right of `›`, unmounted on the current month | Keeps the heading's verified no-shift criterion intact, and matches the repo's "unmount, do not disable" rule used by three prior changes. | Plan |
| Tooltip mechanism | Native `title` + `aria-label` | Five sibling icon-only controls already pair both; Radix would make `MonthNav` the first React island in that region. | Research |
| Caption surface | Form-dialog type picker only | It is where the user is actually choosing a type, and it keeps the grid legend, XLSX export and their assertions out of scope. | Plan |
| Caption storage | Name-keyed map in `absence-types.ts` | One file versus a migration plus five test files, and the module is the sanctioned exception with the drift hazard already documented. | Plan |
| Scaffold cleanup | Bundled as Phase 0, scoped to `public/` | Same directory Phase 1 writes into, already logged as debt, removes ~2.5 MB from every build. | Plan |

## Scope

**In scope:** `public/icon.svg`; the favicon link and the stale `"10x Astro Starter"` default title in
`Layout.astro`; a new `BrandMark.astro` rendered by both login pages; a third button in `MonthNav.astro`
plus its URL in `dashboard.astro`; a caption map in `absence-types.ts` rendered in the form dialog;
one unit-test block and one E2E assertion; deletion of `public/template.png` and its `.scaffold`
siblings.

**Out of scope:** changing `--accent` or any palette token; a PNG fallback, apple-touch icon, manifest
or Open Graph tags; a brand mark in the top bar; converting the `‹`/`›` glyphs to icons; a Radix
tooltip; any schema, migration or seed change; the caption on the grid legend, details table, grid
cells, tooltips, stats or XLSX export; the 42 source-tree `.scaffold` files and `public/.assetsignore`.

## Architecture / Approach

`public/icon.svg` is the single authored source; `BrandMark.astro` carries the same shapes inline for
the login tile, with a comment naming the twin. The favicon link keeps its mandatory `withBase()`
form — a source-text test fails the build on a literal `href="/…"`. The month control is an `<a>` with
a query-only relative href computed in `dashboard.astro` alongside the existing prev/next URLs,
returning `null` when already on the current month so the component renders nothing; no client-side
state, no hydration. The caption comes from a name-keyed lookup beside the two rules already living
in `absence-types.ts`, rendered as a second line inside the picker's radio button.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 0. `public/` cleanup | ~2.5 MB of dead scaffold artifacts removed from every build and tarball | Deleting something that turns out to be referenced — mitigated by verified zero hits across build config, scripts and `.gitignore` |
| 1. Brand mark | `icon.svg` as favicon + `BrandMark.astro` on both login pages; stale default title fixed | The mark's navy ring sits on a navy tile — the treatment has to be decided by eye; and the sign-in page carries CI copy assertions that must not be disturbed |
| 2. Month control | "Wróć do bieżącego miesiąca" button, hidden on the current month | The row is `justify-between`, so the button appearing shifts the tab pill slightly; the month heading itself must not move |
| 3. `choroba` caption | Gray second line in the type picker, plus unit and E2E coverage | The caption joins the radio's accessible name; six E2E locators match by substring and should survive, but this must be run, not assumed |

**Prerequisites:** Node 24 (`.nvmrc`), a local SQLite database (`npm run db:bootstrap`), and for the
E2E phases `npm run seed:e2e` — the Playwright credentials were minted against Supabase and a fresh
SQLite file fails at sign-in. Always run E2E as `BASE_URL=http://localhost:4321 npm run e2e`; the
config's default `baseURL` still points at `main`'s deployment.

**Estimated effort:** ~1–2 sessions across four phases. Phase 1's SVG authoring is the only
open-ended part; the other three are under an hour each.

## Open Risks & Assumptions

- **The mark is hand-authored SVG.** There is no design file and no rasterizer in the repo, so the
  palm's legibility at 16px is only knowable by looking at it. Expect one or two iterations.
- **Navy mark on a navy tile.** The login tile is `bg-primary`; the mark's ring is the same navy. The
  plan defers the treatment (white ring variant vs letting the gold palm carry it) to visual
  inspection in Phase 1 rather than guessing now.
- **SVG favicon excludes Safari below 16** — those users see the browser's default placeholder. Taken
  deliberately; the alternative fallback was the starter icon, which is worse than none.
- **`captionFor` becomes the fourth name-keyed rule** in `absence-types.ts`. A future rename of the
  `choroba` seed row silently drops the caption; the new unit test is the guard against that.
- **E2E does not run in CI** (`.github/workflows/ci.yml` has no Playwright step), so Phases 2 and 3
  depend on the suite being run locally.

## Success Criteria (Summary)

- A user opening the app sees a palm-on-island mark in the browser tab and on the login screen —
  the app's own identity, not a framework default.
- A user who has browsed to a past month can get back to today in one click, and cannot see a
  control that does nothing when already there.
- A user choosing an absence type can tell that `choroba` covers care leave as well, without leaving
  the dialog.
