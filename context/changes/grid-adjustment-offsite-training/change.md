---
change_id: grid-adjustment-offsite-training
title: Bound the grid's column width and drop the type name from the cell
status: implementing
created: 2026-08-11
updated: 2026-08-12
archived_at: null
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

### Open criterion after Phase 3 (2026-08-12)

Criterion 3.3 is half-satisfied and deliberately left `- [ ]`. Its `npm run test:run` arm is green
(17 files, 157/157); its `npm run e2e` arm has not run. `playwright.config.ts:24` resolves
`baseURL` to the deployed Worker unless `BASE_URL` overrides it, so E2E exercises whatever is
live — not the working tree. Running it before this change reaches `main` would report on the
previous build and prove nothing about Phase 3. Local override is not a way out either: the grid
needs Drizzle, which cannot reach Supabase under `wrangler dev` (see CLAUDE.md).

**Tick 3.3 on the next push to `main`**, against a real run. Phase 4 carries the same structure in
its own 4.3, and both can be closed by one post-deploy run. This mirrors `e2e-auth-locators`,
which closed with its 3.2 open for the same reason.
