---
change_id: grid-adjustment-offsite-training
title: Bound the grid's column width and drop the type name from the cell
status: archived
created: 2026-08-11
updated: 2026-08-13
archived_at: 2026-08-13T08:20:24Z
---

## Notes

Grid is to wide when user sets szkolenie/wyjście poza miejsce pracy HH:MM -> it should be szkolenie/wyjście \n poza NBP \n HH:MM

2026-08-12 — scope widened to **all seven absence types**, not just offsite training. The follow-up
audit in `research.md` shows four of seven types breach the 120px column floor with no `HH:MM` at all,
and that the employee-name header — not the chip — sets the width of five of seven columns. The title
was retitled the same day from "Wrap the offsite/training label so the grid stops widening" to match
the research's recommendation: drop the type name from the cell (prototype parity, option A) **and**
bound the table structurally (option D), which is the only lever that also bounds the header. The
originally requested three-line wrap (option C) and a DB rename (option E) were both rejected — see
`research.md` follow-up section. The change-id stays `grid-adjustment-offsite-training`.

### Resolved 2026-08-13 — 3.3 and 4.3 both closed

Phase 4 landed in `4d9b2c5` (sha recorded in `07049c0`) and `main` was pushed, deploying
`07049c0` to the Worker. `npm run e2e` then ran against that deployment — 5/5 green — which is
the first run that exercises a build carrying Phases 3 and 4, so it closes both 3.3 and 4.3 as
planned below. The Phase 1 icon migration needed no action: production already stored `🏃`
(`length = 1`), and all seven types verified as single-codepoint, re-confirming 1.3 against prod.

All plan criteria are now satisfied; the change is ready to archive.

### Impl review 2026-08-13 — NEEDS ATTENTION, all three findings fixed

`reviews/impl-review.md`. Plan Adherence, Scope Discipline, Architecture, Pattern Consistency and
Success Criteria all PASS; Safety & Quality WARNING on two findings, both now fixed. F1: the Phase 1
icon migration had no execution path — the journaled seed reinstates the ZWJ sequence on a fresh
environment and `db:migrate` skips the unjournaled correction, so AGENTS.md now documents the
hand-apply step. F2: `role="img"` made the substitute badge and comment marker presentational, so
the chip's `aria-label` now names them. F3 (observation): the tooltip's range formatting was an
untested copy — `rawTimeRange` is now shared, so only the gate differs. The fixes are uncommitted;
they need their own commit before archiving.

### Open criterion after Phase 3 (2026-08-12) — superseded by the note above

Criterion 3.3 is half-satisfied and deliberately left `- [ ]`. Its `npm run test:run` arm is green
(17 files, 157/157); its `npm run e2e` arm has not run. `playwright.config.ts:24` resolves
`baseURL` to the deployed Worker unless `BASE_URL` overrides it, so E2E exercises whatever is
live — not the working tree. Running it before this change reaches `main` would report on the
previous build and prove nothing about Phase 3. Local override is not a way out either: the grid
needs Drizzle, which cannot reach Supabase under `wrangler dev` (see CLAUDE.md).

**Tick 3.3 on the next push to `main`**, against a real run. Phase 4 carries the same structure in
its own 4.3, and both can be closed by one post-deploy run. This mirrors `e2e-auth-locators`,
which closed with its 3.2 open for the same reason.
