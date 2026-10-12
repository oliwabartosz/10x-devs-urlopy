---
date: 2026-09-01T14:34:09+02:00
researcher: bartorelli-omarchy
git_commit: 69f7cda1f220ccf3fab5433ac80f50b890ea2bcf
branch: main
repository: 10x-devs-urlopy
topic: "New palm-on-island favicon and app icon, plus month-bar and absence-type copy tweaks"
tags: [research, codebase, branding, favicon, month-nav, absence-types, copy]
status: complete
last_updated: 2026-09-01
last_updated_by: bartorelli-omarchy
---

# Research: New palm-on-island favicon and app icon, plus month-bar and absence-type copy tweaks

**Date**: 2026-09-01T14:34:09+02:00
**Researcher**: bartorelli-omarchy
**Git Commit**: `69f7cda1f220ccf3fab5433ac80f50b890ea2bcf`
**Branch**: `main`
**Repository**: `10x-devs-urlopy` (`git@github.com:oliwabartosz/10x-devs-urlopy.git`)

> Permalink base for any reference below (HEAD is pushed to `origin/main`):
> `https://github.com/oliwabartosz/10x-devs-urlopy/blob/69f7cda1f220ccf3fab5433ac80f50b890ea2bcf/<path>#L<line>`
> References are kept as local `path:line` because they are clickable in the terminal and are the
> form `/10x-plan` consumes.

## Research Question

Three independent sub-changes, from `change.md`:

1. A new favicon **and** a new in-app icon (the one seen at login), in the style of the reference
   `reference-icon.webp` (a financial-dashboard mark) but depicting **a palm on an island**, using
   the same navy blue and gold scraped from that image.
2. In the month navigation bar (previous / next month), add a **return icon** with the hover text
   *"Wróć do bieżącego miesiąca"*; clicking it reloads the site on the current month and year.
3. In absences, below **choroba**, add gray text *"zwolnienie lub opieka"*.

## Summary

All three are small in code volume and land in low-churn areas, but each carries one decision that
is not mechanical.

- **Icon.** There is exactly one favicon tag in the app and it has never been touched since the
  Astro starter scaffold. The "app icon at login" is not an asset at all — it is a lucide
  `CalendarCheck` glyph in a navy tile, **copy-pasted verbatim into two pages**. Replacing it means
  either editing both or extracting a component (a prior change deliberately chose duplication).
  The blocking question is the palette: the app already carries an **NBP brand palette** in
  `src/styles/global.css` whose gold (`#c5ac75`) is visibly *not* the reference image's gold
  (`#CD9936`). "Scrape the colors from the image" and "match the app" diverge here.
- **Month bar.** Mechanically the easiest of the three: the bar is a 25-line JS-free Astro
  component, month state is a `?month=YYYY-MM` URL param, and **the app already defaults to the
  current month when the param is absent**. The decision is the tooltip mechanism — a native
  `title` keeps the component island-free and matches its two siblings; the Radix `Tooltip`
  primitive exists but has never been used from an `.astro` file.
- **Sub-caption.** The riskiest. Absence-type labels are 100% database-driven with **no code-side
  label map**, and the schema comment explicitly forbids one. The request also does not say *which*
  of four renderers it means, and two E2E assertions break if the caption lands on the wrong one.

Nothing here needs a build-script, packaging, or nginx change.

## Detailed Findings

### 1. Brand identity surface

#### 1.1 The favicon — one tag, never touched

`src/layouts/Layout.astro:24` is the **only** icon tag in the app:

```astro
<link rel="icon" type="image/png" href={withBase("/favicon.png")} />
```

It lives in the single shared layout (`src/layouts/Layout.astro`), so it is emitted on all three
HTML pages (`/`, `/auth/signin`, `/dashboard`). Everything else under `src/pages/` is an API route.

Confirmed absent by a repo-wide grep for `favicon|rel=["']icon|apple-touch|manifest|og:image|shortcut icon`
over `*.astro,*.tsx,*.ts,*.mjs,*.js,*.json,*.html,*.md` (excluding `node_modules`/`dist`):

- no `site.webmanifest` / `manifest.json`, no `<link rel="manifest">`
- no `apple-touch-icon`, no `mask-icon`, no `theme-color`
- no Open Graph / Twitter tags, no `<meta name="description">`
- no SVG favicon, no multi-size icon set, no `favicon.ico`

The `<head>` (`src/layouts/Layout.astro:21-26`) is charset, viewport, the icon link, and `<title>`.

`public/favicon.png` is **733 bytes, PNG 32x32 RGBA** — the stock 10x-Astro-Starter icon from the
initial commit `56c551d` (2026-05-22), never modified. `git log --oneline -- public/` returns only
`56c551d Initial commit` and `ce9f8dc chore: add scaffold template files…`.

**No prior design decision about the favicon exists anywhere.** `grep -ril favicon context/archive/ context/foundation/`
returns one file — `context/archive/2026-08-25-sqlite-install/research.md` — and only as an nginx
routing target.

#### 1.2 The in-app icon — a lucide glyph duplicated across two pages

There is **no logo component, no image asset used as a brand, and no inline brand SVG**.
`find src -iname "*logo*" -o -iname "*brand*" -o -iname "*icon*"` returns nothing; the only `<svg>`
in the app is the functional time dial at `src/components/absence/TimeRangeDial.tsx:178`, and there
is not a single `<img>` tag anywhere in `src/`.

What plays the role of an app icon is this block, **byte-identical in two files** —
`src/pages/index.astro:20-26` and `src/pages/auth/signin.astro:15-21`:

```astro
<div class="bg-primary mb-4 inline-flex size-20 items-center justify-center rounded-2xl shadow-lg shadow-slate-200">
  <CalendarCheck className="size-10 text-white" />
</div>
<h1 class="text-primary text-2xl font-bold">Nieobecności</h1>
```

`CalendarCheck` is imported from `lucide-react` at `src/pages/index.astro:4` and
`src/pages/auth/signin.astro:4`. Note this proves **`.astro` files render lucide React components
statically, with no hydration** — relevant to sub-change 2 as well.

The duplication is deliberate, not an oversight —
`context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:309-310`: *"duplicating ~20 lines of
markup across two pages is acceptable if extraction would add a third file"*.

Brand-adjacent copy on those pages: the wordmark `<h1>Nieobecności</h1>` (`index.astro:25`,
`signin.astro:20`) and the footer `© 2026 Nieobecności. Wszystkie prawa zastrzeżone.`
(`index.astro:38`, `signin.astro:33`).

**The post-login top bar has no brand mark at all.** `src/components/Topbar.astro:13` is a navy bar
(`bg-primary text-primary-foreground h-14`); left slot is the user e-mail via `AccountMenu`
(`:18`) plus an optional Moderator badge (`:19-23`), right slot is a "Dashboard" link and a
"Wyloguj" form (`:26-40`). Two guards apply if the icon is added here:
`src/components/Topbar.astro:29-35` (the bar is mixed-language on purpose) and
`src/components/account/AccountMenu.tsx:14-15`: *"S-17 locks this bar's layout — nothing here may
change its height or spacing."*

#### 1.3 The palette conflict — the one blocking decision

Measured from `context/changes/favicon-ui-improvement/reference-icon.webp` (504x512, alpha, content
trimmed to 495x509) with ImageMagick histograms over fully-opaque pixels:

| Role | Modal (most frequent) | Weighted mean of cluster |
|---|---|---|
| Navy | `#032041` | `#051F40` |
| Gold | `#CD9936` | `#CE9D3F` |

The app's own palette — `src/styles/global.css:9-46`, headed *"NBP brand palette. Every hex below
round-trips exactly through OKLCH — if you change a value, convert from the hex rather than nudging
the lightness."*:

| Token | Line | Hex | Role |
|---|---|---|---|
| `--primary` | `:17` | **`#072143`** navy | top bar, login tile, headings |
| `--primary-foreground` | `:18` | `#ffffff` | |
| `--accent` | `:23` | **`#c5ac75`** gold | moderator badge, top-bar hover |
| `--accent-foreground` | `:24` | `#072143` | navy on gold |
| `--muted-foreground` | `:22` | `#6f6f6f` | secondary text |
| `--line` | `:31` | `#c8c8c8` | hairlines |
| `--line-strong` | `:32` | `#e8e8e8` | grid header band |
| `--radius` | `:10` | `0.875rem` (14px) | "the prototype's card radius" |

Navy is near-identical (`#072143` vs `#032041` — a barely perceptible difference). **Gold is not**:
`#c5ac75` is muted and desaturated; `#CD9936` is saturated and darker. The brief says "scrape them
from the image", but the app palette is a corporate (NBP) one with an explicit
do-not-nudge warning. See Open Questions.

Tokens are re-exported as Tailwind utilities in the `@theme inline` block at `global.css:60-99`
(`--color-primary`, `--color-accent`, …), which is why `bg-primary` / `text-accent` resolve.
Tailwind v4 is CSS-first here — **there is no `tailwind.config.js`/`.ts`**; the Vite plugin is wired
at `astro.config.mjs:83`.

**Dark mode does not exist, deliberately** — `global.css:48-58`: *"There is deliberately no `.dark`
palette… Nothing toggles the class today."* So the icon needs one light treatment only; no
`prefers-color-scheme` favicon variant.

#### 1.4 Reference-icon style, measured

Facts a plan can build the palm-on-island mark against:

- Canvas 504x512, content trimmed to 495x509, **transparent background**.
- The ring is an **open** circle: navy, stroke **~18px on a ~495px diameter = 3.6% of the icon
  width**, with a gap in the upper-right quadrant where the gold arrow breaks out. Measured from a
  scanline at y=256: opaque runs at x=2..20 and x=479..497.
- Bars are flat-topped navy rectangles, **no rounded corners**, increasing in height left to right.
- The gold element is a polyline with round node dots and a solid arrowhead escaping the ring.
- Two colours only, flat fills, no gradients.

#### 1.5 Prior brand decision — the reference image is the mark that was already rejected

The reference file is `wrifboard_icon.webp` — the mark from the WRIFboard financial dashboard.
`context/archive/2026-08-06-main-page-redesign/frame.md:22` recorded:

> **Brand + language** → **adopt visual style + Polish copy**, but keep our own app identity/domain
> — *not* literally "WRIFboard" / "panel rynkowy".

and `context/archive/2026-08-06-main-page-redesign/plan.md:125-127`:

> Logo: a rounded badge with a lucide icon appropriate to an absence/leave app (e.g.
> `CalendarDays`/`CalendarCheck`) in a navy tint — **not the mockup's market chart**. Wordmark text:
> `Nieobecności`.

The new request is **consistent** with that decision — it borrows the visual language (flat, two
colour, broken ring) while replacing the market chart with a palm on an island, which is
subject-appropriate for a leave app. A plan should say so explicitly so this does not read as a
silent reversal.

#### 1.6 Asset pipeline — a new file in `public/` ships with no script change

Traced end to end and confirmed against the checked-out build:

1. `astro build` copies `public/**` verbatim into `dist/client/` (no `publicDir` override).
2. `postbuild` → `scripts/build-artifact.mjs` is purely additive: it writes `dist/bootstrap.mjs`
   (`:27-47`), copies `drizzle/` (`:49-50`), writes `dist/build-info.json` (`:64-84`). It never
   enumerates or filters assets.
3. `npm run pack` → `scripts/pack-artifact.mjs:60`:
   `CONTENTS = ["dist", "node_modules", "package.json", "deploy", "install.sh", "install-user.sh", "INSTALL.md"]`.
   The only `--exclude`s are scoped to `node_modules/` (`:83`). **Nothing under `dist/` is excluded.**
4. `install.sh:292`: `cp -a "${ARTIFACT_DIR}/." "$RELEASE_DIR/"`.
5. `deploy/nginx/urlopy.conf:65-68` — *"Anything else that exists in dist/client (favicon, public/
   passthrough) is served from disk"* via `location / { try_files $uri @app; }`.

**Four hard constraints on the new asset:**

- **G1 — `href="/…"` / `src="/…"` literals fail the test suite.**
  `src/tests/lib/base-path-coverage.test.ts:22-29` is a source-text scan over every `.ts/.tsx/.astro`
  under `src/`, forbidding `fetch("/…")`, `action="/…"`, `href="/…"`, `src="/…"`, `redirect("/…")`.
  The required form is the one already in place: `href={withBase("/favicon.png")}`.
  `src/lib/base-path.ts:21-32` normalises `import.meta.env.BASE_URL` to `""` or `"/urlopy"`; the app
  can be mounted at a sub-path alongside `/wrifboard/` on the same nginx, and `PUBLIC_BASE_PATH` is
  **build-time** (`astro.config.mjs:47-54`, `:71`). A hardcoded path looks fine locally and 404s in
  production.
- **G2 — do not route the icon through `astro:assets` / `<Image>`.**
  `scripts/pack-artifact.mjs:31-35`: *"this app uses no `astro:assets` at all (no `<Image>`, no
  `getImage`). If that ever changes, Astro throws an explicit `MissingSharp` error…"* — `sharp` and
  `@img` are in `BUILD_ONLY` and are **absent from the tarball**. The asset must be a plain
  `public/` file or inline SVG.
- **G3 — `public/` assets are not content-hashed and get no cache headers.**
  `deploy/nginx/urlopy.conf:51-63` applies `expires max; Cache-Control public, immutable` **only** to
  `/_astro/`. Replacing `favicon.png` in place is subject to browser heuristic caching; shipping
  under a **new filename** sidesteps it. No prior cache-busting decision exists.
- **G4 — CSP already permits it.** `astro.config.mjs:106-113` includes `img-src 'self' data:`,
  emitted as a `<meta http-equiv>` by Astro and deliberately **not** by nginx
  (`deploy/nginx/urlopy.conf:38-43`).

**No rasterizer in the repo.** `package.json` has no `sharp`, no `resvg`, no `canvas`, no SVG→PNG
tooling (the only image-adjacent dep is `@playwright/test`). So either the icon ships as an SVG
favicon (`<link rel="icon" type="image/svg+xml">`, zero tooling, and the CSP already allows it), or
a PNG is rasterized out-of-band on the developer machine (ImageMagick `magick` is available there —
it was used for the measurements in §1.4 — but it is not a repo dependency).

#### 1.7 Adjacent debt this change would sit on top of

- **`.scaffold` files are dead and shipping to production.** Created in a single commit
  `ce9f8dc chore: add scaffold template files…`, they are the conflict-preservation artifact of the
  `/10x-bootstrapper` run (listed at `context/changes/bootstrap-verification/verification.md:57`);
  the review step never happened. Nothing references them — grepping `scaffold` across
  `*.json,*.js,*.mjs,*.ts,*.md,*.astro` (excluding `node_modules`, `.claude/`, `.ai/`, `context/`)
  returns zero hits in build config, eslint, prettier, `.gitignore`, or any script. They are
  therefore copied into `dist/client/` and served publicly:
  `public/favicon.png.scaffold` (byte-identical to the live favicon), `public/template.png.scaffold`
  (**1.27 MB**), plus `src/layouts/Layout.astro.scaffold`, `src/components/Topbar.astro.scaffold`,
  `src/pages/{index,dashboard,auth/signin}.astro.scaffold`.
- **`public/template.png`** (1.27 MB, 1492x470) is unreferenced starter cruft — zero hits across
  `src/ tests/ deploy/ README.md INSTALL.md install.sh`.
- **`public/.assetsignore`** is a Cloudflare-Workers static-assets directive, inert under the Node
  adapter (`astro.config.mjs:85`).
- All three were already logged for deletion at
  `context/archive/2026-08-25-sqlite-install/research.md:147-149` and never actioned.
- **`src/layouts/Layout.astro:12`** still defaults the title to the scaffold string
  `"10x Astro Starter"`. No page relies on it — `index.astro:16` and `auth/signin.astro:11` pass
  `"Nieobecności — Logowanie"`, `dashboard.astro:230` passes `"Urlopy — Ewidencja nieobecności"` —
  but it is the fallback any new page would inherit.

### 2. The month navigation bar

#### 2.1 The component — 25 lines, server-rendered, zero JS

`src/components/MonthNav.astro` in full:

```astro
---
const monthLabel = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" })
  .format(new Date(year, month - 1));

// Fixed-width heading keeps the arrows from shifting between long and short month names.
const navButton =
  "border-line text-primary hover:bg-primary hover:border-primary hover:text-primary-foreground flex size-9 items-center justify-center rounded-[10px] border bg-white text-base transition-colors";
---

<div class="flex items-center gap-4">
  <a href={prevMonthUrl} class:list={navButton} aria-label="Poprzedni miesiąc">‹</a>
  <h1 class="text-primary min-w-[220px] text-center text-2xl font-bold capitalize">{monthLabel}</h1>
  <a href={nextMonthUrl} class:list={navButton} aria-label="Następny miesiąc">›</a>
</div>
```

Points that constrain the new control:

- **The arrows are literal Unicode glyphs `‹` and `›`, not icons.**
  `grep -rn "ChevronLeft\|ChevronRight" src/` returns only `ChevronDownIcon`/`ChevronUpIcon` in
  `src/components/ui/select.tsx` — there is no chevron-left/right anywhere.
- `navButton` (`MonthNav.astro:17-18`) is a hand-written class string on a raw `<a>`, **not** a
  shadcn `Button`. `size-9` = 36px square, `rounded-[10px]`, `border-line` hairline, white fill,
  navy glyph, inverting to navy fill on hover. (`src/components/ui/button.tsx` does have
  `size: { icon: "size-9" }`, so a shadcn button would be dimensionally identical if ever converted.)
- Locked by `context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:250-253`: *"Buttons are
  36x36, `border-radius:10px`, `#c8c8c8` border on white, navy glyph, inverting to navy fill with
  white glyph on hover. Heading is 24px bold navy with `min-width:220px; text-align:center`. Keep
  the existing `Intl.DateTimeFormat("pl-PL")` label and both `aria-label`s."*
- A **verified success criterion** from that change (`plan.md:278`, Progress 1.7): *"Month nav
  heading does not shift horizontally when stepping between months."* A third control must not
  disturb this — which is an argument for placing it outside the `‹ heading ›` triplet rather than
  inside it.
- Row placement rule (`huge-ui-ux-improvement/plan.md:237-238`): *"Row layout at the top of the
  container is month nav on the left, tab group on the right"* — live at `src/pages/dashboard.astro:262-278`,
  `<div class="mb-5 flex items-center justify-between gap-4">`.
- Design source of truth: `new-design/10xUrlopy.dc.html:40-46` matches the CSS 1:1. **The prototype
  has only two buttons — no "today" control exists in the design either.**

#### 2.2 Month state — a URL param that already defaults to today

`src/pages/dashboard.astro:27-33`:

```ts
const monthParam = Astro.url.searchParams.get("month");
const now = new Date();
// Normalize to null when format is invalid — prevents NaN propagating into date range queries
const validMonthParam = monthParam != null && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : null;
const year = validMonthParam ? parseInt(validMonthParam.split("-")[0], 10) : now.getFullYear();
const month = validMonthParam ? parseInt(validMonthParam.split("-")[1], 10) : now.getMonth() + 1;
```

- Validation is a **hand-written regex, not zod** (zod is imported only in `src/lib/validators.ts:1`).
- **The default-to-current-month path already exists** — it is this ternary. `/dashboard?tab=grid`
  with no `month` param already lands on the current month. So the new control can either omit the
  param or emit an explicit `?month=<current>`.
- Sibling params that must be preserved: `?tab=` (`:42-43`, `grid|details|stats`, default `grid`)
  and `?subcard=` (`:45-47`, `today|monthly|yearly`, default `today`).

URL construction, `src/pages/dashboard.astro:201-216` — note the **query-only relative** form, which
inherits the mount prefix automatically and is why `withBase()` is deliberately *not* used here:

```ts
const prevMonthUrl =
  currentTab === "details"
    ? `?month=${prevMonthStr}&tab=${currentTab}&subcard=${currentSubcard}`
    : `?month=${prevMonthStr}&tab=${currentTab}`;
```

Transition is a **plain `<a href>` full page load** — no `window.location`, no client fetch.
Corroborated at `src/components/absence/AbsenceStats.tsx:349-350`: *"Month/year navigation is a full
page load today, so the island remounts and this is belt and braces; it stops being belt and braces
the moment that navigation goes client-side."*

Rules that survive from earlier changes: URLs are computed in Astro, not React
(`context/archive/2026-05-28-monthly-grid-own-absence/plan.md:247-254`); the nav is *"a restyle of
anchors, not a move to client state"* (`huge-ui-ux-improvement/plan.md:238-239`).

#### 2.3 "Today" — plain `new Date()`, no timezone handling

`now` at `dashboard.astro:29` is server-local. **There is no date/month helper module and no
timezone handling**: `grep -rn "Europe/Warsaw\|timeZone" src/` returns zero hits; Warsaw appears only
in comments justifying *not* using `toISOString()` (`src/lib/export-workbook.ts:189`,
`src/lib/absence-range.ts:17`). Date keys use local getters, never `toISOString`
(`context/archive/2026-08-12-grid-multicheck/plan.md:234-236`).

Related but deliberately separate: `const balanceYear = now.getFullYear();` at `dashboard.astro:40`,
with a comment (`:35-39`) warning not to collapse it into the browsed `year`.

The grid has **no "today" column highlight** — `grep -n "today\|isToday\|new Date()" src/components/absence/AbsenceGrid.tsx`
returns nothing. The only "today" concept in the UI is the `Dzisiaj` subcard
(`src/components/absence/AbsenceDetailsSubcards.tsx:244`, `:317`).

#### 2.4 No bounds, and three competing tooltip mechanisms

`MonthNav.astro` has no `disabled`, no min/max month, no `aria-disabled` — the arrows are `<a>`
elements, which cannot be disabled anyway, and `dashboard.astro:205-208` does unclamped `Date`
arithmetic. A user can browse arbitrarily far in either direction.

Tooltip options, in order of fit:

1. **Native `title` + `aria-label`** — the dominant pattern for icon-only controls:
   `src/components/employee/EmployeeManagementSheet.tsx:163-164` and `:175-176` pair both
   deliberately; also `src/components/account/AccountMenu.tsx:26`,
   `src/components/absence/AbsenceDetailsTable.tsx:246`, `src/components/absence/AbsenceGrid.tsx:518`.
   Keeps `MonthNav` island-free.
2. **`aria-label` only** — what MonthNav's own two arrows do today. Gives no visible hover text, so
   it does not satisfy the request on its own.
3. **shadcn/Radix `Tooltip`** — `src/components/ui/tooltip.tsx` exists but is hand-written, not from
   `npx shadcn add` (`:2-5`: *"would write `@radix-ui/react-tooltip` instead, pulling a second Radix
   copy into a bundle CI measures"*). It is imported in **exactly one place**,
   `src/components/absence/AbsenceFormDialog.tsx:18`, and **has never been used from an `.astro`
   file**. Using it here means introducing a React island into a currently JS-free component.

There is a documented argument for each side. For the tooltip primitive,
`src/components/absence/AbsenceFormDialog.tsx:800-806`: *"A real `<button>` rather than an icon with
a `title`: a tooltip on a focusable element opens on keyboard focus too, so the explanation is not
pointer-only."* Against, `huge-ui-ux-improvement/plan.md:534-537`: *"Native `title` is sufficient —
no tooltip primitive is installed and adding one is out of scope"* — **that statement is now stale**,
the primitive exists.

#### 2.5 Icons are available in `.astro` without hydration

`src/pages/index.astro:4` and `src/pages/auth/signin.astro:4` already import and render
`<CalendarCheck className="size-10 text-white" />` from `lucide-react` inside `.astro` files with no
`client:` directive. So a static lucide icon (e.g. `RotateCcw`, `Undo2`, `CalendarDays`) inside
`MonthNav.astro` is consistent with existing practice — and arguably an improvement on the `‹`/`›`
glyphs. Sizing convention inside a `size-9` button is `className="size-4"`.

Grid-area lucide inventory: `GripVertical` (AbsenceGrid), `Download` (AbsenceExportDialog),
`CircleHelp`/`Clock` (AbsenceFormDialog), `KeyRound` (EmployeeManagementSheet).

#### 2.6 Single render site, no test coverage

`grep -rn "MonthNav" src/ tests/` yields exactly two lines, both in the same file:
`src/pages/dashboard.astro:4` (import) and `:263` (render).

`dashboard.astro` is the **one** authenticated page; the moderator/employee split happens inside it
via `currentEmployee.role === "moderator"` branches (`:125`, `:172`, `:236`, `:319`), and the month
bar renders identically for both roles. The other pages are `src/pages/index.astro` and
`src/pages/auth/signin.astro` (login screens, no month bar).

No test references `MonthNav`. There are **no `.astro` component tests at all** — `src/tests/` covers
`lib/`, `api/`, `db/`, `scripts/` only. E2E specs navigate by URL:
`tests/e2e/absence-grid-range.spec.ts:82` (`page.goto(\`/dashboard?month=${MONTH}\`)`) and
`tests/e2e/absence-form-dialog.spec.ts:31`.

#### 2.7 If the button should vanish on the current month, the rule is withhold, not disable

Nothing currently computes "is the browsed month the current month" — it would be a new prop. The
repo convention, if the control should not always be present:
`context/archive/2026-08-12-grid-multicheck/research.md:391-394` (*"express non-interactivity by
*absence* of a handler"*), `context/archive/2026-09-01-grid-bulk-delete/plan-brief.md:46` (*"`Usuń`
hidden, not disabled"*), and `context/archive/2026-08-31-priority-absence-flag/plan.md:434-436`:
*"**Unmount, do not hide** … out of the accessibility tree and out of the tab order when ineligible."*

Also note this would be **the first control ever added to the month bar** —
`grid-bulk-delete/plan.md:101-102`: *"Not a new gesture or affordance. No toolbar, no context menu…"*

### 3. The "choroba" sub-caption

#### 3.1 Labels are database rows, and a code-side label map is explicitly forbidden

The catalogue is table `absence_types` — Drizzle schema `src/db/schema.ts:68-82`, DDL
`drizzle/0000_baseline.sql:16-26`. Columns are `id / name / color / icon / text_color / display_order`
— **there is no `description`, `subtitle`, or `caption` column, and no code/slug column.**

`src/db/schema.ts:76-78` states the principle:

> Presentation metadata. Types stay data, never a name-keyed code map: adding an
> eighth type is a seed row, not a code change.

Rows come from `ABSENCE_TYPE_SEED` at `src/db/seed.ts:18-32`, upserted idempotently by
`seedAbsenceTypes()` (`:39-56`) from `src/db/migrate.ts:45` — i.e. every `npm run db:bootstrap` /
migrate:

| order | name (= the rendered label) | color | text_color | icon |
|---|---|---|---|---|
| 1 | `urlop` | `#cceeff` | `#0b5a72` | 🌴 |
| 2 | `szkolenie/wyjście poza miejsce pracy` | `#ffcc99` | `#8a4a00` | 🏃 |
| 3 | `szkolenie w miejscu pracy` | `#ffe8a8` | `#7a5b00` | 🎓 |
| 4 | **`choroba`** | `#2f578c` | `#ffffff` | 🤒 |
| 5 | `wyjazd zagraniczny` | `#f2a3a3` | `#7d0d1c` | 🌍 |
| 6 | `stała nieobecność` | `#ccffcc` | `#2c5c2c` | 🚫 |
| 7 | `urlop planowany` | `#99ccff` | `#0b3f6b` | 📅 |

Note the rendered label is **lowercase `choroba`**, not "Choroba" as the brief writes it.

Labels reach the client as the `absenceTypes` prop, queried once server-side at
`src/pages/dashboard.astro:154` and threaded to four islands: `AbsenceExportDialog` (`:247`),
`AbsenceGrid` (`:294`), `AbsenceDetailsSubcards` (`:305`), `AbsenceStats` (`:318`).
`AbsenceType` is `typeof absence_types.$inferSelect` (`src/types.ts:18`).

**There is no code display-label anywhere.** `grep -rn "TYPE_LABEL\|LABELS\|labelFor\|displayLabel" src/`
returns zero hits.

So the caption is one of two shapes:

- **A new nullable column** on `absence_types` + seed value — consistent with the stated principle,
  but touches `src/db/schema.ts`, a drizzle migration, `src/db/seed.ts`, the
  `scripts/export-sample.ts:43` fixture, and `src/tests/db/migrate-seed.test.ts`. Migration
  discipline applies: `AGENTS.md` / `CLAUDE.md` warn that SQLite cannot `ALTER TABLE ADD CONSTRAINT`
  and that a regenerated `CREATE TABLE` silently drops CHECK constraints and `COLLATE NOCASE`.
- **A name-keyed map in `src/lib/absence-types.ts`** — the sanctioned exception. That file's header
  (`:1-12`) already warns *"A rename of a seed row must be mirrored here"* and describes the reverse
  failure mode: *"an eighth absence type … is silently neither, because nothing forces this file to
  be revisited."* It would become the **fourth** such exception:
  `context/archive/2026-08-31-priority-absence-flag/plan.md:143-152` records that a `code`/`slug`
  column *"has been proposed and declined three times"*.

#### 3.2 Which "choroba"? Four renderers, and the brief names none

**(a) Grid legend pill** — `src/components/absence/AbsenceGrid.tsx:304-325`:

```jsx
{absenceTypes.map((type) => (
  <span key={type.id}
    className="border-line-strong flex items-center gap-[7px] rounded-full border bg-white px-3 py-1.5 text-xs text-black">
    <span className="block size-2.5 rounded-full" style={{ backgroundColor: type.color }} />
    {type.icon && <span className="text-[13px] leading-none">{type.icon}</span>}
    <span>{type.name}</span>
  </span>
))}
{/* `[P]` is meaningless without a key. Styled as a neighbouring type pill minus the
    colour dot — it decodes a marker, not a type. */}
<span className="border-line-strong flex items-center gap-[7px] rounded-full border bg-white px-3 py-1.5 text-xs text-black">
  <span className="font-bold">[P]</span>
  <span>priorytetowy</span>
</span>
```

A single-row `flex items-center` pill. A caption *below* the label is **new form** here — it needs a
nested column wrapper, or it becomes an inline parenthetical instead.

**(b) Form-dialog type picker** — `src/components/absence/AbsenceFormDialog.tsx:688-728`. A
hand-rolled `role="radiogroup"` of `role="radio"` buttons (**not** a shadcn `<Select>`):

```jsx
<span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] text-sm leading-none"
      style={{ backgroundColor: type.color, color: type.text_color }}>
  {type.icon}
</span>
<span className="min-w-0 flex-1">{type.name}</span>
```

The `flex-1` name span with `leading-tight` on the button is the most naturally extensible slot.

**(c) Details table chip** — `src/components/absence/AbsenceDetailsTable.tsx:229-252`. Filled with
the type colour, with `[P]` inlined; its parent (`:228`) is
`<div className="flex flex-col items-start gap-[5px]">` and **already stacks a muted line beneath**
for comments (`:255`), so a caption slots in naturally.

**(d) Grid cell chip** — `src/components/absence/AbsenceGrid.tsx:492-521`. **Hard-blocked**:
`context/archive/2026-08-31-priority-absence-flag/plan.md:520-525`: *"The layout constraint is
absolute, not stylistic. … An inline flex child would contribute its full width … and widen the
120px `table-fixed` column."* The type name was in fact deliberately dropped from the cell
(`context/archive/2026-08-11-grid-adjustment-offsite-training/change.md`), so it is not a candidate.

Non-DOM label surfaces that also say "choroba" and would need a decision if the caption is meant to
be systematic: cell tooltip `` `Typ: ${type.name}` `` (`AbsenceGrid.tsx:213`), chip `aria-label`
(`:417`), the details filter buttons which are icon-only with `title={type.name}`/`aria-label`
(`AbsenceDetailsSubcards.tsx:266-292`), the stats breakdown row (`AbsenceStats.tsx:112-115`, note
`truncate`) and matrix header (`:221-227`), and the XLSX legend (`src/lib/export-workbook.ts:206-219`).

#### 3.3 Styling — the token is settled, and it is not `text-gray-*`

Use **`text-muted-foreground text-xs`**. There are 68 `text-muted-foreground` usages across
`src/components/` and `src/pages/`; `grep -rn "text-gray-" src/components` returns essentially
nothing user-facing (only `dashboard.astro:329`, an error block). The brief says "it can be gray" —
the repo's gray is the semantic token, `#6f6f6f` via `--muted-foreground` (`global.css:22`).

Two exact precedents for "primary line + gray secondary line beneath":

```jsx
// src/components/absence/AbsenceDetailsTable.tsx:224-227
<div>
  <div className="text-sm font-bold text-black">{formatDate(absence.date)}</div>
  <div className="text-muted-foreground text-xs">{weekdayFmt.format(date)}</div>
</div>
```

and `src/components/absence/AbsenceStats.tsx:209`:
`{subtitle && <span className="text-muted-foreground text-xs">{subtitle}</span>}`.

**There is no prior art for a per-type sub-caption on any surface.** Greps run:
`grep -rniE "sub-caption|caption|podpis"` over `context/archive/` → no match;
`grep -rniE "zwolnienie|opieka"` repo-wide → only this change's `change.md` and an unrelated fixture
comment at `scripts/export-sample.ts:121`.

#### 3.4 The `[P]` precedent — the closest analogue, and it chose a *sibling*, not a sub-caption

For the priority marker, the legend got a **neighbouring pill** rather than a caption
(`AbsenceGrid.tsx:319-325`, quoted above), and the details chip got an **inline qualifier** with
`aria-hidden` glyph + `sr-only` word + `title` (`AbsenceDetailsTable.tsx:244-249`). Wording was
settled deliberately — `context/archive/2026-08-31-priority-absence-flag/plan.md:832-837`, deviation
D2: *"**The legend reads `[P] priorytetowy`, not `[P] = priorytetowy`.** The `=` was judged
unnecessary."*

Grid legend and XLSX legend **must read identically** — the XLSX side is the `PRIORITY_MARKER`
constant at `src/lib/export-workbook.ts:218`, and `src/tests/lib/export-workbook.test.ts:300-326`
asserts legend cell count and content (`expect(key.text).toBe("[P] priorytetowy")` at `:314` and
`:324`). **If the caption reaches the grid legend, the XLSX legend is in scope too.**

### 4. Test and CI exposure

#### 4.1 The locator policy is "no testids"

`tests/e2e/e2e-rules.md:5-7`:

> - Use `getByRole`, `getByLabel`, `getByText` as primary locators.
> - Fall back to `getByTestId` only when no accessible name exists.
> - Never use CSS selectors, XPath, or DOM structure.

`context/archive/2026-08-11-e2e-auth-locators/plan.md:72-73`: *"**Not adding `data-testid`
anywhere.** It would contradict `e2e-rules.md:5-7` and break a codebase with zero testids.
Accessible names stay the locator strategy."* Counts across the three spec files: `getByRole` 65,
`getByLabel` 12, `getByText` 9, `getByTestId` 2, CSS `.locator()` 0. The only `data-testid` in the
repo is `absence-cell-<employeeId>-<date>`, because cells carry no accessible name.

That change's own trigger is this change's risk profile: commit `f748ba5` Polonized
`LoginCardForm.tsx` and silently broke `getByLabel("Email")` — *"nothing failed loudly when they
drifted."* The mitigation adopted was a **CI copy-assertion**, not testids:
`.github/workflows/ci.yml:90,108` greps the sign-in HTML for `Użytkownik / ID`, `Hasło`,
`for="email"`, `for="password"`, and counts `Zaloguj się`. **That guard covers the sign-in page
only** — not the dashboard, grid, or legend.

#### 4.2 Per sub-change

| Sub-change | Exposure |
|---|---|
| Favicon / app icon / `<title>` | **None.** `grep -rn "toHaveTitle\|<title\|favicon" tests/ src/tests/` → 0 hits. But the login page **is** covered by the CI copy-grep, so do not disturb `for="email"` / `for="password"` / `Zaloguj się` while editing `index.astro` and `signin.astro`. |
| New `href`/`src` on the icon | `src/tests/lib/base-path-coverage.test.ts` fails the build on a literal `href="/…"`. Use `withBase()`. |
| Month-nav button | **Near-none.** 0 hits for `Poprzedni`/`Następny`/`miesi` in `tests/`; specs drive months by URL. One adjacent locator: `tests/e2e/setup/auth.setup.ts:48` `getByRole("link", { name: "Siatka" })` — the readiness check for the whole suite. Give the new control an accessible name that does not substring-collide with `Siatka`, `Poprzedni miesiąc`, or `Następny miesiąc`. |
| "choroba" caption | **Highest.** 8 references in `tests/e2e/absence-grid-range.spec.ts`. |

Precisely, for the caption:

- `getByRole("radio", { name: "choroba" })` at `:150`, `:179`, and via helpers `:227`/`:238` (called
  with `"choroba"` at `:249`, `:250`, `:295`). The radio has **no `aria-label`**; its accessible name
  is computed from its subtree, so a caption inside makes the name
  `choroba zwolnienie lub opieka`. Playwright's `name` option matches **substring,
  case-insensitive** by default, so **these survive** — but they become fragile, and strict-mode
  collisions become possible if another type's caption shares a substring.
- `getByText("choroba", { exact: true })` at `:203` and `:274`, scoped to a `<li>` in the
  overwrite/delete confirmation list, which renders bare `{type?.name ?? "nieznany typ"}` at
  `src/components/absence/AbsenceFormDialog.tsx:665-676`. **These break only if the caption is added
  to that shared row rendering.** The surrounding comment (`:196-202`) explains the scoping is
  deliberate.

Sanctioned pattern when copy grows — `context/archive/2026-08-31-priority-absence-flag/plan.md:669-671`:
update the assertion deliberately and assert the *new* content, *"so the change is recorded as
intentional rather than a loosened bound."*

Vitest data-level assertions that a **schema/seed** approach would touch:
`src/tests/db/migrate-seed.test.ts:53-57` (`toHaveLength(7)`, name and id order),
`src/tests/db/proxy-rows.test.ts:57-97`, `src/tests/lib/absence-grid-cell.test.ts:7`,
`src/tests/lib/export-workbook.test.ts:300-326`, `src/tests/lib/absence-types.test.ts:20-38`.

**Running E2E**: `BASE_URL` defaults to `main`'s Workers deployment, so *a bare `npm run e2e`
silently runs against production*. Use `BASE_URL=http://localhost:4321 npm run e2e` after
`npm run seed:e2e`. **E2E does not run in CI** — `.github/workflows/ci.yml` has no Playwright step.

### 5. Polish copy conventions

- **Full diacritics, always.** The brief's *"Wróc"* should be **"Wróć do bieżącego miesiąca"**. (The
  ASCII-folded Polish in `context/foundation/prd.md` — "nieobecnosci" — is a PRD-authoring artifact
  only; UI copy is never folded.)
- Absence-type names render **lowercase**, verbatim from the seed (`choroba`, not `Choroba`).
- Section captions are uppercased via CSS (`tracking-[0.06em] uppercase`), not literal caps.
- Tooltip lines follow `Label: value` with a capitalised label (`AbsenceGrid.tsx:213`).
- Comments render with Polish typographic quotes: `„{absence.comment}”` (`AbsenceDetailsTable.tsx:254`).
- Imperative and terse, no exclamation marks. Existing strings in the month-bar region:
  `Poprzedni miesiąc`, `Następny miesiąc`, `Siatka`, `Szczegóły`, `Statystyki`.
- **Two deliberate English exceptions** in `src/components/Topbar.astro` (`Dashboard`, `Sign in`,
  `Not signed in`) with an in-code warning at `:29-35`: *"The bar is mixed-language on purpose — do
  not 'restore consistency' in either direction without checking back."*

## Code References

- `src/layouts/Layout.astro:12` — stale default title `"10x Astro Starter"`
- `src/layouts/Layout.astro:24` — the app's only `<link rel="icon">`, via `withBase()`
- `src/lib/base-path.ts:21-32` — `withBase`, and why sub-path mounting makes it mandatory
- `src/tests/lib/base-path-coverage.test.ts:22-29` — source-text scan that fails on `href="/…"`
- `src/pages/index.astro:20-26` / `src/pages/auth/signin.astro:15-21` — the duplicated login icon tile
- `src/pages/index.astro:4` / `src/pages/auth/signin.astro:4` — lucide imported into `.astro`, unhydrated
- `src/components/Topbar.astro:13-40` — post-login bar; no brand mark; layout locked at `:29-35`
- `src/styles/global.css:9-46` — NBP brand palette; `:48-58` — no dark mode, deliberately
- `public/favicon.png` — 733 B, 32x32, untouched since `56c551d`
- `scripts/pack-artifact.mjs:31-35` — `sharp` excluded; do not use `astro:assets`
- `scripts/pack-artifact.mjs:60` — tarball `CONTENTS`; `dist/` unfiltered
- `deploy/nginx/urlopy.conf:51-68` — `/_astro/` immutable caching; `public/` passthrough uncached
- `astro.config.mjs:106-113` — CSP `img-src 'self' data:`
- `src/components/MonthNav.astro:1-25` — the whole month bar
- `src/pages/dashboard.astro:27-33` — month param parse, and the current-month default
- `src/pages/dashboard.astro:201-216` — prev/next URL construction, tab/subcard preservation
- `src/pages/dashboard.astro:262-278` — the row that holds MonthNav and the tab pill
- `src/db/schema.ts:68-82` — `absence_types`; "types stay data" comment at `:76-78`
- `src/db/seed.ts:18-32` — `ABSENCE_TYPE_SEED`, the source of every rendered label
- `src/lib/absence-types.ts:1-12` — the sanctioned name-keyed exception, and its warning
- `src/components/absence/AbsenceGrid.tsx:304-325` — legend pills + the `[P]` key
- `src/components/absence/AbsenceFormDialog.tsx:688-728` — the type radiogroup
- `src/components/absence/AbsenceFormDialog.tsx:665-676` — confirm-list row (E2E `exact` target)
- `src/components/absence/AbsenceDetailsTable.tsx:224-255` — chip + the stacked muted-caption precedent
- `src/lib/export-workbook.ts:206-219` — XLSX legend, must mirror the grid legend
- `tests/e2e/e2e-rules.md:5-7` — locator policy
- `tests/e2e/absence-grid-range.spec.ts:150,179,203,227,238,249,250,274,295` — the "choroba" locators
- `.github/workflows/ci.yml:90,108` — sign-in copy assertions

## Architecture Insights

- **Server-first, islands only where needed.** The month bar, the top bar and both login pages are
  plain Astro; React appears only for the grid, dialogs, stats and details. Adding a Radix tooltip to
  `MonthNav` would be the first island in that region — a real architectural step, not a styling one.
- **URL is the state store for the dashboard.** `month`, `tab`, `subcard` are all query params parsed
  server-side; navigation is full page loads by design. Any new navigation affordance should be an
  `<a>` with a query-only relative href, and must carry the sibling params forward.
- **Two competing rules govern absence types**, and this change sits exactly on the seam:
  "types stay data, never a name-keyed code map" (`src/db/schema.ts:76-78`) versus the sanctioned
  name-keyed exception in `src/lib/absence-types.ts`, already used three times, with a `code`/`slug`
  column proposed and declined three times.
- **Sub-path mounting is a first-class constraint**, enforced by a source-text test rather than by
  types — the class of bug it catches only appears in production.
- **Accessible names are the test contract.** With no testids and no component tests, rendered copy
  *is* the API the E2E suite binds to; the only automated guard on copy drift is a CI grep over the
  sign-in page.
- **The offline artifact shapes what "add an asset" can mean**: no `sharp`, no `astro:assets`, no
  content hashing for `public/`.

## Historical Context (from prior changes)

- `context/archive/2026-08-06-main-page-redesign/frame.md:22` and `plan.md:125-127` — adopt the
  WRIFboard *visual style*, keep our own identity; explicitly **not** the market-chart mark. The new
  palm-on-island request is consistent with this, but should be stated as such.
- `context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:237-253`, `:278` — month-bar geometry,
  hover behaviour, `min-width:220px` no-shift criterion, "restyle of anchors, not client state".
- `context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:309-310` — the two login pages
  deliberately duplicate the icon tile rather than extract a component.
- `context/archive/2026-08-07-huge-ui-ux-improvement/plan.md:534-537` — "native `title` is
  sufficient; no tooltip primitive is installed" — **now stale**, `src/components/ui/tooltip.tsx` exists.
- `context/archive/2026-08-31-priority-absence-flag/plan.md:143-152` — name-keyed rules are the
  sanctioned exception, already three of them; `code`/`slug` proposed and declined three times.
- `context/archive/2026-08-31-priority-absence-flag/plan.md:520-525` — the grid cell's 120px
  `table-fixed` column is an absolute layout constraint.
- `context/archive/2026-08-31-priority-absence-flag/plan.md:832-837` — legend wording settled as
  `[P] priorytetowy`; grid and XLSX legends must match.
- `context/archive/2026-08-31-priority-absence-flag/plan.md:434-436`,
  `context/archive/2026-08-12-grid-multicheck/research.md:391-394`,
  `context/archive/2026-09-01-grid-bulk-delete/plan-brief.md:46` — unmount, do not disable.
- `context/archive/2026-08-11-e2e-auth-locators/plan.md:72-73` — no testids; accessible names are the
  locator strategy; copy changes need a deliberate CI/test move.
- `context/archive/2026-08-11-grid-adjustment-offsite-training/change.md` — the type name was
  deliberately dropped from the grid cell.
- `context/archive/2026-08-25-sqlite-install/research.md:147-149` — `.assetsignore`, `template.png`
  and the `.scaffold` duplicates were already flagged for deletion and never actioned.
- `context/archive/2026-05-28-monthly-grid-own-absence/plan.md:247-254` — nav URLs are computed in
  Astro, not React.
- `git log --oneline -40 -- public/ src/layouts/` returns six commits total; only two touch `public/`
  and both are scaffold. This is the least-churned surface in the repo.

## Related Research

- `context/archive/2026-08-25-sqlite-install/research.md` — asset serving, nginx, tarball contents
- `context/archive/2026-08-31-priority-absence-flag/plan.md` — the closest analogue for adding a
  label-adjacent marker across grid, details, legend and XLSX
- `context/archive/2026-08-07-huge-ui-ux-improvement/plan.md` — the source of the current month-bar
  and login-page design
- `context/foundation/lessons.md` — verify universally-quantified claims before writing them;
  prefer self-contained `Astro.locals` lookups over prop threading in server components

## Open Questions

1. **Gold: image or app token?** The reference gold `#CD9936` and the app's `--accent` `#c5ac75`
   are visibly different. Options: (a) draw the icon in the app tokens `#072143` / `#c5ac75` so it
   matches the moderator badge and top-bar hover; (b) use the scraped `#032041` / `#CD9936` for the
   icon only, accepting that the icon's gold differs from every other gold in the UI; (c) retune
   `--accent` to the scraped gold — a **repo-wide visual change** to a palette documented as NBP
   brand, and out of proportion to this request. Navy is a non-issue either way.
2. **Which surface gets the "zwolnienie lub opieka" caption?** The legend pill
   (`AbsenceGrid.tsx:311-318`), the form-dialog type picker (`AbsenceFormDialog.tsx:696-726`), the
   details chip (`AbsenceDetailsTable.tsx:229-252`), or more than one. "In absences below choroba"
   most plausibly means the type picker; the legend is the second candidate. This decides both the
   markup shape and the E2E blast radius, and whether the XLSX legend is in scope.
3. **Caption storage: seed column or name-keyed map?** A nullable column honours "types stay data"
   but pulls in a migration and five test files; a map in `src/lib/absence-types.ts` is cheaper and
   is the sanctioned exception, but becomes the fourth one.
4. **Favicon format and cache-busting.** SVG favicon (no tooling, CSP-clean) versus a rasterized
   PNG (needs out-of-band ImageMagick, since `sharp` is not and must not be a dependency). Either
   way, shipping under a **new filename** avoids the uncached-`public/` replacement problem at
   `deploy/nginx/urlopy.conf:65-68`.
5. **Login icon: edit both pages or extract a component?** A prior change explicitly chose
   duplication for ~20 lines. A real SVG mark may tip that balance; the decision should be recorded
   either way.
6. **Should the icon also appear in the top bar?** It has none today, and
   `src/components/account/AccountMenu.tsx:14-15` says the bar's layout is locked. Out of scope
   unless asked.
7. **Should the "return to current month" control hide when already on the current month?** Repo
   convention is unmount-not-disable, but nothing currently computes that condition, and the
   prototype has no such control at all.
8. **Bundle the `.scaffold` / `template.png` cleanup?** It is adjacent (`public/`), already logged
   as debt, and removes ~2.5 MB from `dist/client/` and every tarball — but it is scope the brief
   did not ask for.
