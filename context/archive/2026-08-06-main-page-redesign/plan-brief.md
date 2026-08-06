# Main-Page Login Redesign — Plan Brief

> Full plan: `context/changes/main-page-redesign/plan.md`
> Frame brief: `context/changes/main-page-redesign/frame.md`

## What & Why

Restyle the root `/` landing into a light-themed, Polish, login-style card matching
`target-design.png`, while reusing the existing Supabase email/password auth and our own
product identity. The current `/` is a leftover cosmic "10x Astro Starter" page; this makes
`/` the branded front door to the app.

## Starting Point

`/` renders `Welcome.astro` (dark cosmic starter). The real sign-in lives at `/auth/signin`
with a dark/glass form built from shared components (`src/components/auth/*`) that post
email+password to `/api/auth/signin`, which redirects to `/` on success. Middleware
populates `locals.user` but only guards `/dashboard`.

## Desired End State

Visiting `/` signed out shows a light login card — gray page, white shadowed card, logo,
**"Nieobecności"** wordmark, subtitle "Zaloguj się, aby uzyskać dostęp do panelu", a
user/ID-styled email field, a "Hasło" field, and a navy "Zaloguj się" button. Valid
credentials log in; authenticated users hitting `/` are redirected to `/dashboard`.
`/auth/signin` stays as an unchanged dark fallback.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Target route | Root `/` (replace `Welcome`) | User chose `/`; `/auth/signin` stays | Frame |
| Auth scope | Visual only; keep Supabase email/password | LDAP ruled out of scope | Frame |
| Product identity | Own brand, Polish copy | Not "WRIFboard"/"panel rynkowy" | Frame |
| Login behavior | Functional `/` + redirect logged-in users to `/dashboard` | A login card should log in; avoids post-login redirect loop | Plan |
| Theming strategy | Light variant for `/` only | No regression to shared dark `/auth/signin` components | Plan |
| Field & footer copy | Keep the look, honest copy (no LDAP text) | Don't advertise auth we don't have | Plan |
| Wordmark / subtitle | "Nieobecności" / "Zaloguj się, aby uzyskać dostęp do panelu" | Front-end brand for the "Urlopy" app | Plan |

## Scope

**In scope:** New light login card on `/`; a `/`-scoped light form component; Polish copy +
logo + wordmark; server-side redirect of authenticated users to `/dashboard`.

**Out of scope:** LDAP/AD auth; WRIFboard/market rebrand; changes to `/auth/signin`,
`/api/auth/signin`, or shared `src/components/auth/*`; deleting `Welcome.astro`; signup.

## Architecture / Approach

Add a light-palette `LoginCardForm.tsx` mirroring `SignInForm`'s behavior contract (client
validation, posts email/password to `/api/auth/signin`, pending state) but styled for the
white card. Compose it in a rewritten `index.astro` with the card chrome, logo, and Polish
copy, plus a top-of-frontmatter guard `if (Astro.locals.user) redirect("/dashboard")`. The
shared dark components and `/auth/signin` are untouched.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Light login card on `/` | Light functional card: layout, logo, copy, light form | Style duplication vs. shared form; visual fidelity to mockup |
| 2. Redirect & guard wiring | Authenticated users on `/` → `/dashboard` | Login flow only fully testable against prod (Drizzle fails in `wrangler dev`) |

**Prerequisites:** None — all files exist; auth endpoint and middleware already in place.
**Estimated effort:** ~1 session across 2 small phases.

## Open Risks & Assumptions

- Light form duplicates some styling from the dark shared components (accepted to avoid
  regressing `/auth/signin`).
- Full login flow must be verified against the production deployment, since Drizzle-backed
  routes can't connect under `wrangler dev` (the `/` guard itself works locally).
- Logo: mockup's market-chart mark is replaced with an absence/leave-appropriate icon.

## Success Criteria (Summary)

- `/` looks like the mockup (light card, "Nieobecności", navy button) and is honest about
  email/password (no LDAP text).
- Logging in from `/` works and doesn't loop back to the card; authenticated `/` → dashboard.
- `/auth/signin` and shared auth components remain unchanged; build + lint pass.
