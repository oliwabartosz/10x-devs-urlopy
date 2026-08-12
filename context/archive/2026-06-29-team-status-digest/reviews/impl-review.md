<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Poranny digest statusu (team-status-digest)

- **Plan**: context/changes/team-status-digest/plan.md
- **Scope**: All 3 phases (A, B, C)
- **Date**: 2026-06-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Rozjazdy (a) simplified to the no-commit case only

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: scripts/team-digest.ts:307-316, :159-177
- **Detail**: Plan Contract sketched Rozjazdy (a) as a general git↔declared-status divergence; the code implements only the mandatory no-git-history case. The roadmap status map is parsed but its status values are never consumed (dead data); only `roadmap.has(scope)` is used for heading-link detection.
- **Fix A ⭐ Recommended**: Record the simplification as a plan addendum.
  - Strength: The plan explicitly rejects a "stuck" threshold; a broader "stale implementing" divergence would need one. The no-commit signal is deterministic and is the hard requirement — met.
  - Tradeoff: Plan text and code diverge unless documented.
  - Confidence: HIGH — consistent with the plan's no-threshold stance.
  - Blind spot: None significant.
- **Fix B**: Add a threshold-free divergence rule + consume the status map.
  - Strength: Delivers more of (a)'s intent; gives the roadmap status a use.
  - Tradeoff: More logic to design/verify; false-signal risk without a crisp rule.
  - Confidence: MED — exact rule unspecified.
  - Blind spot: Which divergences are useful vs noise.
- **Decision**: FIXED via Fix A (addendum A1 added to plan.md)

### F2 — globSync is the one unguarded I/O path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: scripts/team-digest.ts:97
- **Detail**: Every external boundary degrades gracefully except the `globSync` call in readChanges, which runs before anything is written. A throw there aborts with no digest — the lone gap in the "always writes" guarantee. Low real risk (globSync returns [] for a missing dir).
- **Fix**: Wrap the glob in try/catch; on failure treat as zero changes so the digest still renders.
- **Decision**: FIXED

### F3 — Sentry non-array 200 response renders "undefined"

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: scripts/team-digest.ts:238-241
- **Detail**: If Sentry returns a non-array object on HTTP 200, `issues.length` is undefined and the for...of throws — but the surrounding catch turns it into a graceful "niedostępne" line.
- **Fix**: Add an `Array.isArray(issues)` guard returning a clearer "nieoczekiwany format" message.
- **Decision**: FIXED

### F4 — Benign additions beyond the plan text

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: scripts/team-digest.ts:28, :235, :384-388
- **Detail**: NON_CHANGE_SCOPES adds "deps"/"ci"; AbortSignal.timeout(10s) on Sentry fetch (anticipated by Performance Considerations); loadEnvFile() wrapped in try/catch. All consistent with plan intent; none touch the "What We're NOT Doing" guardrails.
- **Fix**: None — informational.
- **Decision**: ACCEPTED (informational)

### F5 — "--since=yesterday" vs "24h" wording; Sentry org-id form

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: scripts/team-digest.ts:138, :32
- **Detail**: (1) `git log --since=yesterday` is git's "start of yesterday", not a strict rolling 24h; the section title is "od wczoraj", so behavior matches the title. (2) SENTRY_ORG_ID is the numeric "4511534802993152" — the correct REST-endpoint value — even though plan text wrote "o4511534802993152". A correction, not a bug.
- **Fix**: None — both intentional/correct.
- **Decision**: ACCEPTED (informational)
