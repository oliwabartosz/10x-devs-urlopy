---
change_id: export-grid-to-xlsx
title: Moderator XLSX export of the yearly absence grid, one sheet per month
status: archived
created: 2026-08-24
updated: 2026-08-25
archived_at: 2026-08-25T11:28:23Z
---

## Notes

I want that moderator can download the whole updated grid from current year to get in xlsx - with colors and text. He or she could select just the year. In output (xlsx) each month should be separate tab (sheet or whatever they called it).

## Palette provenance — a live trap when verifying the export

`20260807122840_faulty_hobgoblin.sql` and `20260812153000_offsite_training_single_codepoint_icon.sql`
are hand-authored data migrations, deliberately absent from `supabase/migrations/meta/_journal.json`.
A freshly provisioned environment therefore carries the superseded 2026-05 palette, and an export
taken there is faithful to the **wrong** colours — the file is correct, the database is not.
Compare exported fills against the colours the migration above sets, never against a fresh seed.

`context/foundation/prd.md:112` also still lists the stale ZWJ offsite-training icon. The database
is authoritative for both colour and icon.

`scripts/export-sample.ts` hard-copies the live palette for exactly this reason: the sample is
meant to show what a moderator actually sees, not what a fresh environment happens to hold.
