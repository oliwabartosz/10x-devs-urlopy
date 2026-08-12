# Adopt the new-design prototype: token layer + restyle — Plan Brief

> Full plan: `context/changes/huge-ui-ux-improvement/plan.md`
> Frame brief: `context/changes/huge-ui-ux-improvement/frame.md`
> Research: `context/changes/huge-ui-ux-improvement/research.md`

## What & Why

The dashboard has no design-token layer to adopt the prototype *into*, and "implement
`new-design/`" bundles that gap with a median-sized restyle and three product capabilities of
undefined semantics into a single unit that can only be verified in production. This change
takes the first cut: the token layer plus the restyle. The three capabilities become their own
changes, each opening with its product question answered.

## Starting Point

`global.css:7-40` is the unmodified shadcn neutral palette — every value has chroma exactly
zero, and the brand navy appears six times in `src/`, all on the login card. Three design
languages are live at once: light-slate `/`, gray-and-blue `/dashboard`, dark-cosmic
`/auth/signin`. The information architecture, however, already matches the prototype — tabs,
sub-tabs, grid orientation, balance-card placement and the partial-day rule all line up. What
diverges is the skin, the density, and which signals are visible without opening a dialog.

## Desired End State

Every authenticated surface renders in one brand language: navy chrome, gold accents, white
14px-radius cards on a `#f4f4f4` page. The seven absence types carry a pastel colour, an
explicit foreground colour, an emoji icon and a stable order — all from the database. Grid
cells show type, icon, time range and badges for comment and substitute. Details filters by
type and opens rows for editing. Statistics gains KPI tiles, a per-type breakdown, stacked
mini-bars and medals. Sign-in is one light-brand card.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Unit of work | Token layer + restyle only; three capabilities deferred | Dragging them in would block every line of CSS behind three unanswered product questions | Frame |
| Prototype's authority | Trustworthy **visual** spec, untrustworthy **behavioural** one | It contains a reachable crash, an inverted filter, and copy that contradicts its own arithmetic | Frame |
| Palette | Adopt the pastels wholesale, including `choroba` → navy | User's design decision; supersedes the institutional `--color-chart-*` mapping | Frame |
| Type metadata | New columns (`icon`, `text_color`, `display_order`) | A name-keyed code map would break S-13's "types are data, never hardcoded" | Frame |
| `Dodano` column | **Keep** — six columns, diverge from the prototype | FR-006 is a must-have; no reason to amend a requirement to fit a density choice | Plan |
| Token shape | Override shadcn semantics **and** name the three greys shadcn has no slot for | Only option that ends the divergence rather than formalising a second palette | Plan |
| Auth screens | **In scope** — close the theme fork in this change | `LoginCardForm` shares nothing with the dark primitives, so closing it deletes five files | Plan |
| `Korekta` / `Do dnia` | Stay in the balance modal; relocation deferred | Coupled to the deferred batch-balance work, and avoids the full-replace zeroing hazard | Plan |
| Balance write gate | `Korekta` becomes moderator-only; everything else stays open | User's ruling — narrows S-15's "both roles may edit any balance" to one field, not the whole route | Plan |
| Statistics scope | All four client-computable blocks; utilisation card deferred | Every one is a derivation of data already in the browser — no API, no schema | Plan |
| Matrix cells | Days only, hours folded in via `/8` | Reverses S-02's "days and hours separately"; the divisor is extracted so the count of copies stays at one | Plan |
| Verification | Phase-by-phase straight to `main`, verify on production | Zero new infrastructure, and the app is pre-launch so transient breakage costs nothing | Plan |

## Scope

**In scope:** brand token layer in `global.css` · topbar, action bar, month nav, tab control,
page container · light-brand `/auth/*` with the five dark primitives deleted · `absence_types`
migration (`icon`, `text_color`, `display_order`) + PRD colour-map amendment · grid restyle
with icons, badges and rich tooltip · Details filter chips, grouped cards, six sortable
columns, clickable rows · Statistics KPI tiles, per-type bars, stacked mini-bars, medals,
days-only cells · balance card, quota modal steppers, moderator gate on balance writes ·
absence-modal pickers and employee drawer

**Out of scope:** `absences.priority` and the 🅿️ badge · drag-to-select multi-day writes ·
`Podgląd wykorzystania urlopów` and the batch-balance endpoint · relocating `Korekta` / `Do dnia`
and merging the employee dialogs · the prototype's behavioural layer (`clearFilters`,
`addStaff`/`initialsOf`, the Korekta help copy, the `today = 1` stub, the fabricated `HIST`
array) · the `showTimeRanges` / `weekendShading` / `rowHeight` harness props · optimistic
mutations · server-side aggregation · amending FR-006 · deleting `new-design/`

## Architecture / Approach

Bottom-up. Tokens land first so every later phase consumes names rather than hex. The auth
phase comes second — it is the only surface `wrangler dev` can render, so it proves the token
layer on a real screen before six phases depend on it. Then the data layer
(`absence_types` metadata), so the three tab phases read icon, colour and order straight off
the row. Then one phase per tab, then the dialogs. No new queries are introduced anywhere: the
existing star select on `absence_types` carries the new columns for free, and every new
employee-derived surface reads from props that are already fetched and already
`visibleEmployeesFilter()`-scoped.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Token layer + chrome | Brand palette in `:root`; navy topbar, action bar, segmented tabs, month nav | A wrong OKLCH conversion is invisible in review and obvious on screen |
| 2. Close the auth fork | Light-brand `/auth/*`; five dark files deleted; errors route to `/` | A missed importer breaks the build; `.scaffold` siblings must not be touched |
| 3. Type metadata | Migration + seven-row catalogue; ordered reads; PRD amendment | drizzle-kit writes no `UPDATE` — the seven rows are hand-authored onto the generated diff |
| 4. Grid tab | Horizontal names, legend chips, cell icons, 💬/🔁 badges, rich tooltip | Restyling the header can break S-07's column DnD or reintroduce hover on weekends |
| 5. Details tab | Filter chips, grouped cards, six sortable columns, clickable rows | The prototype's filter semantics are inverted — porting them hides everything |
| 6. Statistics tab | KPI tiles, per-type bars, stacked bars, medals, days-only cells | The shared `/8` helper is now used by the balance service — rounding moves a visible number |
| 7. Balance + `Korekta` gate | Tile group, steppers, live preview, `Korekta` moderator-only | Hiding the input is not the rule — the server must preserve the stored value, not accept or reject it |
| 8. Modal + employee panel | Swatch type picker, avatar substitute picker, sectioned drawer | Partial-day gating and substitute exclusion rules must survive the picker rewrite |

**Prerequisites:** `DATABASE_URL_DIRECT` set for `drizzle-kit`; a non-moderator test account
for Phase 7's 403 paths; production deploy access (`deploy` fires automatically on push to `main`).

**Estimated effort:** ~27 files edited and 5 deleted across 8 phases — roughly 6–8 sessions.
This is above the project's previous ceiling of 18 files in one change; Phases 7 and 8 are the
cleanest place to cut if it runs long.

## Open Risks & Assumptions

- **Verification is production-only.** `wrangler dev` renders one of thirty-three surfaces —
  `dashboard.astro:198-201` collapses the body to "Błąd serwera" because Drizzle cannot reach
  Supabase under workerd. The post-deploy health check curls `/auth/signin` and stays green on
  a completely broken dashboard, so a green CI run proves nothing about a phase.
- **`main` is visibly half-restyled between phases.** Accepted because the app is pre-launch.
- **Two deliberate prior decisions are amended** on the user's ruling: S-15's ungated balance
  writes is narrowed to exempt `Korekta`, and S-02's separate days-and-hours reporting is
  reversed. Both are recorded in the plan with their source lines so review reads them as
  decisions, not drift.
- **`choroba` takes the colour `wyjazd zagraniczny` has today.** Anyone reading the grid from
  memory will misread it for one session — which is why the icons matter more than they look.
  Cheap to walk back if it lands badly: the palette is seven rows in `absence_types`, not code.
- **The change is 2.5× the frame's estimate**, because including auth and all four statistics
  blocks were later decisions. The seam is still one coherent outcome, but it is at the upper
  end of what this repo has shipped in a single change.

## Success Criteria (Summary)

- Every authenticated surface — sign-in through statistics — reads as one branded application,
  with no purple, no cosmic gradient and no stock shadcn card left anywhere.
- The grid answers "who, what, how long, why, who covers" from a hover, and Details answers
  "show me only sick leave this month" from two clicks, without either capability existing before.
- Absence types get their colour, icon and order from the database, so adding an eighth type
  stays a seed row rather than a code change.
