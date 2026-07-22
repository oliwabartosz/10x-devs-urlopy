---
change_id: hours-onsite-training-only
title: Restrict hours-range entry to the "szkolenie w miejscu pracy" category only
status: archived
created: 2026-06-22
updated: 2026-07-22
archived_at: 2026-07-22T11:08:52Z
---

## Notes

Adding hours should be available to users just for the category: "szkolenie w miejscu pracy".

## Deviations from the plan

Recorded during Phase 2 manual verification (2026-07-20); the plan's phase blocks are left
as the historical record.

1. **The rule admits two types, not one.** The plan (and Phase 1, committed in `03a0249`)
   assumed partial-day eligibility was exactly `szkolenie w miejscu pracy`. Manual testing
   established that `szkolenie/wyjście poza miejsce pracy` must also be eligible.
   `src/lib/absence-types.ts` now exports `PARTIAL_DAY_TYPE_NAMES` (both names) and
   `typeAllowsPartialDay` tests membership. Because both the form and the API guard already
   went through that one helper, no call site changed shape — only the two 400 messages,
   which now list both types. Test coverage extended with an offsite-training case.
2. **Two pre-existing S-09 defects fixed opportunistically** (surfaced during the same
   session, both user-visible in this feature's flow):
   - The zod refine messages in `api/absences/index.ts` and `[id].ts` were developer-facing
     English and reached the user via `toast.error` when start ≥ end. Now Polish.
   - `src/layouts/Layout.astro` declared `<html lang="en">` on a Polish app, and the time
     inputs carried `lang="en-GB"`. Both now `pl`/`pl-PL`. Caveat: Chromium takes the
     12h/24h format from the browser's UI locale and largely ignores these attributes, so
     this corrects document semantics and Firefox but may not clear AM/PM in Chrome.
