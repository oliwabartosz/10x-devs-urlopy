---
change_id: grid-bulk-delete
title: Enable bulk delete of absences in the grid
status: implementing
created: 2026-09-01
updated: 2026-09-01
archived_at: null
---

## Notes

User can now bulk add or change type of holidays in grid. However when it comes to bulk deleting, the option is unavailable - but it should!

## Coverage note — E2E is developer-run

`tests/e2e/absence-grid-range.spec.ts` gained two bulk-delete cases in Phase 4. **They do not run
in CI.** `.github/workflows/ci.yml` has no Playwright step at all — its only contact with the E2E
suite is a pair of greps asserting that the sign-in copy strings `auth.setup.ts` locates against
still exist (`ci.yml:80`, `:112`). Verified by searching the workflow for `e2e` and `playwright`;
every hit is inside those grep guards.

So the route-level suites are the gate that actually blocks a merge:

- `src/tests/api/absences/delete.test.ts` (single-row DELETE, 7 cases)
- `src/tests/api/absences/bulk-delete.test.ts` (the new route, 17 cases)

The E2E spec is the browser-level check a developer runs by hand with
`BASE_URL=<local> npm run e2e`, and it needs `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` set plus
`npx playwright install chromium`.
