# Frame Brief: Main-page login redesign

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

"Update main page to this" + a mockup (`target-design.png`) of a centered
login card: light-gray page, soft-shadowed white card, chart-in-circle logo,
**WRIFboard** wordmark, subtitle "Zaloguj się, aby uzyskać dostęp do panelu
rynkowego", a **Użytkownik / ID** field ("np. U123456 lub login LDAP") with a
trailing validation icon, a **Hasło** field, a dark-navy **"Zaloguj się"**
button, and a footer noting **LDAP (Active Directory)** + local accounts.

## Initial Framing (preserved)

- **User's stated cause or approach**: the app's sign-in UI should look like the mockup.
- **User's proposed direction**: restyle the page to match the image.
- **Pre-dispatch narrowing** (Step 1.5 answers):
  - **Target page** → the **root landing `/`** (replace the leftover "10x Astro Starter" `Welcome.astro`); `/auth/signin` stays as the existing sign-in.
  - **Auth scope** → **visual only** — keep current Supabase email/password; *skip LDAP* ("it won't be working this year").
  - **Brand + language** → **adopt visual style + Polish copy**, but keep our own app identity/domain — *not* literally "WRIFboard" / "panel rynkowy".

## Dimension Map

The mockup could imply a change at any of these layers:

1. **Presentation / layout** — dark cosmic glassmorphism → light card, new logo, icons, button style. ← where the real change lives
2. **Copy / i18n** — English → Polish; wordmark + subtitle text. ← in scope (our identity, PL wording)
3. **Auth mechanism** — email/password (Supabase) → LDAP/AD + local accounts. ← initial framing implied this; **ruled out** by user
4. **Product identity / domain** — leave-management app → "WRIFboard / market panel". ← **ruled out** (visual reference only)
5. **Routing** — which route renders the design (`/` vs `/auth/signin`). ← resolved to `/`

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| Change is presentation-layer only | `src/pages/index.astro` renders `Welcome.astro` (starter cosmic landing); `src/pages/auth/signin.astro` + `SignInForm.tsx` are dark/glass. All restyleable without touching auth. | STRONG (in scope) |
| Change requires LDAP/AD auth (initial framing) | Backend is Supabase email/password: `SignInForm.tsx:43` posts email+password to `/api/auth/signin`; `middleware.ts` uses `supabase.auth.getUser()`. No LDAP anywhere. LDAP would be a new integration, not a restyle. | STRONG evidence it's a *big* change — **but user ruled it out of scope** |
| Full "WRIFboard / market panel" rebrand | Domain is leave management (`employees`, roles). "panel rynkowy" is unrelated product language — mockup is from a different context. | NONE (user keeps own identity) |
| Design belongs on `/` vs `/auth/signin` | `/` is currently an unauthenticated starter Welcome; user chose to replace it. `/auth/signin` remains. | Resolved → `/` |

## Narrowing Signals

- User: **target is the root `/`**, keep `/auth/signin` as the actual sign-in.
- User: **visual only, skip LDAP** — the mockup's LDAP/AD login is a *label*, not a requirement.
- User: **Polish copy + our own brand** — drop "WRIFboard"/"panel rynkowy" verbatim; use our product name and an appropriate Polish subtitle.

## Cross-System Convention

The auth UI is already componentized and reusable: `FormField`, `PasswordToggle`,
`SubmitButton`, `ServerError` (`src/components/auth/`) posting to the existing
`/api/auth/signin`. The convention is to restyle/compose these, not rebuild auth.
The redesign should reuse this stack rather than introduce a parallel one.

## Reframed Problem Statement

> **The actual problem to plan around is**: restyle the root `/` landing into a
> light-themed, Polish, login-style card that matches the mockup's *look* while
> reusing the existing Supabase email/password auth and our own product identity —
> treating the mockup's LDAP/AD login, "WRIFboard" name, and "panel rynkowy"
> framing as visual reference, not literal requirements.

The initial framing ("make the sign-in look like this") was directionally right
but carried three hidden literal readings (LDAP auth, WRIFboard rebrand, the
`/auth/signin` route). All three are now explicitly out of scope. What remains is
a presentation + Polish-copy change on `/`.

## Confidence

**MEDIUM-HIGH.** Scope is user-confirmed on all three forks. Two details remain
open for /10x-plan to settle (they are design choices, not blockers):

1. **Is the `/` card a *functional* login or a presentational landing?** A login
   card that doesn't log in is odd; recommended default is functional — wire its
   form to the existing `/api/auth/signin` (email/password), styling the "email"
   input as the "Użytkownik / ID" field. Confirm at plan time. This also raises
   what `/auth/signin` is *for* once `/` logs in (keep as fallback vs. redirect).
2. **Exact wordmark + subtitle wording** — the real product name (Polish) and a
   fitting subtitle to replace "WRIFboard" / "panel rynkowy".

## What Changes for /10x-plan

Plan a **presentation + i18n restyle of `src/pages/index.astro`** (replacing
`Welcome.astro`) into the mockup's light login card, reusing the existing
`src/components/auth/*` stack and Supabase email/password endpoint. **Do not**
plan LDAP/AD auth or a WRIFboard domain rebrand. Resolve the two open details
above early in planning.

## References

- Source files: `src/pages/index.astro:1`, `src/components/Welcome.astro:1`, `src/pages/auth/signin.astro:1`, `src/components/auth/SignInForm.tsx:43`, `src/middleware.ts:8`, `src/pages/api/auth/signin.ts`
- Mockup: `context/changes/main-page-redesign/target-design.png`
- Investigation: direct reads (surface small; no parallel sub-agents needed)
