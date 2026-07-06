<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: CI/CD AI Code Review (GHA + Composite Action)

- **Plan**: context/changes/ci-cd-code-review/plan.md
- **Scope**: Full plan (Phases 1–4)
- **Date**: 2026-07-06
- **Verdict**: NEEDS ATTENTION (all findings fixed during triage)
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Drift: no missing items across all four phases; one justified documented deviation (score as `z.number()` — Anthropic structured-output limitation); benign extras only (dev-script retarget, PR_TITLE guard, `prReviewer` export). All seven "What We're NOT Doing" guardrails held. Cross-phase seams (CLI JSON ↔ RenderableReview ↔ action plumbing ↔ rubric keys) consistent. Phase-3 review fixes (af615b0) verified intact. Success criteria re-run live: 19/19 tests, tsc clean, workflow active; manual checks verified on PR #6.

## Findings

### F1 — Stale ai-cr:passed label survives a failed review (fails open)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .github/actions/ai-review/action.yml (label swap last) / workflow
- **Detail**: A failed run (attacker-inducible via prompt-injected schema-invalid model output) left previous verdict labels in place — a bypass if anything ever gates on `ai-cr:passed`.
- **Fix A ⭐ (applied)**: Workflow-level `if: failure()` step removes `ai-cr:passed` — fail-closed without label flicker on normal runs.
- **Fix B**: Strip both verdict labels at run start (simpler, but no label visible during each review).
- **Decision**: FIXED via Fix A

### F2 — Self-triggered labeled run can cancel the original run's tail

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ai-review.yml (concurrency)
- **Detail**: The action's verdict-label write fires a labeled event whose (guard-skipped) run still entered the concurrency group with cancel-in-progress, able to cancel the original run mid-label-swap.
- **Fix**: `cancel-in-progress: ${{ github.event.action != 'labeled' }}`.
- **Decision**: FIXED

### F3 — Diff fetched with --patch includes attacker commit messages

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: action.yml (Fetch PR data) + prompts/pr-review.ts
- **Detail**: format-patch commit messages sit at column 0 and can close the ```diff fence; no real capability gain, but plain diff is tighter and saves truncation budget.
- **Fix**: Dropped `--patch`; prompt now states everything below is untrusted PR content, not instructions.
- **Decision**: FIXED

### F4 — Third-party actions pinned by tag, not SHA

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: ai-review.yml (checkout), action.yml (setup-node, github-script)
- **Detail**: Mutable tags in a pull_request_target workflow carrying a secret + write token.
- **Fix**: All three pinned to full commit SHAs (checkout 34e11487, setup-node 49933ea5, github-script f28e40c7) with tag comments. Follow-up idea: align ci.yml similarly.
- **Decision**: FIXED

### F5 — Comment-upsert author filter hardcodes github-actions[bot]

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: action.yml (github-token input vs upsert filter)
- **Detail**: A PAT/App token would author comments under a different login, breaking the sticky lookup into duplicates.
- **Fix**: Constraint documented on the `github-token` input description.
- **Decision**: FIXED

### F6 — README exit-code list omits the PR_TITLE failure mode

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: packages/code-reviewer/README.md
- **Detail**: cli.ts exits 1 on missing/empty PR_TITLE; the documented exit-1 list didn't mention it.
- **Fix**: Added to the README's exit-1 list.
- **Decision**: FIXED
