# Adopt the new-design prototype: token layer + restyle — Implementation Plan

## Overview

Introduce the brand design-token layer the app has never had, and restyle every dashboard
surface to `new-design/10xUrlopy.dc.html`. Carries one additive migration on `absence_types`
(`icon`, `text_color`, `display_order`), closes the dark/light fork on the sign-in screens by
deleting the duplicated dark primitives, and adds a moderator gate on holiday-balance writes.

The three capabilities the frame carved out — the priority flag, drag-to-select multi-day
writes, and the batch holiday-balance endpoint behind `Podgląd wykorzystania urlopów` — are
**not** in this change. Each opens its own change with its product question answered first.

## Current State Analysis

**There is no design-token layer.** `src/styles/global.css:7-40` is the unmodified shadcn
neutral palette: every value is `oklch(L 0 0)`, chroma exactly zero. The brand navy `#072143`,
gold `#c5ac75` and focus blue `#b4dceb` appear exactly six times in `src/`, all on the login
card. The dashboard uses zero brand colour. The `@theme inline` block at `global.css:76-112`
already maps every shadcn semantic token through to a Tailwind utility — the socket is wired
and empty, so brand adoption is a `:root` value swap, not new plumbing.

**Three design languages are live**: `/` is light slate-with-NBP-navy, `/dashboard` is
gray-50 with `blue-600` tabs and purple topbar links, `/auth/signin` is the dark cosmic
starter theme, reachable from `middleware.ts:44` and from every failed sign-in
(`api/auth/signin.ts:13,18`).

**The information architecture already matches the prototype.** Rows are days and columns
are employees (`AbsenceGrid.tsx:231,243`), tabs are `?tab=grid|details|stats`
(`dashboard.astro:32-33`), sub-tabs are `?subcard=today|monthly|yearly` (`:35-37`), the
balance card sits above the tabs (`:207-214`), and the partial-day rule
(`src/lib/absence-types.ts:7-16`) is reproduced exactly by the prototype's gating. What
changes is the skin, the density, and the affordances — not the structure.

**`absence_types` is `id` / `name` / `color`** (`src/db/schema.ts:31-36`). No icon, no
foreground colour, no display order. Order today is `ORDER BY id` (`dashboard.astro:132`).

**Auth is duplicated, not shared.** `LoginCardForm.tsx` (light, Polish, brand, ~220 lines)
implements its own inputs, password toggle, server-error block and submit button. The dark
`SignInForm.tsx` + `FormField.tsx` + `PasswordToggle.tsx` + `ServerError.tsx` +
`SubmitButton.tsx` serve only `/auth/signin`. Both POST to the same endpoint. There is no
live `signup.astro` — only a `.scaffold`.

**Holiday-balance writes are deliberately ungated.** `POST /api/holiday-balances` carries the
comment *"Both roles may edit any balance — no role gate on the write"* (`index.ts:147`), and
`DELETE .../[id].ts` follows the same rule. This traces to an explicit S-15 decision
(`context/archive/2026-06-22-urlop-balance/plan.md:34,211`).

## Desired End State

Every authenticated surface renders in one brand language: navy chrome, gold accents, white
14px-radius cards on a `#f4f4f4` page, `#c8c8c8` hairlines. The seven absence types carry
their pastel colour, an explicit foreground colour, an emoji icon and a stable order, all
sourced from the database. The grid cell shows type colour + icon + label + optional time
range, with 💬 and 🔁 badges and a rich multi-line tooltip. Details filters by type and opens
rows for editing. Statistics carries KPI tiles, a per-type breakdown, stacked mini-bars and
medals. Sign-in is one light-brand card, reachable from one route.

Verify by walking the app on production after each phase (see Testing Strategy).

### Key Discoveries:

- `@theme inline` at `global.css:76-112` already maps all 20+ semantic tokens — no new
  mapping layer is needed, only `:root` values plus names for the three greys shadcn has
  no slot for.
- `textColorForBg()` has exactly one caller (`AbsenceGrid.tsx:27,270`) — `text_color` is a
  net deletion, not an addition.
- `LoginCardForm` shares nothing with the dark auth primitives, so closing the theme fork
  deletes five files instead of parametrising them. This resolves S-16's F2 (duplicated
  primitives) and F1 (inert `useFormStatus`, still live in `SubmitButton.tsx:12`) by removal.
- `index.astro:12` already reads `?error` and forwards it to `LoginCardForm`, but nothing
  routes there — redirecting sign-in failures to `/` activates existing dead code.
- `AbsenceStats.tsx:22-40` keeps `{days, hours}` as separate accumulator fields and merges
  only at render (`cellText`, `:37`), so switching to days-only is a display change plus one
  conversion, not a data-shape change.
- The `/8` divisor is already duplicated at `holiday-balance.ts:10` and `AbsenceStats.tsx:12`.
- `drizzle.config.ts` outputs to `supabase/migrations/` with `prefix: "supabase"`.
- No live `signup.astro` exists — only `signup.astro.scaffold`. `.scaffold` files are not
  linted or built; leave them untouched.
- `eslint.config.js` already carries `{ ignores: ["new-design/**"] }` uncommitted.

## What We're NOT Doing

- **The priority flag** (`absences.priority`, 🅿️ badge, modal checkbox). Separate change;
  `UNIQUE(employee_id, date)` already makes it decorative and "kolizja terminów" is undefined.
- **Drag-to-select multi-day writes.** Separate change; needs an overlap policy against the
  existing `23505`→409 path and either a bulk endpoint or partial-failure reporting.
- **`Podgląd wykorzystania urlopów`** (per-employee utilisation bars) and the employee-row
  `Wymiar: X dni · korekta Y` line. Both need a batch-balance endpoint that does not exist
  and that the prototype fakes (`10xUrlopy.dc.html:1144` hardcodes 26 days for everyone).
- **Relocating `Korekta` / `Do dnia`** into the employee modal, and merging the identity and
  entitlement dialogs. Coupled to the batch-balance work above.
- **Porting the prototype's behavioural layer.** Specifically: `clearFilters` (`:1321`, sets
  `hidden` to every type id — hides everything), `addStaff` / `initialsOf` (`:1330`, `:926` —
  reachable TypeError), the Korekta help copy (`:468`, `:471` — says it adds days while every
  arithmetic path subtracts), the stubbed `const today = 1` (`:998`), the fabricated `HIST`
  array (`:1082-1091`), and the dead `SELECT_*` styles (`:621-627`).
- **`showTimeRanges` / `weekendShading` / `rowHeight` settings** (`:598`). Prototype-harness
  props, not product surface. Adopt their default values as fixed behaviour.
- **Optimistic mutations.** Every dialog keeps `window.location.reload()`. Worth revisiting
  when multi-day writes land, not before.
- **Server-side aggregation for statistics.** Everything added here is client-computable from
  data already fetched.
- **Amending FR-006.** `Dodano` stays as a visible sixth column.
- **Deleting `new-design/`.** Its README says to remove it after implementation; that happens
  when the deferred capabilities are also built, not here.

## Implementation Approach

Bottom-up: tokens first, so every later phase consumes names rather than hex; then the data
layer (`absence_types` metadata), so the three tab phases can read icon/colour/order straight
off the row; then one phase per tab; then the dialogs.

Phase 2 (auth) is deliberately early and independent — it is the only surface `wrangler dev`
can render, so it is the one phase with a local feedback loop, and doing it right after the
tokens land proves the token layer on a real screen before six phases depend on it.

Each phase merges to `main`, `deploy` fires, and verification happens on production before
the next phase starts. The app is pre-launch.

## Critical Implementation Details

**`drizzle-kit` does not know the `color` CHECK exists.** `absence_types.color` carries a
DB-level `color ~ '^#[0-9a-fA-F]{6}$'` constraint, declared inline at table creation
(`supabase/migrations/20260526000001_schema.sql:33`) and therefore auto-named
`absence_types_color_check` by Postgres. Drizzle cannot represent it, so it is absent from
`schema.ts` (only a comment at `:33`) and from drizzle-kit's snapshot.

For a pure `ADD COLUMN` this is harmless — Postgres leaves existing constraints untouched, so
the check survives the migration. **Do not re-add it**: an `ALTER TABLE … ADD CONSTRAINT
absence_types_color_check` will fail with "constraint already exists" and abort the migration.
Verify it is still present after `db:migrate` rather than recreating it.

The rule from `AGENTS.md:58` is to *read the generated diff*, not to blindly re-add
constraints: drizzle-kit is blind to this check, so any future operation that rewrites the
table would drop it without saying so. Confirm the diff contains three `ADD COLUMN` statements
and nothing else — no `DROP`, no `ALTER COLUMN` on `color`. The same blindness applies to
`absences_time_check`, which is not touched here.

**The migration is two things drizzle-kit only writes one of.** It generates the three
`ADD COLUMN` statements; the `UPDATE` that gives the seven seeded rows their new colours,
foregrounds, icons and order is hand-authored and must be appended to the same file. Order
matters: add columns with defaults, then update, so no row is ever left with a colour that
fails the re-added CHECK.

**The `Korekta` gate narrows an explicit S-15 decision**, so it must be implemented as a
field-level rule, not a route-level one. `urlop-balance/plan.md:34` chose "both roles can edit
any balance" deliberately, and it still holds for `current_entitlement_days`, `carryover_days`
and `valid_until`. Only `used_adjustment_days` becomes moderator-only. Because the dialog does
a full replace of all four fields (`HolidayBalanceDialog.tsx:18-19`), a non-moderator's request
must have its adjustment value *ignored and the stored one preserved* — returning 403, or
accepting the submitted value, are both wrong. Update the comment at `index.ts:147`, which
currently claims the ungated rule for every field.

**`choroba` takes the colour `wyjazd zagraniczny` has today** (`#2f578c`). Anyone reading the
grid from memory will misread it for one session. This is accepted, and it is why the legend
chips and cell icons matter more than they look — the icon, not the colour, becomes the fast
discriminator. The palette lives entirely in `absence_types.color`, so reverting or adjusting
it later is seven `UPDATE` statements, not a code change and a redeploy.

**Weekend rows must stay non-interactive.** `AbsenceGrid.tsx:248` gates clickability on
`!isWeekend`; the prototype omits the handlers entirely for weekends (`:791-792`, `:839-841`).
Restyling the row background must not reintroduce a hover affordance on a cell that cannot be
clicked.

**Column drag-and-drop survives.** `AbsenceGrid.tsx:193-227` (`@dnd-kit`, delivered by S-07)
stays. S-07 learned that CSS `transform` must never touch a `<th>` in a table layout and that
listeners must sit on the handle, not the header (`context/changes/employee-grid-order/plan.md:16,51,259`).
Restyling the header must preserve both.

**`visibleEmployeesFilter()` guards the `is_system` admin.** Any new employee-derived surface
added here — initials avatars in Details, the substitute avatar row, the KPI
`Pracownicy z nieobecnością` denominator — must derive from the already-filtered
`gridEmployees` / `allEmployees` props, never from a fresh query
(`context/changes/admin-bootstrap/plan.md:22,37,180`).

## Phase 1: Token layer and chrome

### Overview

Establish the brand palette as `:root` tokens, then rebuild the topbar, action bar, month
navigation, tab control and page container to the prototype's chrome.

### Changes Required:

#### 1. Brand tokens

**File**: `src/styles/global.css`

**Intent**: Replace the achromatic shadcn `:root` values with the NBP brand palette so every
existing `bg-primary` / `text-primary` / `ring` usage across the 59 shadcn-token call sites
flips to brand without touching those files. Add named tokens for the three prototype greys
that have no shadcn semantic slot. Raise the card radius to the prototype's 14px.

**Contract**: `:root` gains brand values for `--primary` (navy `#072143`), `--primary-foreground`
(white), `--accent` / `--accent-foreground` (gold `#c5ac75` on navy), `--ring` (`#b4dceb`),
`--background` (surface `#f4f4f4`), `--card` (white), `--border` (`#c8c8c8`),
`--muted-foreground` (`#6f6f6f`), `--destructive` (`#e50040`). `--radius` becomes `0.875rem`
(14px) so `--radius-lg` matches the prototype's card. Three new tokens are declared in `:root`
and exposed through the existing `@theme inline` block: `--surface` (page `#f4f4f4`),
`--line` (hairline `#c8c8c8`), `--line-strong` (header rule `#e8e8e8` / `#c8c8c8` pair per
`10xUrlopy.dc.html:104`, `:619-620`). The `@custom-variant dark` declaration and the `.dark`
block stay for now; Phase 2 removes `@utility bg-cosmic` once its last caller is gone.

Convert brand hexes to OKLCH to match the file's existing notation, and verify the rendered
navy against `#072143` — a wrong conversion is invisible in code review and obvious on screen.

#### 2. Top bar

**File**: `src/components/Topbar.astro`

**Intent**: Replace the white rounded card with purple English links by the prototype's
full-bleed navy bar: 56px tall, email plus a gold uppercase role pill on the left, `Dashboard`
and `Sign out` in white on the right.

**Contract**: The component stops carrying its own margin and rounding — it becomes a
full-width band, so `dashboard.astro` must no longer wrap it in the `px-4 pt-4` container.
Role pill renders only for `role === "moderator"`, uppercase, `letter-spacing:.06em`, gold
background with navy text, fully rounded (`10xUrlopy.dc.html:20-29`). Keep both link labels
in English to match the prototype verbatim.

#### 3. Action bar, page container, month nav and tabs

**File**: `src/pages/dashboard.astro`

**Intent**: Give the `Pracownicy` button its own white 60px bar under the topbar, wrap page
content in the prototype's centred `max-width:1480px` container, and replace the underlined
tab links with the segmented pill control. Move the moderator button out of the topbar's
container.

**Contract**: Structure becomes: full-bleed `Topbar` → full-bleed white action bar with a
bottom hairline holding `EmployeeManagementSheet` (moderator only) → `max-width:1480px`
container with `28px 32px 56px` padding. The tab nav at `:216-235` becomes a single bordered
pill group, navy fill on the active segment, `#6f6f6f` text with a left hairline on inactive
segments (`:46-50`, styles at `:635-637`). Row layout at the top of the container is month nav
on the left, tab group on the right (`:41-51`). The three `?tab=` hrefs and the
`prevMonthUrl` / `nextMonthUrl` construction (`:165-182`) are unchanged — this is a restyle of
anchors, not a move to client state.

Non-moderators render no action bar. Decide whether the bar collapses or renders empty and
keep it consistent — an empty 60px white band above the content is acceptable and simpler.

#### 4. Month navigation

**File**: `src/components/MonthNav.astro`

**Intent**: Restyle to the prototype's 36px rounded-square `‹` / `›` buttons flanking a 24px
navy month heading with a fixed centre width so the heading does not shift between months.

**Contract**: Buttons are 36×36, `border-radius:10px`, `#c8c8c8` border on white, navy glyph,
inverting to navy fill with white glyph on hover (`:42-44`). Heading is 24px bold navy with
`min-width:220px; text-align:center` (`:43`). Keep the existing `Intl.DateTimeFormat("pl-PL")`
label and both `aria-label`s.

#### 5. Prototype folder and lint gate

**File**: `eslint.config.js`, `new-design/`

**Intent**: Commit the untracked prototype together with the ESLint ignore entry that already
exists in the working tree, so CI does not go red on the ~1490 errors `support.js` contributes.

**Contract**: `{ ignores: ["new-design/**"] }` must sit before the `baseConfig` spread and
after `includeIgnoreFile(gitignorePath)` — its current position. Both land in one commit.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Unit tests pass: `npm run test:run`

#### Manual Verification:

- Topbar is full-bleed navy with a gold moderator pill; no purple remains anywhere on `/dashboard`
- Action bar renders as a white band with the navy `Pracownicy` button, gold on hover
- Tab group is a single bordered pill; the active segment is navy and switching tabs preserves `?month=`
- Month nav heading does not shift horizontally when stepping between months
- Content is centred at 1480px max width on a wide screen and does not overflow at 1280px
- The rendered navy matches `#072143` when sampled, not a near approximation

**Implementation Note**: Merge to `main`, let `deploy` fire, verify on production, and pause
for confirmation before Phase 2.

---

## Phase 2: Close the auth theme fork

### Overview

Make `/auth/*` light-brand by pointing it at the login card `/` already uses, delete the five
dark primitives that then have no callers, and route sign-in failures back to `/`.

### Changes Required:

#### 1. Sign-in page

**File**: `src/pages/auth/signin.astro`

**Intent**: Stop rendering the dark cosmic card. Render the same light-brand shell and
`LoginCardForm` that `/` uses, so there is exactly one login surface visually and one form
component behind it.

**Contract**: Page imports `LoginCardForm` (default export, prop `serverError?: string | null`)
instead of `SignInForm`, and reuses the shell markup from `index.astro:16-38` — centred
`max-w-md` column, navy `CalendarCheck` badge, `Nieobecności` wordmark, white card with the
footer strip. Title becomes Polish. `?error` continues to be read from the URL and forwarded.

Extracting the shared shell into a small component is optional; duplicating ~20 lines of
markup across two pages is acceptable if extraction would add a third file.

#### 2. Confirm-email page

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: Restyle from the dark glass card to the light-brand card so the post-registration
screen matches, and point its back-link at the single login route.

**Contract**: `bg-cosmic` and the `from-blue-200 to-purple-200` gradient heading are replaced
by the light card treatment; body copy stays as-is. The `Back to sign in` / `Go to sign in`
link targets `/`. Copy may stay English — this screen is unreachable in the current flow
(no live signup page) and translating it is out of scope.

#### 3. Sign-in failure routing

**File**: `src/pages/api/auth/signin.ts`, `src/middleware.ts`

**Intent**: Send authentication failures and protected-route redirects to `/` rather than
`/auth/signin`, so users always land on the branded card. This activates the `?error` reader
at `index.astro:12`, which is currently dead.

**Contract**: `signin.ts:13` and `:18` redirect to `/?error=…` instead of
`/auth/signin?error=…`; the success redirect to `/` at `:21` is unchanged.
`middleware.ts:44` redirects unauthenticated protected-route requests to `/`.
`/auth/signin` remains a valid route rendering the same card — it is not removed, so any
bookmark or scaffold reference keeps working.

#### 4. Delete the dark primitives

**File**: `src/components/auth/SignInForm.tsx`, `FormField.tsx`, `PasswordToggle.tsx`,
`ServerError.tsx`, `SubmitButton.tsx`; `src/styles/global.css`

**Intent**: Remove the five components that now have no callers. This closes S-16's F2
(duplicated auth primitives) and F1 (the inert `useFormStatus` spinner, `SubmitButton.tsx:12`)
by deletion rather than by parametrisation, and removes the last `bg-cosmic` caller.

**Contract**: All five `.tsx` files are deleted. Their `.scaffold` siblings are **not** touched
— they are inert templates, unlinted and unbuilt. `@utility bg-cosmic` is removed from
`global.css`. Confirm zero remaining importers with a grep across `src/` before deleting;
`SignUpForm.tsx.scaffold` referencing them is not an importer.

### Success Criteria:

#### Automated Verification:

- Lint passes with no unused-import or unresolved-import errors: `npm run lint`
- Build passes: `npm run build`
- No source file imports a deleted component: `grep -rn "SignInForm\|FormField\|PasswordToggle\|ServerError\|SubmitButton" src/ --include="*.tsx" --include="*.astro"` returns only `.scaffold` paths
- No `bg-cosmic` references remain: `grep -rn "bg-cosmic" src/` is empty

#### Manual Verification:

- `/auth/signin` renders the light brand card, identical to `/`
- A failed sign-in from `/` lands back on `/` with the error visible inside the card
- Visiting `/dashboard` while signed out lands on `/`, not on a dark page
- The submit button shows its pending state during the POST navigation
- `/auth/confirm-email` renders light-brand

**Implementation Note**: This is the one phase whose primary surface renders under
`wrangler dev` — verify locally first, then merge, deploy and confirm on production before
Phase 3.

---

## Phase 3: Absence-type metadata

### Overview

Add `icon`, `text_color` and `display_order` to `absence_types`, populate all seven rows with
the prototype's catalogue, order every read by `display_order`, and amend the PRD's colour map.

### Changes Required:

#### 1. Schema

**File**: `src/db/schema.ts`

**Intent**: Extend `absence_types` with the three metadata columns the prototype needs, keeping
types as data rather than a name-keyed code map (S-13's principle,
`context/archive/2026-06-22-urlop-planowany-category/plan-brief.md:11-13`).

**Contract**: `absence_types` gains `icon: text("icon").notNull().default("")`,
`text_color: text("text_color").notNull().default("#000000")`, and
`display_order: integer("display_order").notNull().default(0)`. `Employee.display_order`
already uses this exact shape (`schema.ts:24`) — mirror it. `types.ts` needs no edit:
`AbsenceType` derives via `$inferSelect`.

#### 2. Migration

**File**: `supabase/migrations/<generated>.sql`

**Intent**: Add the three columns and set the prototype's catalogue on the seven seeded rows
in one migration.

**Contract**: Generate with `npm run db:generate`, then **inspect and hand-edit the diff**
before `db:migrate`:
1. Confirm the three `ADD COLUMN` statements are present with their defaults, and that the
   diff contains nothing else — no `DROP`, no `ALTER COLUMN` on `color`.
2. Do **not** add `absence_types_color_check` — it already exists and survives `ADD COLUMN`;
   recreating it aborts the migration. Verify it is still present afterwards instead.
3. Append a hand-authored `UPDATE` per row, keyed on `name`, applying:

   | `name` | `color` | `text_color` | `icon` | `display_order` |
   |---|---|---|---|---|
   | `urlop` | `#cceeff` | `#0b5a72` | 🌴 | 1 |
   | `szkolenie/wyjście poza miejsce pracy` | `#ffcc99` | `#8a4a00` | 🏃🏼‍♂️‍➡️ | 2 |
   | `szkolenie w miejscu pracy` | `#ffe8a8` | `#7a5b00` | 🎓 | 3 |
   | `choroba` | `#2f578c` | `#ffffff` | 🤒 | 4 |
   | `wyjazd zagraniczny` | `#f2a3a3` | `#7d0d1c` | 🌍 | 5 |
   | `stała nieobecność` | `#ccffcc` | `#2c5c2c` | 🚫 | 6 |
   | `urlop planowany` | `#99ccff` | `#0b3f6b` | 📅 | 7 |

Source: `new-design/10xUrlopy.dc.html:599-607`. The offsite-training icon is a multi-codepoint
ZWJ sequence — copy it byte-for-byte and confirm the file is written as UTF-8. Columns must be
added before the `UPDATE`; the reverse order cannot work. Every new colour is a valid
six-digit hex, so the live `color` CHECK passes throughout.

#### 3. Ordered reads

**File**: `src/pages/dashboard.astro`

**Intent**: Serve absence types in the catalogue's intended order rather than insertion order,
so the legend, pickers and stats columns all agree.

**Contract**: The types query at `:132` orders by `asc(absence_types.display_order)` with
`asc(absence_types.id)` as a stable tiebreak. `db.select()` is a star select, so the three new
columns propagate to every consumer with no other edit.

#### 4. PRD amendment

**File**: `context/foundation/prd.md`

**Intent**: Record that the canonical absence-type colour map has been superseded by the
prototype's palette, so the PRD stops contradicting the database.

**Contract**: The colour-mapping sentence at `:107` is replaced with the seven-row map above,
including `urlop planowany` (absent from the current list), and notes that each type also
carries a foreground colour and an icon. FR-006 at `:82` is **not** touched — `Dodano` stays.

### Success Criteria:

#### Automated Verification:

- Generated diff contains exactly three `ADD COLUMN` statements on `absence_types` and no `DROP`
- Migration applies cleanly: `npm run db:migrate`
- `absence_types_color_check` still exists after migration (query `pg_constraint` for the table)
- All seven rows have non-empty `icon`, a valid `text_color` and a distinct `display_order` in 1..7
- Build and lint pass: `npm run build`, `npm run lint`

#### Manual Verification:

- Grid legend lists types in the order urlop → szkolenie poza → szkolenie w → choroba → wyjazd → stała → urlop planowany
- Existing absences render in their new colours with no missing or broken cells
- The offsite-training icon renders as a single glyph, not as separate emoji fragments
- Statistics matrix columns follow the same order as the legend

**Implementation Note**: This phase changes visible colours before any component knows about
`text_color`, so contrast will be briefly poor on `choroba` (white text is not yet applied).
That is expected and is fixed in Phase 4. Merge, deploy, verify, pause.

---

## Phase 4: Grid tab

### Overview

Restyle the grid to the prototype: horizontal employee names, legend chips with dot and icon,
cell chips carrying icon + explicit foreground + time range, comment and substitute badges,
and a rich multi-line tooltip.

### Changes Required:

#### 1. Grid header and legend

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Render employee names horizontally instead of rotated, and turn the flat legend
swatch row into the prototype's chip group.

**Contract**: The `writingMode: vertical-rl` style at `:74` and `:212` is removed; header
cells become `flex:1 1 0; min-width:120px`, centred, 13px bold on the `#e8e8e8` header band
with a 2px bottom rule and `#c8c8c8` cell dividers (`10xUrlopy.dc.html:104-111`). The day
column is 132px fixed, showing the day number right-aligned at 22px min-width followed by the
Polish short weekday in `#6f6f6f` (`:112-116`, `DAY_STYLE` at `:617`).

Legend at `:291-300` becomes chips: colour dot + icon + label, preceded by the uppercase
`Typy nieobecności` label, with the hint text on the right of the card header (`:90-102`).
Drop the prototype's "Przeciągnij, aby zaznaczyć zakres dni." half of the hint — that gesture
is not in this change; keep only "Kliknij komórkę, aby dodać."

Column drag-and-drop (`:193-227`) is preserved: keep listeners on the handle, and keep CSS
`transform` off the `<th>` (`context/changes/employee-grid-order/plan.md:16,51,259`).

#### 2. Cell chip and badges

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Give each occupied cell the prototype's four signals — type colour with its own
foreground, the icon, the time range for partial days, and badges for comment and substitute —
so information already in the database becomes visible without opening a dialog.

**Contract**: The chip reads `backgroundColor` from `type.color` and `color` from
`type.text_color`; `textColorForBg()` at `:27` and its call at `:270` are **deleted**. Chip
content is icon + label, with the time range appended for `is_full_day === false`
(`:118-138`, built at `:801-842`). Badges: 💬 when `comment` is non-empty and, top-left, 🔁
plus the substitute's initials when `substitute_employee_id` is set — initials derive from the
already-loaded `employees` prop, never a fresh query. Do not port the 🅿️ badge; the column
does not exist.

Weekend rows keep `background:#f4f4f4` and stay non-interactive — the `!isWeekend` term in the
clickability rule at `:248` is unchanged, and no hover treatment may be applied to a
non-clickable cell.

Initials must tolerate a name whose tokens contain no letters; the prototype's `initialsOf`
(`:925-927`) throws on that input and must not be copied as written.

#### 3. Cell tooltip

**File**: `src/components/absence/AbsenceGrid.tsx`

**Intent**: Replace the bare type-name `title` with the prototype's multi-line summary so a
hover answers who, when, what, how long, why and who covers.

**Contract**: `title` at `:266` becomes a newline-joined string: employee name, formatted
date, type name, hours or "cały dzień", comment when present, substitute when present
(`:804-813`). Omit the priority line. Native `title` is sufficient — no tooltip primitive is
installed and adding one is out of scope.

### Success Criteria:

#### Automated Verification:

- Lint and build pass: `npm run lint`, `npm run build`
- Unit tests pass: `npm run test:run`
- `textColorForBg` no longer exists: `grep -rn "textColorForBg" src/` is empty

#### Manual Verification:

- Employee names read horizontally and ten columns fit without horizontal scroll at 1480px
- `choroba` cells show white text on navy; every other type's text is legible against its pastel
- Cells with a comment show 💬; cells with a substitute show 🔁 plus correct initials
- Partial-day training cells show their time range; full-day cells do not
- Hovering a cell shows the full multi-line summary
- Weekend rows are shaded, show no hover state, and cannot be clicked
- Moderator column reordering still works and the dragged column does not visually detach
- Deactivated employees keep their grey header and `(nakt.)` suffix and stay non-clickable

**Implementation Note**: Merge, deploy, verify, pause.

---

## Phase 5: Details tab

### Overview

Add the filter card with working type-filter chips, restyle results into grouped cards with a
pluralised count and empty state, restyle the table with full sorting and clickable rows, and
keep `Dodano` as a sixth column.

### Changes Required:

#### 1. Filter card

**File**: `src/components/absence/AbsenceDetailsSubcards.tsx`

**Intent**: Replace the plain Dzisiaj/Miesięcznie/Rocznie button row with the prototype's
filter card: a segmented range control plus icon-only type-filter chips and a clear control.
Type filtering is new capability — the app has no filtering anywhere today.

**Contract**: The card holds the three range segments (styled per `SEG_ON` / `SEG_OFF`,
`:634-635`) on the left and the type chips plus `✕ Wyczyść filtry` on the right (`:305-325`).
Chips are icon-only, one per absence type in `display_order`, toggling that type's visibility.

**Filter state semantics — do not port the prototype's.** Hold the set of *hidden* type ids;
`Wyczyść filtry` sets it to **empty** (everything visible). The prototype's `clearFilters`
(`:1321`) sets it to every type id, hiding everything, and its `hasFilters` (`:1446`) and
`clearStyle` (`:1447`) are inverted to match. The correct rule is: the clear control renders
active only when at least one type is hidden, and clearing restores all.

Range selection stays URL-backed via `?subcard=` (`dashboard.astro:35-37`). Type filters are
client state only — do not add a new URL param.

#### 2. Result grouping

**File**: `src/components/absence/AbsenceDetailsSubcards.tsx`

**Intent**: Present each result group as its own card with a Polish-pluralised entry count and
a proper empty state, replacing the current bare `<h3>` + table sections.

**Contract**: Each group (`Dzisiaj` / `Ten tydzień` / `Następny tydzień` for the today range,
the month name for monthly, the year for yearly) renders as a white 14px card with a header
carrying the group label and a count. Pluralisation follows Polish rules: `1 wpis`,
`2–4 wpisy`, `5+ wpisów`, with the 12–14 exception (`:327-345`, `:1009-1013`). Empty groups
render `Brak nieobecności` rather than an empty table. Existing loading and error states
(`:161-166`) are preserved.

The prototype's `const today = 1` stub (`:998`) is not ported — the existing `getWeekRange()`
(`:21-40`) is correct and stays.

#### 3. Table

**File**: `src/components/absence/AbsenceDetailsTable.tsx`

**Intent**: Restyle to the prototype's row design — coloured type pill, comment inline beneath
it, initials avatar for the person — make every column sortable with the ↑/↓/↕ glyphs, and
make rows open the absence dialog for editing.

**Contract**: Columns stay at **six**: Data, Typ, Pracownik, Zastępstwo, Czas, **Dodano**.
FR-006 (`prd.md:82`) requires creation date and is not being amended; the prototype's
five-column layout is deliberately diverged from here. All six sort, replacing the current
four (`:97-143`), with `↑` / `↓` on the active column and `↕` on the rest (`:1210-1216`).

Rows become clickable and open the same `AbsenceFormDialog` the grid uses, subject to the same
permission rule as the grid cell (`AbsenceGrid.tsx:248`): own absence, or moderator. Rows the
caller may not edit stay inert with no hover affordance.

The type cell renders a pill in `type.color` / `type.text_color` with the icon; the comment
moves out of its own column and renders in quotes beneath the pill; the person cell gains a
coloured initials avatar (`:348-367`). Avatar colours are index-derived from the passed
`employees` array (`:871`) — never from a fresh query, so `is_system` stays invisible.

### Success Criteria:

#### Automated Verification:

- Lint, build and tests pass: `npm run lint`, `npm run build`, `npm run test:run`

#### Manual Verification:

- Toggling a type chip hides exactly that type's rows across all groups
- `Wyczyść filtry` restores all types; it renders active only while something is hidden
- Group headers show correct Polish plurals for 1, 2, 5 and 12 entries
- An empty group shows `Brak nieobecności`, not an empty table
- All six columns sort in both directions and the glyph tracks the active column
- `Dodano` is present and sortable
- Clicking an editable row opens the dialog pre-filled; saving updates the row
- A non-moderator clicking someone else's row gets no dialog and no hover cue
- Comments appear in quotes under the type pill; avatars show correct initials
- Switching range segments preserves `?subcard=` in the URL

**Implementation Note**: Merge, deploy, verify, pause.

---

## Phase 6: Statistics tab

### Overview

Add KPI tiles, the per-type breakdown, per-row stacked mini-bars and medals; restyle both
matrices; and switch cells to a single day figure via a shared hours-to-days helper.

### Changes Required:

#### 1. Shared hours helper

**File**: `src/lib/hours.ts` (new), `src/lib/services/holiday-balance.ts`,
`src/components/absence/AbsenceStats.tsx`

**Intent**: The `/8` divisor is about to be load-bearing in a third place. Extract it once and
convert the two existing duplicate definitions to import it, so this change nets zero new
copies rather than adding one.

**Contract**: New module exports `FULL_DAY_HOURS = 8` and `hoursToDays(hours: number): number`.
`holiday-balance.ts:10` and `AbsenceStats.tsx:12` drop their local constants and import from
it. Dependency-free, like `src/lib/absence-types.ts`, so it is safe to import from both React
islands and server routes. Decide the rounding rule in one place — the matrices display it and
the balance service computes with it, and they must not disagree.

#### 2. Matrix cells: days only

**File**: `src/components/absence/AbsenceStats.tsx`

**Intent**: Render one number per matrix cell as the prototype does, converting partial-day
hours to fractional days rather than reporting two units side by side.

**Contract**: `buildMatrix` (`:22-34`) keeps accumulating `{days, hours}` — the split is still
needed to convert correctly — but `cellText` (`:37`) now emits a single day figure:
`days + hoursToDays(hours)`, formatted to at most one decimal, `—` when zero.

This **reverses an explicit S-02 decision** ("days and hours reported separately, no assumed
hours-per-day", `context/archive/2026-05-30-details-and-stats/plan-brief.md:24`), on the
user's ruling. Note the reversal in the change log so a later reader does not treat it as drift.

#### 3. KPI tiles and per-type breakdown

**File**: `src/components/absence/AbsenceStats.tsx`

**Intent**: Add the two summary tiles and the per-type bar list above the matrices, both
computed from data already in the browser.

**Contract**: Two tiles: `Dni nieobecności` (grand total across the matrix) and
`Pracownicy z nieobecnością` rendered as `n / total` (`:149-157`, `:1190-1193`). The
denominator is the length of the passed `employees` prop, which is already
`visibleEmployeesFilter()`-scoped.

`Podział wg typu nieobecności`: one row per type in `display_order` with a bar in the type's
colour, the day count, and its share as a percentage (`:187-206`, `:1194-1199`). Types with
zero days still render, at zero width.

The `Podgląd wykorzystania urlopów` card is **not** built — it needs the deferred batch-balance
endpoint, and the prototype fakes its data (`:1144`).

#### 4. Matrix restyle, stacked bars and medals

**File**: `src/components/absence/AbsenceStats.tsx`

**Intent**: Bring both matrices onto the card system, add a per-row stacked mini-bar showing
each employee's type mix, and mark the top three per column and per total on the yearly matrix.

**Contract**: Both matrices become white 14px cards with the `#e8e8e8` header band and
`#c8c8c8` dividers, columns ordered by `display_order`, headers showing the type icon.

Stacked mini-bar per employee row: segments in type colours, the whole bar scaled to the
busiest employee's total so rows are comparable (`:208-252`, `:1055-1080`). Totals footer
retained.

Medals on the yearly matrix only: 🥇🥈🥉 per type column **and** on the `Łącznie` column, with
the prototype's tie handling — equal values share a rank and the next rank is skipped
(`:1099-1143`, ranking at `:1107-1111`). Employees with zero in a column receive no medal.

The yearly matrix keeps its existing lazy fetch (`:146`) and the `HIST` fabrication at
`:1082-1091` is not ported.

Known pre-existing bug, unchanged here: in the yearly view, deactivated employees outside the
viewed month render `—` because `gridEmployees` is month-scoped
(`context/archive/2026-06-03-deactivated-employee-grid/`).

#### 5. Aggregation memoisation

**File**: `src/components/absence/AbsenceStats.tsx`

**Intent**: The component recomputes every aggregation on each render, unmemoised
(`:23-36`, `:60-86`). This phase roughly doubles the number of aggregations over a list capped
at 5000 rows, which makes the existing pattern the dominant render cost.

**Contract**: Wrap the matrix build and each derived aggregation in `useMemo` keyed on the
absence array and the employees array. Not a rewrite — the functions stay pure and unchanged.

### Success Criteria:

#### Automated Verification:

- Lint, build and tests pass: `npm run lint`, `npm run build`, `npm run test:run`
- `FULL_DAY_HOURS` is declared exactly once: `grep -rn "FULL_DAY_HOURS\s*=" src/` returns one hit
- No local `/ 8` divisor remains in `AbsenceStats.tsx` or `holiday-balance.ts`

#### Manual Verification:

- KPI tiles show the correct grand total and the correct `n / total` employee count
- Per-type bars sum to 100% and their widths are proportional
- Matrix cells show one figure; an employee with a half-day training shows `0,5`, not `0` and not `4h`
- The holiday balance card still shows the same used-days figure as before this phase
- Stacked mini-bars are proportional and the busiest employee's bar is full width
- Yearly medals go to the right people, ties share a rank, and zero-value cells get none
- Monthly and yearly column order matches the grid legend
- Switching to the stats tab on a busy month feels responsive

**Implementation Note**: Merge, deploy, verify, pause. Cross-check the balance card against
the pre-phase value — the hours helper is now shared with `holiday-balance.ts` and a rounding
change there would move a number users can see.

---

## Phase 7: Balance card, quota modal and the moderator gate

### Overview

Restyle the balance card to the prototype's tile group, rebuild the quota modal with steppers
and a live preview, and gate holiday-balance writes to moderators.

### Changes Required:

#### 1. Balance card

**File**: `src/components/holiday/HolidayBalanceCard.tsx`

**Intent**: Replace the inline formula sentence with the prototype's layout: a large balance
figure, a three-cell tile group, an outline edit button and an over-quota chip.

**Contract**: Card is white, 14px radius, `22px 24px` padding. Left side: uppercase
`Urlop <year> – pozostało` label, a 40px bold figure that turns `#e50040` when negative, and
the `Do dnia:` line beside it. Then the tile group — Bieżące / Zaległe / Wykorzystane — as
three cells sharing 1px `#c8c8c8` gaps inside a rounded container (`10xUrlopy.dc.html:53-86`).
Right side: outline `Edytuj` button, and below it the red over-quota chip when the balance is
negative. The formula string moves out of the card and into the modal (`qFormula`, `:1431`).

Negative balances stay surfaced, not clamped — an S-15 decision
(`context/archive/2026-06-22-urlop-balance/`).

#### 2. Quota modal

**File**: `src/components/holiday/HolidayBalanceDialog.tsx`

**Intent**: Add `+`/`−` steppers on the two entitlement fields and a live `Pozostanie` preview,
and show the formula inside the modal where the card no longer carries it.

**Contract**: `Bieżące` and `Zaległe` gain stepper buttons flanking the number input; typing
directly still works. A `Pozostanie` line recomputes on every change from the current form
values (`:494`).

`Korekta` and `Do dnia` **stay in this modal**. The prototype relocates them to the employee
modal (`:466-474`); that relocation is coupled to the deferred batch-balance work and is out
of scope. This also avoids the zeroing hazard: `POST /api/holiday-balances` is a full replace
(`index.ts:180-189`), so a form that omits those fields would null `valid_until` and zero
`used_adjustment_days`.

Keep the existing correct Korekta arithmetic (`HolidayBalanceDialog.tsx:125`) and do **not**
port the prototype's help copy at `:468` / `:471`, which says the adjustment adds days while
every arithmetic path in the prototype subtracts.

#### 3. Moderator gate on `Korekta` only

**File**: `src/components/holiday/HolidayBalanceDialog.tsx`,
`src/pages/api/holiday-balances/index.ts`

**Intent**: Make `used_adjustment_days` ("Korekta wykorzystania") a moderator-only field. Every
other part of the balance dialog stays open to every employee, as today.

**Contract — client**: The `Korekta` input and its help text (`HolidayBalanceDialog.tsx:124-139`)
render only when the caller is a moderator. The dialog needs the caller's role, which
`dashboard.astro` already has as `currentEmployee.role` and passes down through
`HolidayBalanceCard`. The hidden field keeps its pre-filled state and is still sent on save —
the existing full-replace flow (`:18-19`) is unchanged, so hiding the input must not drop the
value from the request body.

**Contract — server**: `POST /api/holiday-balances` ignores `used_adjustment_days` from a
non-moderator caller rather than rejecting the request. Hiding the input is presentation; the
server is what makes it a rule. Implement by branching the write, not by adding a read:
- moderator → current behaviour, `used_adjustment_days` written as submitted;
- non-moderator → the column is omitted from the `onConflictDoUpdate` `set` clause, so an
  existing row keeps its stored adjustment; on insert it takes the column default of `0`.

`valid_until` ("Do dnia") is **not** gated — it stays editable by everyone.
`DELETE /api/holiday-balances/:id` is **not** gated either; S-15's "any valid caller may delete
any balance" (`context/archive/2026-06-22-urlop-balance/plan.md:211`) stands, since the ruling
here narrows to one field.

**This narrows, not reverses, S-15's decision.** `plan.md:34` chose "both can edit any" with no
role gate on writes; that stays true for three of the four fields. The code comment at
`index.ts:147` claims it for all of them and must be rewritten in the same commit, or the next
reader will trust a comment the code no longer honours.

The `Edytuj` button stays visible to everyone — only the field inside disappears. A hidden
field is not a dead control; a disabled button behind a permission the user cannot see would be
(`context/archive/2026-06-22-hours-onsite-training-only/`).

### Success Criteria:

#### Automated Verification:

- Lint, build and tests pass: `npm run lint`, `npm run build`, `npm run test:run`
- The `index.ts:147` comment no longer claims both roles may write

#### Manual Verification:

- Balance card matches the prototype: 40px figure, three tiles, outline button
- A negative balance renders red and shows the over-quota chip
- Steppers increment and decrement; `Pozostanie` updates live and matches the saved result
- As a moderator: `Korekta` and `Do dnia` are present and save correctly
- As a moderator: saving with an unchanged Korekta does not zero it
- As a non-moderator: `Edytuj` still opens; `Do dnia` is editable; `Korekta` is not shown
- As a non-moderator: saving does not change the stored Korekta, and `Wykorzystane` on the card is unchanged
- A non-moderator POSTing a different `used_adjustment_days` directly gets `200`, and the stored value is unchanged
- Deleting a balance still works for both roles

**Implementation Note**: Merge, deploy, verify, pause. The 403 paths must be exercised with a
real non-moderator account — this is the one behavioural change in the change set and it will
not show up in a visual pass.

---

## Phase 8: Absence modal and employee panel

### Overview

Rebuild the absence dialog's type and substitute pickers as visual grids, and restyle the
employee drawer to the prototype's sectioned list.

### Changes Required:

#### 1. Absence dialog pickers

**File**: `src/components/absence/AbsenceFormDialog.tsx`

**Intent**: Replace the two shadcn `Select` dropdowns with the prototype's visual pickers, so
the type's colour and icon are visible at selection time rather than after saving.

**Contract**: The type `Select` at `:135-161` becomes a two-column grid of buttons, each
showing the type's colour swatch, icon and name, with the selected button outlined navy
(`10xUrlopy.dc.html:536-544`, `:1267-1297`). The substitute `Select` at `:228-250` becomes a
row of circular initials avatars, with a clear/none option (`:578-584`, `:1238-1265`).

Existing rules are preserved exactly: partial-day gating still hides the hours controls for
non-training types (`:60`, `:141-148`, enforced server-side at `absence-partial-day.ts:20-30`),
and the substitute list still excludes the **target** employee rather than the editor
(`context/changes/moderator-absence-management/plan.md:32,183-187`) and still excludes the
`is_system` admin.

The prototype's `SELECT_*` styles (`:621-627`) are dead code in the prototype itself — ignore
them. The priority checkbox at `:546-552` is not ported.

#### 2. Employee drawer

**File**: `src/components/employee/EmployeeManagementSheet.tsx`

**Intent**: Restyle the drawer to the prototype's sectioned list with avatars and role pills.

**Contract**: Sheet widens to `max-width:560px` with `Aktywni (n)` and `Nieaktywni (n)`
section headers. Each row: coloured initials avatar, full name, role pill, and
`Edytuj` / `Dezaktywuj` (or `Przywróć`) actions (`:375-425`, `:867-916`).

The `Wymiar: X dni · korekta Y` line in the prototype's row (`:29` in the delta table) is
**omitted** — it needs the deferred batch-balance endpoint.

Do not port `addStaff` (`:1330`), which pushes an empty-name record straight into a crash via
`initialsOf` (`:926`). The existing `AddEmployeeDialog` flow, which requires email and
password because `POST /api/employees` creates the Supabase auth user
(`api/employees/index.ts:71-77`, `:125-129`), is correct and stays.

#### 3. Employee dialogs

**File**: `src/components/employee/AddEmployeeDialog.tsx`,
`src/components/employee/EditEmployeeDialog.tsx`,
`src/components/employee/DeleteConfirmDialog.tsx`

**Intent**: Bring the three dialogs onto the same card, button and field treatment as the rest
of the app so nothing still reads as stock shadcn.

**Contract**: Restyle only — field sets, validation and the `window.location.reload()` on
success are unchanged. The employee modal is **not** merged with the entitlement dialog; that
merge is deferred with the batch-balance work.

### Success Criteria:

#### Automated Verification:

- Lint, build and tests pass: `npm run lint`, `npm run build`, `npm run test:run`

#### Manual Verification:

- Type picker shows all seven types in `display_order` with correct colours and icons; selection is visibly outlined
- Selecting a training type reveals the hours controls; selecting any other type hides them
- Saving hours on a non-training type is still rejected server-side
- Substitute avatars exclude the target employee and the system admin; the none option clears the field
- Drawer shows Aktywni and Nieaktywni sections with correct counts
- Deactivate and restore still work and the list updates
- Add employee still requires email and password and creates a working login
- No dialog still renders in the stock shadcn look

**Implementation Note**: Final phase. Merge, deploy, and do a full walkthrough of every
surface before closing the change.

---

## Testing Strategy

### Unit Tests:

- `hoursToDays` — whole days, half days, zero, and the rounding boundary that decides whether
  a 3h45m absence reads as `0,5` or `0,4`
- Polish plural selection for entry counts — 1, 2, 5, 12, 22, 25
- Type-filter state — clearing restores all types; the clear control's active condition is
  true only while something is hidden (the exact pair the prototype gets backwards)
- Medal ranking with ties — equal values share a rank, the next rank is skipped, zeros get none
- Initials derivation on a name whose tokens contain no letters (the input that crashes the
  prototype's `initialsOf`)

### Integration Tests:

- `POST /api/holiday-balances` as a non-moderator with a changed `used_adjustment_days` → 200,
  and the stored value is unchanged
- `POST /api/holiday-balances` as a non-moderator creating a new row → 200 with adjustment `0`
- `POST /api/holiday-balances` as a moderator → 200 with the submitted adjustment written
- `GET` and `DELETE /api/holiday-balances` as a non-moderator → unchanged behaviour
- `POST /api/absences` with hours on a non-training type → still rejected

### Manual Testing Steps:

Per-phase steps are listed under each phase's Manual Verification. After Phase 8, walk the
whole app once as both roles:

1. Sign in with a bad password from `/` → error renders inside the light card on `/`
2. Sign in as moderator → dashboard chrome is navy, action bar present
3. Grid: hover a cell with a comment and a substitute → full tooltip; badges visible
4. Grid: reorder two columns → order persists after reload
5. Details: hide two types, sort by `Dodano`, clear filters → all rows return
6. Details: click own row → dialog opens pre-filled → save → row updates
7. Stats: check KPI totals against a manual count for a small month
8. Balance: edit with steppers, confirm `Pozostanie` matches the saved figure
9. Sign out, sign in as a non-moderator → no action bar, no `Edytuj` on the balance card
10. As non-moderator: click another employee's grid cell and Details row → nothing happens

**Verification constraint**: `wrangler dev` renders only the auth screens — `dashboard.astro:198-201`
collapses the body to "Błąd serwera" because Drizzle cannot reach Supabase under workerd. Every
dashboard step above runs against production after the phase's deploy. The post-deploy health
check only curls `/auth/signin` and will stay green on a broken dashboard, so a green CI run is
not evidence that a phase worked.

## Performance Considerations

Statistics is the only surface where this change moves the needle. `AbsenceStats.tsx` fetches
the raw yearly list (`:146`) capped at 5000 rows (`api/absences/index.ts:114`) and recomputes
every aggregation on every render. Phase 6 roughly doubles the number of aggregations, which
is why memoisation is part of that phase rather than a follow-up. At ~10 employees this is
comfortable either way; the memoisation is insurance against the list growing, not a fix for a
measured problem.

No new queries are added. The `absence_types` star select already returns the three new
columns at no extra cost, and every new employee-derived surface reads from props that are
already fetched.

The schema still has no indexes beyond PK and UNIQUE constraints. That is unchanged here and
worth its own change if the yearly fetch ever gets slow.

## Migration Notes

One migration, additive, on a seven-row lookup table. No data loss path — the three columns
carry defaults, so a rollback that drops them leaves `absences` untouched.

The old colour values are recoverable from
`supabase/migrations/20260526000002_seed_absence_types.sql:6-11` and
`20260722120000_seed_urlop_planowany_type.sql:10` if the palette needs reverting.

Run `npm run db:generate`, **read the diff**, append the seven `UPDATE` statements, then
`npm run db:migrate`. Do not apply a generated diff on this table unreviewed: drizzle-kit is
blind to `absence_types_color_check` (`AGENTS.md:58`), so it can neither preserve it
deliberately nor warn you if an operation would remove it. `ADD COLUMN` leaves it intact —
verify, do not recreate.

## References

- Frame brief: `context/changes/huge-ui-ux-improvement/frame.md`
- Research: `context/changes/huge-ui-ux-improvement/research.md`
- Prototype: `new-design/10xUrlopy.dc.html` (chrome `:18-51`, grid `:90-138`, details `:305-367`,
  stats `:149-299`, employee panel `:375-425`, modals `:427-584`, type catalogue `:599-607`,
  style constants `:617-640`)
- Prior decisions this change touches:
  `context/archive/2026-06-22-urlop-balance/plan.md:34,211` (balance write gate — reversed here),
  `context/archive/2026-05-30-details-and-stats/plan-brief.md:21-24` (days/hours separately — reversed here),
  `context/archive/2026-06-22-urlop-planowany-category/plan-brief.md:11-13` (types are data — upheld),
  `context/archive/2026-08-06-main-page-redesign/reviews/impl-review.md:40-48` (F1, F2 — closed here),
  `context/changes/employee-grid-order/plan.md:16,51,259` (column DnD constraints — upheld),
  `context/changes/moderator-absence-management/plan.md:32,183-187` (substitute exclusion — upheld),
  `context/changes/admin-bootstrap/plan.md:22,37,180` (`is_system` invisibility — upheld)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Token layer and chrome

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — c34a078
- [x] 1.2 Build passes: `npm run build` — c34a078
- [x] 1.3 Unit tests pass: `npm run test:run` — c34a078

#### Manual

- [ ] 1.4 Topbar is full-bleed navy with a gold moderator pill; no purple remains on `/dashboard`
- [ ] 1.5 Action bar renders as a white band with the navy `Pracownicy` button, gold on hover
- [ ] 1.6 Tab group is a single bordered pill; active segment navy; `?month=` preserved
- [ ] 1.7 Month nav heading does not shift when stepping between months
- [ ] 1.8 Content centred at 1480px max width; no overflow at 1280px
- [ ] 1.9 Rendered navy matches `#072143` when sampled

### Phase 2: Close the auth theme fork

#### Automated

- [x] 2.1 Lint passes with no unused/unresolved imports: `npm run lint` — f748ba5
- [x] 2.2 Build passes: `npm run build` — f748ba5
- [x] 2.3 No source file imports a deleted auth component — f748ba5
- [x] 2.4 No `bg-cosmic` references remain in `src/` — f748ba5

#### Manual

- [ ] 2.5 `/auth/signin` renders the light brand card, identical to `/`
- [ ] 2.6 Failed sign-in lands on `/` with the error inside the card
- [ ] 2.7 Visiting `/dashboard` signed out lands on `/`
- [ ] 2.8 Submit button shows its pending state during the POST
- [ ] 2.9 `/auth/confirm-email` renders light-brand

### Phase 3: Absence-type metadata

#### Automated

- [x] 3.1 Generated diff has exactly three `ADD COLUMN` on `absence_types` and no `DROP`
- [x] 3.2 Migration applies cleanly: `npm run db:migrate`
- [x] 3.3 The `absence_types.color` CHECK constraint exists after migration
- [x] 3.4 All seven rows have non-empty `icon`, valid `text_color`, distinct `display_order` 1..7
- [x] 3.5 Build and lint pass

#### Manual

- [ ] 3.6 Legend order is urlop → szkolenie poza → szkolenie w → choroba → wyjazd → stała → urlop planowany
- [ ] 3.7 Existing absences render in new colours with no missing cells
- [ ] 3.8 The offsite-training icon renders as one glyph
- [ ] 3.9 Statistics matrix column order matches the legend

### Phase 4: Grid tab

#### Automated

- [ ] 4.1 Lint and build pass
- [ ] 4.2 Unit tests pass: `npm run test:run`
- [ ] 4.3 `textColorForBg` no longer exists in `src/`

#### Manual

- [ ] 4.4 Employee names read horizontally; ten columns fit at 1480px without scroll
- [ ] 4.5 `choroba` shows white on navy; every other type is legible
- [ ] 4.6 💬 and 🔁 badges appear with correct substitute initials
- [ ] 4.7 Partial-day cells show their time range; full-day cells do not
- [ ] 4.8 Cell hover shows the full multi-line summary
- [ ] 4.9 Weekend rows shaded, no hover state, not clickable
- [ ] 4.10 Column reordering still works and the dragged column does not detach
- [ ] 4.11 Deactivated employees keep grey header, `(nakt.)` suffix, non-clickable

### Phase 5: Details tab

#### Automated

- [ ] 5.1 Lint, build and tests pass

#### Manual

- [ ] 5.2 Toggling a type chip hides exactly that type across all groups
- [ ] 5.3 `Wyczyść filtry` restores all types; active only while something is hidden
- [ ] 5.4 Group headers show correct Polish plurals for 1, 2, 5 and 12
- [ ] 5.5 Empty group shows `Brak nieobecności`
- [ ] 5.6 All six columns sort both ways; glyph tracks the active column
- [ ] 5.7 `Dodano` is present and sortable
- [ ] 5.8 Clicking an editable row opens the pre-filled dialog; saving updates the row
- [ ] 5.9 Non-editable rows give no dialog and no hover cue
- [ ] 5.10 Comments render in quotes under the type pill; avatars show correct initials
- [ ] 5.11 Range segments preserve `?subcard=`

### Phase 6: Statistics tab

#### Automated

- [ ] 6.1 Lint, build and tests pass
- [ ] 6.2 `FULL_DAY_HOURS` is declared exactly once in `src/`
- [ ] 6.3 No local `/ 8` divisor remains in `AbsenceStats.tsx` or `holiday-balance.ts`

#### Manual

- [ ] 6.4 KPI tiles show correct grand total and `n / total`
- [ ] 6.5 Per-type bars sum to 100% and are proportional
- [ ] 6.6 A half-day training reads `0,5` — not `0`, not `4h`
- [ ] 6.7 Balance card shows the same used-days figure as before this phase
- [ ] 6.8 Stacked mini-bars proportional; busiest employee's bar is full width
- [ ] 6.9 Yearly medals correct; ties share a rank; zeros get none
- [ ] 6.10 Monthly and yearly column order matches the legend
- [ ] 6.11 Stats tab feels responsive on a busy month

### Phase 7: Balance card, quota modal and the moderator gate

#### Automated

- [ ] 7.1 Lint, build and tests pass
- [ ] 7.2 The `index.ts:147` comment no longer claims both roles may write

#### Manual

- [ ] 7.3 Balance card matches the prototype: 40px figure, three tiles, outline button
- [ ] 7.4 Negative balance renders red with the over-quota chip
- [ ] 7.5 Steppers work; `Pozostanie` updates live and matches the saved result
- [ ] 7.6 Moderator: `Korekta` and `Do dnia` present and saving correctly
- [ ] 7.7 Moderator: saving with an unchanged Korekta does not zero it
- [ ] 7.8 Non-moderator: `Edytuj` opens, `Do dnia` editable, `Korekta` not shown
- [ ] 7.9 Non-moderator: saving leaves the stored Korekta and `Wykorzystane` unchanged
- [ ] 7.10 Non-moderator POSTing a different `used_adjustment_days` gets 200 and the stored value is unchanged
- [ ] 7.11 Deleting a balance still works for both roles

### Phase 8: Absence modal and employee panel

#### Automated

- [ ] 8.1 Lint, build and tests pass

#### Manual

- [ ] 8.2 Type picker shows seven types in order with correct colours and icons; selection outlined
- [ ] 8.3 Training type reveals hours controls; other types hide them
- [ ] 8.4 Hours on a non-training type still rejected server-side
- [ ] 8.5 Substitute avatars exclude the target employee and the system admin; none option clears
- [ ] 8.6 Drawer shows Aktywni and Nieaktywni sections with correct counts
- [ ] 8.7 Deactivate and restore work; list updates
- [ ] 8.8 Add employee still requires email and password and creates a working login
- [ ] 8.9 No dialog still renders in the stock shadcn look
