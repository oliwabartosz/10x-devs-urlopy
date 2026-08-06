<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Main-Page Login Redesign

- **Plan**: context/changes/main-page-redesign/plan.md
- **Scope**: Phases 1–2 of 2 (all complete)
- **Date**: 2026-08-06
- **Verdict**: APPROVED
- **Findings**: 0 critical  0 warnings  2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS (1 justified divergence) |
| Success Criteria | PASS |

Automated criteria re-run at review time: `npm run lint` → 0 errors (10 pre-existing
`code-reviewer` warnings); `npm run build` → Complete; no `Welcome` import in
`index.astro`. Manual criteria 1.5–1.9 and 2.3–2.6 all `[x]` (2.3–2.6 confirmed on
production). Scope guardrails held: input names exactly `email`/`password`; no LDAP/WRIFboard
text; shared `src/components/auth/*`, `/auth/signin`, `/api/auth/signin` byte-for-byte
unchanged (git diff empty); `Welcome.astro` not deleted; no signup wiring.

## Findings

### F1 — useFormStatus spinner is inert with a string-action form

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/auth/LoginCardForm.tsx:16-38
- **Detail**: `LightSubmitButton` reads `useFormStatus().pending`, but the form submits via a string `action="/api/auth/signin"` (native browser POST + navigation), not a React action function, so `pending` never flips true and the "Logowanie…" spinner never renders. Not a regression — the shared `SubmitButton.tsx` / `SignInForm.tsx` have the identical inert pattern.
- **Fix**: Accept as-is for parity with SignInForm. Only if a real loading state is wanted, drive it from local `onSubmit` state instead of `useFormStatus`.
- **Decision**: FIXED — replaced `useFormStatus` with a local `submitting` state set in `handleSubmit` on valid submit; `LightSubmitButton` now takes a `pending` prop. Build + type-check + lint pass.

### F2 — Auth primitives re-implemented rather than composed

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture / Pattern Consistency
- **Location**: src/components/auth/LoginCardForm.tsx (whole file)
- **Detail**: `SignInForm` composes `FormField` / `PasswordToggle` / `SubmitButton` / `ServerError`; `LoginCardForm` inlines equivalents. This was a deliberate plan decision — the shared components are hard-styled for the dark cosmic theme (`bg-white/10`, `text-white`, `bg-purple-600`) and cannot express the light NBP card, chosen explicitly to avoid regressing `/auth/signin`. Cost: validation / `clearError` / `useFormStatus` logic now lives in two places.
- **Fix**: No action now — the duplication is the sanctioned tradeoff. If the light theme later becomes the standard, consider theme-parametrizing the shared components rather than keeping two forks. (Candidate for a follow-up / lesson.)
- **Decision**: SKIPPED — accepted as the plan's deliberate tradeoff to avoid regressing `/auth/signin`.
