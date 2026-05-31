# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Prop threading vs. self-contained component lookup

**Context:** src/components/Topbar.astro — role badge for moderator users

**Problem:** Topbar already reads `user` directly from `Astro.locals`, but `role` is received as an optional prop. If the component is reused on a new page without the prop, the moderator badge silently disappears — no error, no warning.

**Rule:** When a server component already performs one Astro.locals lookup (e.g. `user`), prefer doing all related lookups (e.g. `role`) in the same place rather than delegating them to props. Only use a prop when the caller holds data the component genuinely cannot fetch itself (e.g. a pre-fetched employee record shared with other components on the page).

**Applies to:** Astro server components that conditionally render UI based on user attributes.
