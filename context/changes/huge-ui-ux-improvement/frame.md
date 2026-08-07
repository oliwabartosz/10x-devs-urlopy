# Frame Brief: Adopt the new-design HTML/JS prototype as the app's UI/UX

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

A `claude.ai/design` prototype (`new-design/10xUrlopy.dc.html`, 1490 lines) exists
that looks and behaves differently from the shipped dashboard — different chrome,
different absence-type colours, extra statistics blocks, extra interactions.

## Initial Framing (preserved)

- **User's stated cause or approach**: The prototype is the target state of the app.
  What the app has now is a gap against it.
- **User's proposed direction**: One change — `huge-ui-ux-improvement` — that
  implements the prototype's UI, UX, and the functional improvements it implies.
- **Pre-dispatch narrowing**: All four observables selected (dashboard looks
  off-brand · grid hard to read/use · details/stats don't answer real questions ·
  general "this should be nicer"). Prototype declared **"a spec — details are
  intentional."** App is **pre-launch, nobody using it yet.**

## Dimension Map

The observation could originate at any of these dimensions:

1. **Design-system layer** — the app has no brand-token layer at all, so every
   screen invents its own look and re-diverges. Implementing the prototype's
   pixels without tokens treats the symptom.
2. **Spec-fidelity layer** — the prototype may not be uniformly a specification.
   If a measurable share is generator artifact, "details are intentional" plans
   against noise.
3. **Product-scope layer** — if ~40%+ is net-new capability, "UI/UX improvement"
   is the wrong label for a roadmap increment.
4. **Unit-of-work layer** — 33 deltas, ≥3 migrations, 6 decision conflicts in one
   change folder.  ← initial framing
5. **Verifiability layer** — no visual-regression net, snapshots ruled out,
   Drizzle unusable under `wrangler dev`.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **D1 — no design-token layer** | `global.css:7-40` is unmodified shadcn neutral, every value `oklch(L 0 0)`, chroma exactly 0; brand navy/gold absent from every CSS file. Token classes appear **59× inside `src/components/ui/*` and 3× in all hand-written app code**. 167 hardcoded palette classes over 27 files. **Three** live design languages, not two (`/` slate-NBP · `/dashboard` gray+blue tabs `:219` +purple links `Topbar.astro:22` · `/auth/signin` dark cosmic, reachable via `middleware.ts:44`). `main-page-redesign/reviews/impl-review.md` F2 named this exact gap, prescribed theme-parametrisation, marked **SKIPPED**. `@theme inline` socket at `global.css:76-112` sits ready and empty. | **STRONG** |
| **D2 — prototype is not uniformly a spec** | 25 distinct defects (research §6 listed 6). **`+ Dodaj pracownika` crashes** — `addStaff:1330` pushes `{first:'',last:''}` → `initialsOf(' ')` → `''[0].toUpperCase()` TypeError. **`Wyczyść filtry` hides everything** (`:1321` sets `hidden` to all type ids; `hasFilters:1446` inverted too). **Korekta copy contradicts its arithmetic** — `:468,:471` say it adds days, `:1399,:1404,:1426,:1431` all subtract (shipped app is correct: `HolidayBalanceDialog.tsx:125`). Split ≈**45% deliberate / 30% artifact / 25% ambiguous**; 21 undecidable items (C1–C21). Decisive shape: stats hours are computed in full (`hrs():1025`, `totalH`, `grandH`) then **discarded** — "we chose days" and "hours never got generated" produce **byte-identical output**. | **STRONG** |
| **D3 — product scope, not restyle** | **16 of 33 items are new capability** (~48%); 2 more are capability *removal*. **No roadmap slice covers any of them**; filtering was scoped out by name (`details-and-stats/plan-brief.md:26`). 5 of the 6 "locked decisions" are paper — no code, test or migration depends on them; S-02's "no assumed hours-per-day" is **already contradicted** by `holiday-balance.ts:62`'s `/8`. But §5 **omits the two constraints with real weight**, both in the untracked-by-§5 origin brief `projekt_urlopy_start.md`: Excel continuity (`:14` → `prd.md:56`) and the fact that 6 of 7 type colours map exactly to the institutional `--color-chart-*` palette (`:41-61`). **6 of 15 unarchived change folders hold decisions this would silently undo.** | **STRONG** |
| **D4 — unit of work** | Project median: **338-line plan, 7 phases, 10 files, 0 migrations**; all-time max 18 files / 3 migrations. This change: **~31 files, ≥3 migrations, 33 deltas** = 3.1× median, 1.7× max. Findings track size: `main-page-redesign` (2 files) → 2 findings APPROVED; `urlop-balance` (18 files, 3 migrations) → **missing RLS policy**, out-of-band prod `migration repair`, ad-hoc Phase 4; `drizzle-migration` (10 phases) → **5 rounds, 29 findings, a REJECT**. Roadmap skill self-review **hard-FAILS** a slice absorbing >2 unrelated user stories. Only 1 of 4 D-clusters (type metadata) is coupled to the restyle. | **STRONG** |
| **D5 — verifiability** | Not "unverifiable" — **unverifiable before production**. `wrangler dev` renders **1 of 33** surfaces: `dashboard.astro:198-201` collapses the whole body to "Błąd serwera", leaving only `Topbar.astro`. `playwright.config.ts:27-29` **defaults to the production URL by design** and is **not in CI** (1 spec, 49 lines). Visual diff and UI snapshots both explicitly excluded (`test-plan.md:119`, `:223`). The only post-deploy check curls `/auth/signin` — it passes on a fully broken dashboard. Deploy auto-fires on push to `main`. | **STRONG** |
| **Cross-check — steelman "one change"** | Argued deliberately for the initial framing; it broke. **Restyle-only = 11 src files + 1 additive migration on a 7-row lookup table + 1 PRD line.** Zero API routes (`absence_types` read in one place, `dashboard.astro:132`, via star select), zero test edits, zero `types.ts` edits (`$inferSelect` propagates columns free). **25 of 33 items are sub-30-line**; difficulty concentrates in **3 capabilities**, not 33 items. Coherence holds: the cell chip is complete without badges (`:830-834`), matrices complete without KPI tiles; only the Details filter card genuinely breaks (`:305-325`) at ~25 lines to fix. Splitting does **not** multiply review overhead — reviews are per-phase. | **Initial framing REFUTED** |

## Narrowing Signals

- **"I went through it deliberately."** The user reviewed the prototype and owns its
  design decisions. But B4/B1/B7 are **behavioural**, not visual — a crash behind a
  button that renders correctly, a filter whose label and effect are opposite, copy
  contradicting arithmetic you cannot see. Reviewing a rendered page cannot surface
  these. → The artifact is a **trustworthy visual spec and an untrustworthy
  behavioural one.** This is the single most important signal in the frame.
- **Radius/Excel fork resolved: prototype wins.** Origin brief's `--radius-card: 0`
  ("sharp jak w NBP", `:71-75`) and the Excel-continuity guardrail (`prd.md:56`) are
  superseded by decision. Both need a PRD amendment — no change in this repo has
  amended the PRD before.
- **Palette fork resolved: adopt the pastels wholesale**, including `choroba` →
  `#2f578c`. Supersedes the institutional `--color-chart-*` mapping. Retires S-09's
  `textColorForBg()` luminance heuristic, since the prototype ships explicit
  per-type foregrounds — item #9 is a **simplification, not a cost**.
- **Pre-launch dissolves app-muscle-memory, not Excel-muscle-memory.** The stated
  reason the grid looks as it does is the sheet it replaces. Now moot given the
  decision above, but it was not moot by virtue of "nobody's using it yet."

## Cross-System Convention

This project's convention is **one user-visible outcome per change** — the roadmap's
column header is literally "Outcome (użytkownik może …)", and its generating skill
hard-FAILS a slice spanning more than two unrelated user stories. Realised slices are
small: S-13 added one lookup row, S-14 one form gate, S-16 two files. The leading
hypothesis matches the convention; the initial framing does not.

Cutting at the restyle seam produces a **median-sized change** (11 files, 1 additive
migration), which is exactly the shape this project ships successfully — and the shape
whose review history is 2 findings and an APPROVED, rather than 29 findings and a REJECT.

## Reframed Problem Statement

> **The actual problem to plan around is**: the dashboard has no design-token layer
> to adopt the prototype *into*, and "implement `new-design/`" bundles that gap with
> a median-sized restyle and three product capabilities of undefined semantics into
> a single unit that can only be verified in production.

The initial framing was **not** wrong about the destination — the design decisions are
the user's, the prototype is a genuine spec for how the app should look, and adopting
it is the right goal. It is wrong about the **unit** and about **which layer of the
artifact is authoritative**. Three capabilities (priority flag, drag-to-select
multi-day writes, batch holiday balances) are blocked on product questions that no
amount of CSS answers: `UNIQUE(employee_id, date)` (`schema.ts:59`) already makes the
priority flag decorative and "kolizja terminów" undefined; multi-day writes have no
overlap policy against the existing `23505`→409 path; the utilisation bars need an
endpoint that does not exist and that the prototype **fakes** (`:1144` hardcodes 26
days for everyone). Dragging those three through planning would block every line of
CSS behind three unanswered product decisions — and would put a new column on the
live `absences` table inside the same change that can only be eyeballed in production.

Separately, the prototype must be treated as a **visual** specification only. Its
behavioural layer contains a reachable crash, an inverted core interaction, and copy
that contradicts a financial calculation — all of which look correct in a screenshot
and would ship verbatim under "details are intentional."

## Confidence

**HIGH** — five hypotheses independently returned strong file-level evidence; the
convention check matches; three decisive user answers resolved the open forks; and a
deliberate steelman of the original framing was run and broke on its own enumeration
(the restyle-only slice it was asked to price turned out to be median-sized, which
demonstrates the seam rather than dissolving it).

## What Changes for /10x-plan

Plan the **token layer + restyle** as the first change (~11 files, 1 additive
migration on `absence_types`: `icon`, `text_color`, `display_order`) — including the
Details filter chips (~25 lines), without which the filter card ships 80% empty. Note
that restyling Details to the prototype's 5-column grid **forces the FR-006 `Dodano`
decision** — that is a ruling to make, not code to write. Carry the PRD amendment for
palette and radius. Treat `new-design/` as a visual spec: do **not** port `clearFilters`
(`:1321`), `addStaff`/`initialsOf` (`:1330`, `:926`), or the Korekta help copy
(`:468`, `:471`). The three D-capabilities become separate changes, each opening with
its product question answered first. Land `eslint.config.js`'s `{ ignores: ["new-design/**"] }`
in the same commit as `new-design/` or CI goes red — the folder is untracked and not
gitignored.

## References

- Source files: `new-design/10xUrlopy.dc.html`; `projekt_urlopy_start.md:14,41-61,71-75`;
  `src/styles/global.css:7-40,76-112`; `src/components/absence/AbsenceGrid.tsx`;
  `src/pages/dashboard.astro:132,198-201`; `src/db/schema.ts:31-36,59`;
  `playwright.config.ts:27-29`; `context/foundation/test-plan.md:119,223`;
  `context/archive/2026-08-06-main-page-redesign/reviews/impl-review.md` (F2, SKIPPED)
- Related research: `context/changes/huge-ui-ux-improvement/research.md`
- Investigation tasks: #1 (design-system), #2 (spec fidelity), #3 (product scope),
  #4 (unit of work + verifiability), plus an unnumbered cross-check steelman
