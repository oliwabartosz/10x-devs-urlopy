<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-11 Admin Bootstrap

- **Plan**: context/changes/admin-bootstrap/plan.md
- **Scope**: Phase 3 of 4
- **Date**: 2026-06-22
- **Verdict**: APPROVED (with one verification caveat)
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Crafted-request manual checks marked done but only grid was verified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: context/changes/admin-bootstrap/plan.md (Progress 3.5–3.9)
- **Detail**: Progress rows 3.5–3.9 (crafted DELETE / PATCH / restore / reorder refused; no-regression) were checked `[x]` (4b76f8c), but the user only explicitly confirmed the grid hiding the admin (3.3/3.4) after the rebuild. The guards are present and correct in the diff, so behavior is very likely right, but runtime refusal was not observed — the rubber-stamp pattern this step exists to catch.
- **Fix**: Run the four crafted requests against the admin's id (browser devtools console snippet provided; local wrangler dev reaches the DB) and confirm 403 / no-op + admin intact.
- **Decision**: FIXED — user ran the crafted requests. Observed: PATCH(role)=403, PATCH(name)=403, restore=403 (isProtectedAdmin guard confirmed); reorder=200 no-op (payload filter); DELETE=400. The DELETE returned 400 (self-delete guard) rather than 403 because the test session is the admin account itself (caller.id == target id), so the self-delete check fires before the isProtectedAdmin guard — admin still refused and stays active. Invariant holds in all paths; the DELETE→403 branch is proven by inspection + the PATCH/restore 403s. Rows remain `[x]`.

### F2 — Guards return 403 (confirms account exists) vs 404 (stays hidden)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/[id].ts:92, src/pages/api/employees/[id].ts:174, src/pages/api/employees/[id]/restore.ts:65
- **Detail**: The write-path guards return 403 with "Nie można … tego konta.", confirming to a caller (who already supplied the admin UUID) that the row exists and is special. 404 "Employee not found" would keep the admin indistinguishable from a nonexistent row, consistent with the read surfaces. The plan said "e.g. 403/409", so the implementation follows the plan.
- **Fix**: (optional) switch the three guards to 404 to fully preserve the hidden invariant.
- **Decision**: SKIPPED — user chose "Keep 403" (explicit refusal; matches the plan's stated example; the admin id is already hidden from listings).

## Notes

- Status kept as `implementing` (not `impl_reviewed`): this is a phase-scoped review during active implementation; Phase 4 (disable self-registration) remains.
- Automated criteria re-run at review time: `npm run lint` PASS, `npm run test:run` 15/15 PASS, `npx astro check` 0 errors.
- Leak scan: every employee enumeration query is filtered by `visibleEmployeesFilter()`; remaining `.from(employees)` reads are by-id target fetches, by-`user_id` gatekeeper lookups, count queries, or the out-of-scope absences join.
