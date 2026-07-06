<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: CI/CD AI Code Review (GHA + Composite Action)

- **Plan**: context/changes/ci-cd-code-review/plan.md
- **Scope**: Phase 3 of 4
- **Date**: 2026-07-06
- **Verdict**: NEEDS ATTENTION (all findings fixed during triage)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Drift review: all planned Phase 3 items MATCH (no MISSING/DRIFT). Benign extras: `RenderableReview` input validation, `cell()` table escaping, paginated comment lookup, conditional `OPENROUTER_MODEL` export, additive barrel export. Invariants verified: no PR-head checkout, no payload expression interpolation, exit codes propagate (`bash -eo pipefail`), secrets never echoed and absent from `npm ci` step.

## Findings

### F1 — Sticky-comment lookup can be hijacked by any commenter

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/actions/ai-review/action.yml (upsert script)
- **Detail**: The upsert matched the first comment containing `<!-- ai-cr -->` regardless of author; anyone commenting the marker literal first would capture the sticky slot and own the "official" review comment.
- **Fix**: Filter the lookup on `c.user.login === "github-actions[bot]"` in addition to the marker.
- **Decision**: FIXED

### F2 — Model-authored text lands raw in the comment (@-mention spam, spoofed banners)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/code-reviewer/src/render-comment.ts
- **Detail**: summary/issue/suggestion are model output derived from attacker-controlled PR content; a prompt-injection payload could make the bot's comment ping @users/@teams. Spoofing/spam only — no code-execution or token risk.
- **Fix**: `neutralizeMentions()` breaks `@word` with a zero-width space; applied to summary, table cells (via `cell()`), and findings; unit-tested.
- **Decision**: FIXED

### F3 — gh repo resolution relies on the caller's checkout

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/actions/ai-review/action.yml (gh steps)
- **Detail**: Without `GH_REPO`, gh resolves the repo from the caller's checked-out git remote — an implicit contract.
- **Fix**: `GH_REPO: ${{ github.repository }}` added to all three gh steps' env.
- **Decision**: FIXED

### F4 — No guard on GitHub's 65,536-char comment body limit

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/code-reviewer/src/render-comment.ts
- **Detail**: An oversized rendered review would 422 the comment API after a paid model call.
- **Fix**: `MAX_COMMENT_CHARS = 60_000` clamp — body is cut with a notice, the footer (model + retry hint) always survives; unit-tested.
- **Decision**: FIXED

### F5 — Direct-run error handling diverges from cli.ts's fail() pattern

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: packages/code-reviewer/src/render-comment.ts (direct-run block)
- **Detail**: JSON/zod parse errors escaped as raw stack traces instead of the `ai-review: <msg>` stderr one-liner cli.ts uses.
- **Fix**: try/catch around parse/render printing `ai-review: <message>` to stderr with exit 1; verified against schema-invalid input (exit 1).
- **Decision**: FIXED
