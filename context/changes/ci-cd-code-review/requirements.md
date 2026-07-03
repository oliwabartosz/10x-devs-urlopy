## Overall concept

- GHA workflow run for every new pull request to master
- composite action for the review itself so that main workflow is easy to reason about

## Input parameters

- pull request title
- pull request description (?? cost tradeoff)
- git diff

## Code Review Criteria

Each criterion is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best.

1) **Implementation** — Does the change correctly and completely do what it sets out to do, with sound logic and proper handling of edge cases?
   - _1–10:_ **1** = logic is broken, misses the stated goal, or fails on obvious edge cases; **10** = fully correct, handles edge cases, and does exactly what it intends with no gaps.

2) **Idiomaticity** — Does the code follow the language, framework, and project conventions rather than fighting them?
   - _1–10:_ **1** = ignores established patterns, reinvents built-ins, and clashes with the surrounding codebase; **10** = reads like it was written by a seasoned contributor, using the right idioms and existing utilities throughout.

3) **Complexity** — Is the change as simple as it can be, avoiding unnecessary abstraction, nesting, or cleverness?
   - _1–10:_ **1** = convoluted, over-engineered, or needlessly hard to follow; **10** = minimal and clear, with every piece of complexity justified by a real need.

4) **Test / risk coverage** — Are the meaningful paths and failure modes covered by tests proportionate to the risk the change carries?
   - _1–10:_ **1** = no tests where they clearly matter and high-risk paths left unguarded; **10** = risk-appropriate tests that exercise the important behaviors and likely failure modes.

5) **Documentation** — Are non-obvious decisions, public interfaces, and behavior explained where a future reader would need it?
   - _1–10:_ **1** = opaque code, missing or misleading comments and docs where they are needed; **10** = clear docs and comments that capture intent and constraints without stating the obvious.

6) **Security and safety** — Does the change avoid introducing vulnerabilities, unsafe data handling, or risky side-effects?
   - _1–10:_ **1** = introduces exploitable flaws, leaks secrets, or handles untrusted input unsafely; **10** = defends against relevant threats, validates input, and handles sensitive data and side-effects safely.

## Parked for later

- business alignment (require broader context)
- architectural fit (require broader context)

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- on-demand retry when label `ai-cr:review` is added
