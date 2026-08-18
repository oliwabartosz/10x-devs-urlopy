# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Prop threading vs. self-contained component lookup

**Context:** src/components/Topbar.astro — role badge for moderator users

**Problem:** Topbar already reads `user` directly from `Astro.locals`, but `role` is received as an optional prop. If the component is reused on a new page without the prop, the moderator badge silently disappears — no error, no warning.

**Rule:** When a server component already performs one Astro.locals lookup (e.g. `user`), prefer doing all related lookups (e.g. `role`) in the same place rather than delegating them to props. Only use a prop when the caller holds data the component genuinely cannot fetch itself (e.g. a pre-fetched employee record shared with other components on the page).

**Applies to:** Astro server components that conditionally render UI based on user attributes.

## Repo-wide claims are load-bearing — verify before writing one down

**Context:** `src/tests/api/holiday-balances/is-system-guard.test.ts:10` and the grid-multicheck plan (`context/archive/2026-08-12-grid-multicheck/plan.md`)

**Problem:** Two confident claims about the whole repository were written into artifacts without being checked, and each was false at the moment it was written. "The balance upsert was the last mutation path in the codebase without an `is_system` guard" — `POST /api/absences` lacked one then and kept lacking it for months. "There is no integration-test layer in this repo" — `src/tests/api/` already held seven route-level suites, all predating that plan. Neither claim was incidental: the first closed the question of whether any write path still needed the guard, and the second routed all `bulk.ts` verification to manual checks, so the highest-risk file in that change shipped untested. Both gaps then had to be closed by a later change (`absence-write-hardening`). A claim like this is not commentary — it is the premise the reader stops searching on.

**Rule:** Before writing a universally-quantified claim about the repository — "every X does Y", "there is no Z", "this is the last W", "nothing tests V" — run the search that would falsify it and let the result decide the wording. One `grep -rl` is cheaper than the change needed to undo a wrong one. If the search is not run, do not write the claim: state the narrower thing actually observed ("the five routes I read do Y") instead. When such a claim is inherited from an earlier plan, review, or comment, re-verify it rather than propagating it — that is how the second of these two survived.

**Applies to:** plans, research documents, review findings, and code comments that assert something about the codebase as a whole.
