# Main-Page Login Redesign Implementation Plan

## Overview

Replace the leftover cosmic "10x Astro Starter" landing on the root route `/` with a
light-themed, Polish login card that matches `target-design.png`. The card is
**functional** — it posts to the existing Supabase email/password endpoint
(`/api/auth/signin`) — and carries our own product identity: the wordmark
**"Nieobecności"** (front-end brand for the internally-named "Urlopy" app). The
mockup's LDAP/Active-Directory login, "WRIFboard" name, and "panel rynkowy" framing
are treated as **visual reference only**, per the frame brief.

## Current State Analysis

- `src/pages/index.astro` renders `Welcome.astro` — a dark, cosmic, English starter
  landing (`src/components/Welcome.astro:1`). This is what the redesign replaces.
- The auth UI is already componentized: `SignInForm`, `FormField`, `PasswordToggle`,
  `SubmitButton`, `ServerError` (`src/components/auth/*`). All are hardcoded to a
  **dark/glass palette** (`bg-white/10`, `text-white`, `placeholder-white/40`,
  `focus:ring-purple-400`, `bg-purple-600`) and are shared with the existing
  `/auth/signin` page (`src/pages/auth/signin.astro:16`).
- Auth is Supabase email/password: `SignInForm` posts `email`+`password` to
  `/api/auth/signin` (`SignInForm.tsx:43`); the endpoint calls
  `supabase.auth.signInWithPassword` and **redirects to `/` on success**
  (`src/pages/api/auth/signin.ts:21`). No LDAP anywhere.
- `src/middleware.ts` resolves `context.locals.user` on every request and only guards
  `/dashboard` (`PROTECTED_ROUTES = ["/dashboard"]`). `index.astro` has no auth check.
- `/auth/signin` is linked from `dashboard.astro:41` (redirect), `Topbar.astro:36`, and
  `confirm-email.astro:31` — so it must remain a working route.
- Design tokens: `src/styles/global.css` defines light `:root` tokens (`--background`,
  `--card`, `--primary` ≈ near-black/navy, `--border`, `--ring`, `--destructive`). The
  light card can lean on these plus explicit Tailwind classes.

## Desired End State

Visiting `/` unauthenticated shows the mockup's light login card: gray page background,
soft-shadowed white card, a logo mark, the **"Nieobecności"** wordmark, subtitle
**"Zaloguj się, aby uzyskać dostęp do panelu"**, a user/ID-styled email field (user icon
+ trailing validation icon), a "Hasło" field, a dark-navy **"Zaloguj się"** button, and a
neutral Polish footer + copyright. Submitting valid credentials logs in and lands the
user in the app; an **already-authenticated** user who hits `/` is redirected to
`/dashboard` (so the post-login `→ /` redirect never dumps them back on the login card).
`/auth/signin` continues to render its existing dark form unchanged.

Verify: `/` renders the light card (not the cosmic starter); a valid login proceeds and a
second visit to `/` while logged in redirects to `/dashboard`; `/auth/signin` is visually
unchanged; `npm run build` and `npm run lint` pass.

### Key Discoveries:

- Shared auth components are dark-only and reused by `/auth/signin`
  (`src/components/auth/FormField.tsx:5`, `SubmitButton.tsx:18`) — so a light look for `/`
  must be a **`/`-scoped variant**, not an edit to the shared components (avoids
  regressing `/auth/signin`). Decision: light variant for `/` only.
- Post-login redirect target is `/` (`signin.ts:21`) — makes an auth-guard on `/`
  **mandatory**, else authenticated users see the login card again (redirect loop feel).
- `context.locals.user` is already populated by middleware, so the guard is a cheap
  server-side check in `index.astro` (no new middleware route needed).

## What We're NOT Doing

- No LDAP / Active Directory integration (visual reference only).
- No "WRIFboard" / "panel rynkowy" product rebrand.
- Not changing `/auth/signin`, `/api/auth/signin`, the Supabase auth mechanism, or the
  shared dark `src/components/auth/*` components.
- Not deleting `Welcome.astro` in this change (just stop using it on `/`); removal can be
  a later cleanup.
- No signup wiring (self-registration is disabled per recent work).
- Not literally reproducing the LDAP field placeholder/footer text.

## Implementation Approach

Build a **light, `/`-scoped sign-in card**. Rather than edit the shared dark auth
components, create a small light-themed form component for `/` that reuses the same
behavior contract (client validation, posts to `/api/auth/signin`, `ServerError` display,
`useFormStatus` pending state) but a light Tailwind palette. Compose it inside a new light
card layout in `index.astro`. Add a server-side auth guard at the top of `index.astro` so
authenticated users are redirected to `/dashboard`. `/auth/signin` and all shared
components are left byte-for-byte unchanged.

## Phase 1: Light login card on `/`

### Overview

Replace `Welcome` on `/` with the light login card: page/card chrome, logo, wordmark,
subtitle, a light-themed functional form (user/ID-styled email field + password + navy
submit), and footer/copyright — all in Polish, honest to our email/password auth.

### Changes Required:

#### 1. Light-themed sign-in form for `/`

**File**: `src/components/auth/LoginCardForm.tsx` (new)

**Intent**: A light-palette counterpart to `SignInForm` used only by `/`. Same behavior
(email/password client validation, posts to `/api/auth/signin`, shows `serverError`,
pending state), styled for the white card. The email field is presented as the mockup's
"user / ID" field — user icon on the left, a trailing validation status icon on the right —
but labeled honestly (e.g. "Email") with an email-shaped placeholder. Password field
labeled "Hasło" with the existing show/hide toggle behavior. Submit button is dark-navy
full-width reading "Zaloguj się".

**Contract**: Same props shape as `SignInForm` (`{ serverError?: string | null }`),
`<form method="POST" action="/api/auth/signin">`, input `name`s `email` and `password`
(the endpoint reads `form.get("email")`/`form.get("password")` — `signin.ts:8-9`, so these
names are load-bearing). Reuse `ServerError` (its dark styling is acceptable inside the
card only when an error shows; if it clashes, render a light inline error instead — light
error uses `text-red-600`/`border-red-300`). Trailing validation icon reflects the email
field's valid/invalid/empty state (e.g. lucide `CircleCheck`/`CircleX`). Light input
styling: white/gray background, `border` from `--border`, `focus:ring` navy, dark text,
muted placeholder. Password toggle may reuse `PasswordToggle` with a light color override
or inline an equivalent. Composed client-side (`client:load`) like the existing form.

#### 2. Root page: light card layout + copy + logo

**File**: `src/pages/index.astro`

**Intent**: Stop rendering `Welcome`; render the light login card centered on a gray page.
Include the logo mark, "Nieobecności" wordmark, the subtitle, the `LoginCardForm`, and the
footer + copyright. Pass any `?error` query param through to the form's `serverError`
(mirroring `signin.astro:5`).

**Contract**: Uses `Layout` (keeps `lang="pl"`, Banner, Toaster). Page wrapper: light gray
background (e.g. `bg-slate-50`/`bg-gray-50`), min-h-screen, centered. Card: white,
`rounded-2xl`, soft shadow, max-width ~`sm`. Logo: a rounded badge with a lucide icon
appropriate to an absence/leave app (e.g. `CalendarDays`/`CalendarCheck`) in a navy tint —
not the mockup's market chart. Wordmark text: `Nieobecności`. Subtitle text:
`Zaloguj się, aby uzyskać dostęp do panelu`. Footer: a neutral Polish line (no LDAP/AD
claim) — e.g. `Logowanie za pomocą konta służbowego.` — plus copyright
`© 2026 Nieobecności. Wszystkie prawa zastrzeżone.` `<SignInForm>`-style island:
`<LoginCardForm serverError={error} client:load />`.

#### 3. Page `<title>`

**File**: `src/pages/index.astro`

**Intent**: Give `/` a meaningful Polish title instead of the Layout default
("10x Astro Starter").

**Contract**: `<Layout title="Nieobecności — Logowanie">`.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Linting passes: `npm run lint`
- Type-checking passes (part of lint's type-checked rules): `npm run lint`
- No remaining `Welcome` import in `src/pages/index.astro` (grep)

#### Manual Verification:

- `/` renders the light card (white card, gray page, navy button) — not the cosmic starter
- Wordmark reads "Nieobecności"; subtitle and footer are the agreed Polish copy; no LDAP/AD
  or "WRIFboard" text appears
- Email field shows user icon + trailing validation icon that reacts to input validity;
  password field has working show/hide toggle
- Layout visually matches `target-design.png` closely (card, spacing, shadow, button)
- `/auth/signin` is visually unchanged (dark form still renders)

**Implementation Note**: After Phase 1 automated verification passes, pause for manual
confirmation (screenshot vs. mockup) before Phase 2. Phase blocks use plain bullets; the
`## Progress` section owns the checkboxes.

---

## Phase 2: Redirect & guard wiring

### Overview

Ensure the functional `/` behaves correctly for authenticated users: a logged-in visitor
to `/` (including right after a successful login, since `/api/auth/signin` redirects to
`/`) is sent to `/dashboard` instead of seeing the login card. `/auth/signin` remains a
working fallback.

### Changes Required:

#### 1. Server-side auth guard on `/`

**File**: `src/pages/index.astro`

**Intent**: In the frontmatter, if `Astro.locals.user` is set, redirect to `/dashboard`
before rendering the card, so authenticated users never see the login form on `/`.

**Contract**: `if (Astro.locals.user) return Astro.redirect("/dashboard");` at the top of
the frontmatter (mirrors the guard pattern in `dashboard.astro:41`). `context.locals.user`
is already populated by `middleware.ts` on every request, so no middleware change is
needed. Note: Drizzle/role lookups fail in `wrangler dev` (per repo constraints) but the
redirect depends only on `locals.user`, which comes from Supabase auth and works locally.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Logging in from `/` with valid credentials proceeds into the app (does not loop back to
  the login card) — verified against the production deployment (Drizzle-backed routes fail
  in `wrangler dev`, but auth redirect works)
- Visiting `/` while already authenticated redirects to `/dashboard`
- Visiting `/` while signed out shows the login card
- `/auth/signin` still works as a fallback (linked from Topbar, dashboard redirect,
  confirm-email)

**Implementation Note**: After Phase 2 automated verification passes, pause for manual
confirmation of the authenticated/unauthenticated redirect behavior.

---

## Testing Strategy

### Unit Tests:

- No unit-test harness exists for these presentational components; validation logic in
  `LoginCardForm` mirrors the already-shipped `SignInForm` and is covered by manual checks.

### Integration Tests:

- Covered by the manual login flow against the production deployment (email/password →
  redirect), since Drizzle-backed routes cannot run under `wrangler dev`.

### Manual Testing Steps:

1. Load `/` signed out → confirm the light card matches the mockup.
2. Submit an empty form → client validation blocks and shows field errors.
3. Submit an invalid email → trailing validation icon shows invalid state.
4. Submit valid credentials (against prod) → lands in the app, not back on `/`.
5. Reload `/` while authenticated → redirected to `/dashboard`.
6. Open `/auth/signin` → dark form unchanged and functional.

## Performance Considerations

Negligible — one static page plus a small client island, matching the existing
`/auth/signin` island footprint.

## Migration Notes

None. `Welcome.astro` is left in the repo (unused on `/`) for optional later cleanup;
`/auth/signin` and all shared auth components are untouched.

## References

- Frame brief: `context/changes/main-page-redesign/frame.md`
- Mockup: `context/changes/main-page-redesign/target-design.png`
- Existing form to mirror: `src/components/auth/SignInForm.tsx:43`
- Sign-in endpoint (field names + redirect): `src/pages/api/auth/signin.ts:8`
- Auth guard pattern: `src/pages/dashboard.astro:41`
- Middleware user resolution: `src/middleware.ts:10`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Light login card on `/`

#### Automated

- [x] 1.1 Build passes: `npm run build`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Type-checking passes via lint's type-checked rules: `npm run lint`
- [x] 1.4 No remaining `Welcome` import in `src/pages/index.astro`

#### Manual

- [x] 1.5 `/` renders the light card, not the cosmic starter
- [x] 1.6 Wordmark "Nieobecności" + agreed Polish copy; no LDAP/WRIFboard text
- [x] 1.7 Email user/ID field with reactive validation icon; password show/hide works
- [x] 1.8 Layout matches `target-design.png` closely
- [x] 1.9 `/auth/signin` visually unchanged

### Phase 2: Redirect & guard wiring

#### Automated

- [ ] 2.1 Build passes: `npm run build`
- [ ] 2.2 Linting passes: `npm run lint`

#### Manual

- [ ] 2.3 Valid login from `/` proceeds into the app (no loop back to card)
- [ ] 2.4 Authenticated visit to `/` redirects to `/dashboard`
- [ ] 2.5 Signed-out visit to `/` shows the login card
- [ ] 2.6 `/auth/signin` still works as a fallback
