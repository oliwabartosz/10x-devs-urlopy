# Promptfoo Evals for the Code Reviewer — Plan Brief

> Full plan: `context/changes/code-review-evals/plan.md`
> Research: `context/changes/code-review-evals/research.md`

## What & Why

Give `packages/code-reviewer` its first eval harness: a promptfoo configuration that runs the production PR-review agent across three OpenRouter models against a known-bad test case, so model choices (currently `deepseek/deepseek-v4-pro` in CI) can be compared on evidence instead of vibes. The immediate question: do cheaper candidates (`z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`) catch what the current production model catches?

## Starting Point

The package was deliberately structured for this (three-tier agent surface, side-effect-free barrel, standalone zod schemas, deterministic `deriveVerdict`) and the eval environment was explicitly deferred twice in prior changes. Research has already verified promptfoo v0.121.x fits: native TS provider loading, native OpenRouter support, `llm-rubric` judging. No eval files exist yet.

## Desired End State

`npm run eval` in the package produces a 3-model comparison matrix for one hard fixture — a React 16 → 19 migration diff seeded with three impactful flaws. Each cell shows whether that model's review identified each flaw (LLM-judged) and whether the review correctly failed the PR (deterministic, via the real `deriveVerdict`). `npm run eval:view` opens the results viewer. One `OPENROUTER_API_KEY` powers everything.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Eval toolkit | promptfoo, pinned exact devDependency | Mature, MIT, native OpenRouter + TS providers; 0.x churn demands pinning | Research |
| Third model (user listed two) | `deepseek/deepseek-v4-pro` | It's what CI runs today — makes the eval directly actionable | Plan |
| Review mode under test | PR mode (`reviewPr`) | The mode driving the real CI verdict; fixture is naturally a diff; `deriveVerdict` enables the static assert | Plan |
| Judge model | `openrouter:anthropic/claude-sonnet-5` via `defaultTest.options.provider` | Stronger than and distinct from all three SUTs (no self-grading); default grader is OpenAI and must be overridden anyway | Plan |
| Seeded flaws | Stale-closure interval, dropped effect cleanup (leak/race), derived-state infinite render loop | Classic, impactful, diff-visible class→hooks migration bugs with graded difficulty | Plan |
| Judge granularity | One `llm-rubric` per flaw (3 assertions) | Per-flaw pass/fail per model — shows exactly which flaw each model missed | Plan |
| Static assertion | `javascript` assert importing `deriveVerdict`; pass iff `"failed"` | Reuses production threshold logic instead of re-implementing it | Plan |
| Run scope | Local npm script only, no CI | Zero CI cost/coupling while the fixture set is one test case | Plan |
| Provider bridge | Custom `file://` TS provider wrapping `reviewPr`, model via provider `config` | Documented promptfoo pattern for whole-agent evals; evals the true production path incl. truncation | Research |

## Scope

**In scope:** promptfoo devDependency + npm scripts; `evals/` directory (config, one provider, one assertion module, one fixture + ground-truth doc); three-model matrix; 3 LLM rubrics + 2 deterministic assertions; README "Evals" section.

**Out of scope:** CI integration, snippet-mode (`reviewCode`) evals, prompt-only A/B evals, `promptfoo share`, repetition/stability tuning, any change to `src/` production code.

## Architecture / Approach

One custom TS provider (`evals/providers/pr-review.ts`) bridges promptfoo to the real agent: vars in → `truncateDiff` → `reviewPr(input, { model: config.model })` → validated `PrReviewResult` object out. The config instantiates it three times (one per model, labeled). The fixture diff loads via `file://` vars. Judging: three per-flaw `llm-rubric` assertions graded by Sonnet through OpenRouter, plus two deterministic `javascript` asserts (verdict failed; scores are integers 1–10).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness scaffolding | promptfoo installed, provider + config + npm scripts, smoke run green | Transitive `.js`-specifier TS imports may not resolve under promptfoo's loader (fallback: `NODE_OPTIONS="--import tsx"`) |
| 2. Seeded-flaw fixture | The React 16→19 migration diff + ground-truth doc, wired into the config | Fixture quality — accidental extra bugs or unfindable flaws corrupt the eval |
| 3. Assertions + live run + docs | Per-flaw rubrics, deterministic asserts, full 3-model run, README | Judge leniency (vague reviews passing rubrics) — rubrics demand concrete identification |

**Prerequisites:** `OPENROUTER_API_KEY` in `packages/code-reviewer/.env`; Node ≥ 22.22 locally (v24.15.0 installed ✓)
**Estimated effort:** ~2-3 sessions, one per phase; Phase 2 (fixture authoring) is the craftsmanship-heavy one

## Open Risks & Assumptions

- Promptfoo's TS loader must resolve the package's `.js`-style internal imports; a tsx-based fallback is planned if not (settled by the Phase 1 smoke run)
- The static "review must fail" assertion assumes a competent reviewer scores implementation < 5 for three severe bugs — a model may find the flaws yet still pass the PR; that outcome is treated as signal, not harness failure
- Rubric quality depends on the ground-truth doc; a manual judge sanity-check (rubric for a nonexistent flaw must fail) is in the test plan
- Promptfoo 0.x config surface may shift — version pinned exact to freeze it

## Success Criteria (Summary)

- `npm run eval` runs the same review prompt on all three models and every assertion cell resolves with zero harness errors on a single OpenRouter key
- The matrix legibly answers: which model catches which of the three planted flaws, and does each model fail the PR
- A newcomer can run the eval from the README alone
