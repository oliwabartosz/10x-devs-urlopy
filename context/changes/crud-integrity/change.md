---
change_id: crud-integrity
title: "Phase 1 — Bootstrap Vitest and prove Drizzle CRUD integrity + 409 duplicate handling"
status: impl_reviewed
created: 2026-06-03
updated: 2026-06-04
archived_at: null
---

## Notes

Test rollout Phase 1 from `context/foundation/test-plan.md` (§3 row 1). Covers risks #1 (Drizzle CRUD produces wrong DB state) and #6 (duplicate absence returns 500 instead of 409). First task is bootstrapping the Vitest test runner in a Node env; second is writing integration tests against a real Supabase DB via DATABASE_URL_DIRECT; third is a unit test protecting the `e.cause?.code === "23505"` → 409 path.
