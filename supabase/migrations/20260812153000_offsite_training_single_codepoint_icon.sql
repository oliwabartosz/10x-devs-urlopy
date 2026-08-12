-- =============================================================================
-- Single-codepoint icon for the offsite training type (grid-adjustment-offsite-training p1)
--   Intent: The grid cell is about to lose its type name, leaving the icon as the
--   cell's only type discriminator. The current value is an Emoji 15.1 ZWJ
--   sequence ("person running facing right"); on any font lacking that ligature
--   it decomposes into three or four visible glyphs, which both blurs the signal
--   and adds roughly 26-40px to the widest column. A single codepoint cannot
--   decompose.
--
--   Prior value, recorded verbatim so this is reversible by hand:
--
--     UPDATE absence_types SET icon = '🏃🏼‍♂️‍➡️'
--     WHERE name = 'szkolenie/wyjście poza miejsce pracy';
--
--   That literal is 8 codepoints:
--     U+1F3C3 U+1F3FC U+200D U+2642 U+FE0F U+200D U+27A1 U+FE0F
--   The new value is 1: U+1F3C3.
--
--   Keyed on `name`, matching every prior catalogue migration
--   (20260526000002, 20260722120000, 20260807122840) — ids differ per
--   environment, `name` does not.
--
--   Hand-authored and data-only: drizzle-kit generates DDL, never data, so this
--   file is deliberately NOT registered in supabase/migrations/meta/_journal.json
--   and is applied outside `drizzle-kit migrate`, exactly like
--   20260811120000_purge_demo_partial_day_absences.sql.
--
--   Idempotent in effect — re-running sets the same value. An environment that
--   has not applied it still works; the icon simply renders as multiple glyphs,
--   which is the condition this migration exists to remove.
-- =============================================================================

UPDATE absence_types
SET icon = '🏃'
WHERE name = 'szkolenie/wyjście poza miejsce pracy';
