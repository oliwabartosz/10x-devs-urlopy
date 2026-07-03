# CI/CD AI Code Review — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`
> Requirements: `context/changes/ci-cd-code-review/requirements.md`

## What & Why

Every pull request to `main` should get an automatic AI review: six criteria (Implementation, Idiomaticity, Complexity, Test/risk coverage, Documentation, Security) scored 1–10 with justifications, actionable findings, a sticky PR comment, and an `ai-cr:passed`/`ai-cr:failed` label — with on-demand retry by adding the `ai-cr:review` label. The review is advisory: it informs, it never blocks a merge.

## Starting Point

The AI engine already exists: `packages/code-reviewer` (Vercel AI SDK `ToolLoopAgent` + OpenRouter + zod) — but it reviews a single hardcoded code snippet and emits severity findings, not PR-shaped rubric scores. There is no GitHub Actions integration, no PR-comment/label code anywhere in the repo, and the package is standalone (not an npm workspace member).

## Desired End State

Open or update a PR → within minutes a single comment appears (and updates in place on later pushes) with a verdict headline, a 6-row score table, and itemized findings; the PR carries exactly one `ai-cr:passed` or `ai-cr:failed` label. Adding `ai-cr:review` re-runs the review. The workflow check stays green whenever the review completes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Verdict rule | Per-criterion floor: fail if any score < 5 | Simplest rule to explain; one number, no weighting | Plan (user choice) |
| Verdict location | Derived in TypeScript, not model-emitted | Deterministic and unit-testable; threshold in one place | Research |
| Trigger event | `pull_request_target`, never checking out PR head | Fork PRs get secrets + write token safely; diff fetched as passive data via `gh pr diff` | Plan (user choice) |
| Prompt input | Title + full description + diff capped at 100k chars | Description carries the intent the Implementation criterion needs; cap bounds cost | Plan (user choice) |
| Comment content | Score table + verdict + itemized findings | Scores say IF it passed; findings say WHAT to fix before retrying | Plan (user choice) |
| Model | Keep `anthropic/claude-sonnet-5` (overridable input) | Best rubric-scoring quality; diff cap already bounds cost | Plan (user choice) |
| Check status | Always green when review completes | LLM rubric is advisory; only infra errors fail the job | Plan (user choice) |
| Comment mechanism | `github-script` upsert on `<!-- ai-cr -->` marker | Precise and safe if other bots ever comment | Research |
| Architecture split | Thin workflow, fat composite action | Requirements mandate it; workflow stays trigger-plumbing only | Requirements |
| Package wiring | Second scoped `npm ci` in `packages/code-reviewer` | Root is not a workspace; reviewer has its own lockfile | Research |

## Scope

**In scope:** PR-review schema/prompt/agent entry + verdict function in the package; real CLI (env + stdin → JSON + exit codes); diff truncation; comment renderer; composite action (`.github/actions/ai-review`); workflow (`.github/workflows/ai-review.yml`) with self-loop guard, permissions, concurrency, idempotent label creation; first unit tests in the package (`node:test` via tsx); docs.

**Out of scope:** merge gating / branch protection; inline diff annotations; business-alignment & architectural-fit criteria (parked); promptfoo evals; npm-workspace conversion; any change to the existing `ci.yml`.

## Architecture / Approach

Workflow (`pull_request_target`, types incl. `labeled` guarded to `ai-cr:review`) checks out the trusted base ref only and delegates to the composite action. The action: installs the reviewer (scoped `npm ci`), fetches title/body/diff via `gh` (never shell-interpolating attacker-controlled payload strings), pipes them into the CLI, which runs `reviewPr()` and prints JSON `{summary, scores, findings, verdict, truncated, model}`. The action renders that to markdown, upserts the sticky comment, and swaps labels via `gh pr edit` (404-safe). Verdict = TypeScript floor check, not model opinion.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. PR review engine | Schema, scoring prompt, `reviewPr()`, `deriveVerdict()` + first unit tests | Model scores noisily against the rubric — prompt anchors must be verbatim from requirements |
| 2. CLI contract | env/stdin → JSON/exit-code seam the action calls | Stdout purity (JSON only) and infra-vs-verdict exit-code separation |
| 3. Composite action | Install → fetch → review → render → comment → labels | Composite actions can't read secrets; inputs unmasked — must never be logged |
| 4. Workflow + E2E | `pull_request_target` trigger with guards; live test-PR verification | Self-loop via own label writes; pwn-request if anyone ever adds a head checkout |

**Prerequisites:** `OPENROUTER_API_KEY` set as a GitHub repository secret before the first run.
**Estimated effort:** ~2–3 sessions across 4 phases; Phase 4 needs a live test PR.

## Open Risks & Assumptions

- LLM scoring on a 1–10 rubric is noisy; with a hard floor of 5, borderline PRs may flip verdicts between runs — the `ai-cr:review` retry label is the pressure valve.
- `pull_request_target` is safe only while the invariant "never checkout/execute PR head" holds; a future careless edit is the main long-term risk (called out in plan + run-log verification step).
- Assumes PR diffs are usually well under 100k chars; oversized PRs get an honestly-flagged partial review.

## Success Criteria (Summary)

- Every PR to `main` gets exactly one up-to-date review comment and one verdict label, refreshed on each push.
- Adding `ai-cr:review` reliably re-runs the review; the action's own label writes never re-trigger it.
- The review never blocks a merge — the check is green whenever the review completes.
