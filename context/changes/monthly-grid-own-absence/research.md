---
date: 2026-05-28T00:00:00+02:00
researcher: Claude Sonnet 4.6
git_commit: f42ce4b730d801c2d2a3df331de2088612fa2477
branch: main
repository: 10xDevs
topic: "Full architecture audit for monthly-grid-own-absence (S-01)"
tags: [research, codebase, astro, react, supabase, shadcn, tailwind, rls, api-routes]
status: complete
last_updated: 2026-05-28
last_updated_by: Claude Sonnet 4.6
---

# Research: Full Architecture Audit — Monthly Grid / Own Absence CRUD (S-01)

**Date**: 2026-05-28  
**Researcher**: Claude Sonnet 4.6  
**Git Commit**: `f42ce4b730d801c2d2a3df331de2088612fa2477`  
**Branch**: main  
**Repository**: 10xDevs

## Research Question

Full architecture audit of everything the `monthly-grid-own-absence` plan touches: API route patterns, auth middleware, Astro SSR data-passing, environment schema, component conventions, shadcn/Tailwind setup, and DB schema / RLS details.

## Summary

Four parallel agents read 30+ files. Key findings that affect implementation:

1. **Zod is not installed** — the plan references it for API route validation but it needs to be added (`npm install zod`).
2. **No JSON API response pattern exists** — all existing API routes use `context.redirect()`; the CRUD routes will establish the first `new Response(JSON.stringify(...))` pattern.
3. **Hours constraint is biconditional** — the fix migration tightened it: `is_full_day=true` requires `hours IS NULL` (not just allows it). The form must null out hours when switching back to full-day.
4. **No DTO types** — `src/types.ts` has read-model interfaces only; `AbsenceInsert` / `AbsenceUpdate` partials need to be added.
5. **Topbar.astro exists** — a functional nav component with auth-aware links exists but is not included in `Layout.astro`; the new dashboard should include it.
6. **Auth components use cosmic theme** — `bg-white/10` glassmorphism aesthetic diverges from shadcn token system; new grid components should use the standard shadcn tokens (`bg-background`, `text-foreground`, etc.) for a clean UI.
7. **`context.locals.user` is safe to read in API routes** — middleware always resolves it before the route runs; no second `supabase.auth.getUser()` needed.

---

## Detailed Findings

### API Routes, Auth, and Middleware

**Auth guard pattern in existing routes** (`src/pages/api/auth/signin.ts:9–17`):
- All three auth routes instantiate the Supabase client inline: `createClient(context.request.headers, context.cookies)`
- They null-guard the client: `if (!supabase) { return context.redirect(...) }`
- They return `context.redirect()` for both success and failure — there is no `new Response()` usage anywhere

**New pattern needed for absence CRUD routes**: since the middleware already resolves `context.locals.user` for every request (`src/middleware.ts:10–13`), absence API routes should read `context.locals.user` directly and return a JSON 401 if null. No need to call `supabase.auth.getUser()` again.

**`context.locals` TypeScript type** (`src/env.d.ts:1–5`):
```ts
declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
  }
}
```
Only `user` is exposed. `user.id` is the `auth.uid()` equivalent for RLS.

**`prerender = false`**: not exported in any existing route; not needed because `output: "server"` in `astro.config.mjs:11` makes all routes SSR by default.

**Content-Type**: no existing route sets it (all use redirects). New JSON routes must set `"Content-Type": "application/json"` explicitly.

**Zod**: `package.json` has no `zod` entry in either `dependencies` or `devDependencies`. Must install before implementing validated JSON routes.

---

### Astro Config, Environment Schema, and SSR Data-Passing

**Env schema** (`astro.config.mjs:19–20`):
- `SUPABASE_URL`: `context: "server"`, `access: "secret"` — imported via `astro:env/server`
- `SUPABASE_KEY`: same
- Zero `PUBLIC_` vars — confirmed no browser-side Supabase client is planned

**Output mode** (`astro.config.mjs:11`): `output: "server"` — full SSR.

**Cloudflare adapter** (`astro.config.mjs:16`): `cloudflare({ imageService: "passthrough" })`. The wrangler config uses `nodejs_compat` flag (required for Node.js APIs in Workers).

**SSR-to-React data-passing pattern** (`src/pages/auth/signin.astro:5,16`):
```astro
---
const error = Astro.url.searchParams.get("error");
---
<SignInForm serverError={error} client:load />
```
Props are resolved server-side in the frontmatter and passed as JSX attributes to the React island. **`client:load`** is the only hydration directive in use — hydrates immediately on page load.

**`Astro.url.searchParams`** is safe to use in frontmatter because `output: "server"` guarantees every request gets a real URL.

**dashboard.astro currently** (`src/pages/dashboard.astro:4`): reads `Astro.locals.user` inline in the template — no React components, no data fetching. It is a pure Astro template placeholder.

---

### Component Patterns, shadcn, and Tailwind

**shadcn configuration** (`components.json`):
- Style: `"new-york"` (line 3)
- Base color: `"neutral"` (line 9)
- CSS variables: `true` (line 10)
- Hooks alias: `@/hooks` → `./src/hooks` (line 17) — **directory does not exist yet**

**Tailwind 4 setup** (`src/styles/global.css:1–4`):
- No `tailwind.config.js` — CSS-only config via `@import "tailwindcss"` and `@theme inline {}` block
- Design tokens use oklch color space
- Custom utility `bg-cosmic` is a dark gradient used only on auth pages
- Token names follow shadcn convention: `--background`, `--foreground`, `--primary`, `--destructive`, etc., mapped into Tailwind's `--color-*` namespace via `@theme inline`

**Radix UI installed** (`package.json`): only `@radix-ui/react-slot@^1.1.2`. Every other Radix primitive (Dialog, Select, Popover…) must be installed via `npx shadcn@latest add [name]`.

**Lucide React** is the icon library (configured in `components.json:20`). Sizing convention: `className="size-4"`.

**React component state pattern** (`src/components/auth/SignInForm.tsx:13–16`):
- Controlled inputs with `useState`
- Field errors as a typed partial object: `useState<{ email?: string; password?: string }>({})`
- `onChange` prop delivers the string value directly (not the event)
- No form library

**API call pattern in auth components** (`SignInForm.tsx:43`): **native HTML form POST** (`method="POST" action="/api/auth/signin"`), not `fetch()`. Submit button uses React 19's `useFormStatus()` from `react-dom` for pending state. The absence form will use `fetch()` instead (it's a JSON API), which is a new pattern in the codebase.

**`cn()` utility** (`src/lib/utils.ts:1–6`): `clsx` + `tailwind-merge`. Import: `import { cn } from "@/lib/utils"`.

**Topbar.astro** (`src/components/Topbar.astro`): Exists and is auth-aware (shows user email + Dashboard/Sign out links when logged in, Sign in/Sign up when not). It is **not included in `Layout.astro`** — pages include it individually. The current dashboard placeholder does not include it, but the real dashboard should.

**TypeScript strictness** (`tsconfig.json:2`): extends `"astro/tsconfigs/strict"` — all strict checks enabled including `strictNullChecks`.

---

### Database Schema, RLS, and TypeScript Types

**`absences` table — all columns** (`supabase/migrations/20260526000001_schema.sql:40–52`):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | NOT NULL | PK, default `gen_random_uuid()` |
| `employee_id` | UUID | NOT NULL | FK → `employees(id)`, no ON DELETE |
| `absence_type_id` | INTEGER | NOT NULL | FK → `absence_types(id)` |
| `date` | DATE | NOT NULL | |
| `is_full_day` | BOOLEAN | NOT NULL | default TRUE |
| `hours` | NUMERIC(4,2) | NULL | biconditional CHECK (see below) |
| `comment` | TEXT | NULL | |
| `substitute_employee_id` | UUID | NULL | FK → `employees(id)`, no ON DELETE |
| `created_at` | TIMESTAMPTZ | NOT NULL | default NOW() |
| `updated_at` | TIMESTAMPTZ | NOT NULL | auto-updated via trigger |

**Hours biconditional constraint** (`20260527000001_fix_hours_check_and_moderator_select.sql:10–12`):
```sql
CHECK ((is_full_day AND hours IS NULL) OR (NOT is_full_day AND hours IS NOT NULL))
```
Both directions are enforced:
- `is_full_day = true` → `hours` **must be NULL** (not just can be null)
- `is_full_day = false` → `hours` **must not be NULL**

The form must explicitly set `hours: null` when the user checks the "Cały dzień" checkbox, not just leave hours undefined.

**What the fix migration changed** (`20260527000001_fix_hours_check_and_moderator_select.sql`):
1. Replaced the unidirectional hours CHECK with the biconditional above
2. Added `employees_select_moderator_all` policy so moderators can see soft-deleted employees (relevant for S-04, not S-01)

**RLS INSERT predicate for absences** (`20260526000001_schema.sql:139–146`):
```sql
employee_id IN (
  SELECT id FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL
) OR get_user_role() = 'moderator'
```

**RLS UPDATE predicate** — same as INSERT but using `USING` only. No `WITH CHECK` on UPDATE, so the row filter checks ownership of the existing row but not the new `employee_id` value. The API routes should never allow changing `employee_id` on update to avoid this gap.

**Indexes on `absences`**: only the PK (`id`) and the UNIQUE constraint (`employee_id, date`). No explicit index on `date` alone or `absence_type_id`. The month-range query uses `date >= firstDay AND date < firstDayNextMonth` — with ~10 employees and ~310 rows per month this is fast regardless, but the UNIQUE index on `(employee_id, date)` supports filtering by both dimensions.

**Seed absence types** (`20260526000002_seed_absence_types.sql:5–11`):

| id | name | color |
|---|---|---|
| 1 | `wyjazd zagraniczny` | `#2f578c` |
| 2 | `szkolenie/wyjście poza miejsce pracy` | `#10bbef` |
| 3 | `szkolenie w miejscu pracy` | `#ffcc00` |
| 4 | `urlop` | `#58873e` |
| 5 | `choroba` | `#e50040` |
| 6 | `stała nieobecność` | `#6f6f6f` |

**TypeScript types** (`src/types.ts:1–30`): `Employee`, `AbsenceType`, `Absence` are complete read-model interfaces. No DTO types (`AbsenceInsert`, `AbsenceUpdate`) exist yet.

**Supabase local**: Studio at `http://127.0.0.1:54323`, API at port 54321, DB at 54322.

---

## Code References

- `src/middleware.ts:10–13` — `context.locals.user` resolution; safe to read in API routes
- `src/env.d.ts:1–5` — `App.Locals` interface; `user: User | null`
- `src/lib/supabase.ts:5` — `createClient(requestHeaders, cookies)` factory; same for API routes and SSR pages
- `src/pages/api/auth/signin.ts:9–19` — existing API route pattern (redirect-only; no JSON responses)
- `src/pages/auth/signin.astro:5,16` — SSR-to-React prop passing + `client:load` directive
- `astro.config.mjs:11,16,19–20` — `output: "server"`, Cloudflare adapter, env schema
- `src/styles/global.css:1–4,75–111` — Tailwind 4 CSS config, `@theme inline` token block
- `components.json:3,9,17` — shadcn new-york style, neutral base, `@/hooks` alias → `./src/hooks`
- `src/components/Topbar.astro` — auth-aware nav bar (not in Layout; pages include it manually)
- `src/components/auth/SignInForm.tsx:13–16,43` — controlled state pattern + native form POST
- `src/lib/utils.ts:1–6` — `cn()` utility
- `supabase/migrations/20260526000001_schema.sql:40–52` — absences table DDL
- `supabase/migrations/20260527000001_fix_hours_check_and_moderator_select.sql:10–12` — biconditional hours CHECK
- `supabase/migrations/20260526000002_seed_absence_types.sql:5–11` — 6 absence types with hex colors
- `src/types.ts:1–30` — read-model interfaces (no insert/update DTOs)

---

## Architecture Insights

**Request flow for an absence CRUD call (planned):**
```
Browser fetch("POST /api/absences", body)
  → Astro middleware (middleware.ts) resolves context.locals.user
  → API route (src/pages/api/absences/index.ts)
      reads context.locals.user → 401 if null
      creates supabase = createClient(headers, cookies)
      looks up employees.id WHERE user_id = user.id
      inserts into absences (RLS enforces ownership)
  → Response 201 JSON | 400 JSON
  → React component: window.location.reload()
  → SSR re-render fetches fresh data
```

**Patterns established by this slice (new to codebase):**
1. JSON API routes with `new Response(JSON.stringify(...), { status, headers: {"Content-Type":"application/json"} })`
2. `fetch()` from a React island to a JSON API route (auth uses native form POST)
3. React islands with `useState` driving modal dialogs (auth components are form-only)
4. Zod validation in API routes

**Hours constraint enforcement at two levels:**
- Client: hours `<Input>` renders only when `!isFullDay`; `Save` disabled unless hours is filled when `!isFullDay`
- Server (DB): `CHECK ((is_full_day AND hours IS NULL) OR (NOT is_full_day AND hours IS NOT NULL))`
- The API route must send `hours: null` (not `undefined`, not omitted) when `is_full_day = true`, otherwise the DB may receive `undefined` serialized as nothing and fail the constraint

**`toLocaleDateString("sv")` pattern**: using Swedish locale to get ISO `"YYYY-MM-DD"` format from a `Date` object — avoids timezone shift from UTC ISO string parsing. Documented in plan as a known-good approach; no date library needed.

---

## Plan Amendments Required

These findings require updates to `plan.md` before implementation:

| Finding | Required change |
|---|---|
| Zod not installed | Add `npm install zod` as step 0 in Phase 2, or as a Phase 1 sub-step |
| Hours is biconditional | Phase 4 (AbsenceFormDialog): explicitly set `hours: null` in payload when `is_full_day=true`; not just omit it |
| No DTO types in types.ts | Add `AbsenceInsert` and `AbsenceUpdate` types to `src/types.ts` as part of Phase 2 or Phase 3 |
| Topbar.astro exists | Phase 3 (dashboard.astro): import and include `<Topbar />` for nav |
| No hooks dir | If any custom hook is extracted from AbsenceGrid (e.g., `useAbsenceForm`), create `src/hooks/` — matches `components.json:17` alias |
| Native form POST is existing pattern | Phase 4 note: `fetch()` from React island to JSON API is intentionally new; document in progress notes |

---

## Historical Context (from prior changes)

- `context/changes/data-schema-and-rls/plan.md` — F-01 plan; established the biconditional hours constraint decision, soft-delete via `deleted_at`, `SECURITY DEFINER get_user_role()` to avoid RLS recursion, and the `UNIQUE(employee_id, date)` grid model constraint. All of these are load-bearing for this slice.

---

## Open Questions

1. **Should `AbsenceInsert` / `AbsenceUpdate` types live in `src/types.ts` alongside the read types, or in a separate `src/types/absences.ts`?** Small codebase argues for co-location in `src/types.ts`.
2. **Should the dashboard include `<Topbar />`?** The current placeholder doesn't, and auth pages don't either. For the real dashboard it adds meaningful navigation (sign out, user identity) — likely yes.
3. **Sonner + Tailwind 4 compatibility**: shadcn's sonner component generates CSS that integrates with the `@theme inline` token block. Confirmed only by `npm run build` after install — not pre-verified.
4. **`hours` serialization in fetch body**: `JSON.stringify({ hours: null })` sends `"hours":null` correctly. If `hours` is omitted from the object, the DB receives no value and may default or fail. The plan should explicitly note: always include `hours` key in the POST body, set to `null` when `is_full_day = true`.
