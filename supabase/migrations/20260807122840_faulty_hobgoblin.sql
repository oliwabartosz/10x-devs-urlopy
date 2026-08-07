ALTER TABLE "absence_types" ADD COLUMN "icon" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "absence_types" ADD COLUMN "text_color" text DEFAULT '#000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "absence_types" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- =============================================================================
-- S-17: adopt the new-design catalogue on the seven seeded absence types.
--
-- Hand-authored: drizzle-kit generates the ADD COLUMNs above but never the data.
-- Columns must exist before these run, hence the order.
--
-- The live `absence_types_color_check` (color ~ '^#[0-9a-fA-F]{6}$', auto-named by
-- Postgres at table creation) is invisible to drizzle-kit and survives ADD COLUMN
-- untouched. Do NOT re-add it — ADD CONSTRAINT would abort with "already exists".
-- Every colour below is a valid six-digit hex, so the check passes throughout.
--
-- Prior palette is recoverable from 20260526000002_seed_absence_types.sql and
-- 20260722120000_seed_urlop_planowany_type.sql.
-- Source: new-design/10xUrlopy.dc.html:599-607
-- =============================================================================
UPDATE absence_types SET
  color         = '#cceeff',
  text_color    = '#0b5a72',
  icon          = '🌴',
  display_order = 1
WHERE name = 'urlop';

UPDATE absence_types SET
  color         = '#ffcc99',
  text_color    = '#8a4a00',
  icon          = '🏃🏼‍♂️‍➡️',
  display_order = 2
WHERE name = 'szkolenie/wyjście poza miejsce pracy';

UPDATE absence_types SET
  color         = '#ffe8a8',
  text_color    = '#7a5b00',
  icon          = '🎓',
  display_order = 3
WHERE name = 'szkolenie w miejscu pracy';

UPDATE absence_types SET
  color         = '#2f578c',
  text_color    = '#ffffff',
  icon          = '🤒',
  display_order = 4
WHERE name = 'choroba';

UPDATE absence_types SET
  color         = '#f2a3a3',
  text_color    = '#7d0d1c',
  icon          = '🌍',
  display_order = 5
WHERE name = 'wyjazd zagraniczny';

UPDATE absence_types SET
  color         = '#ccffcc',
  text_color    = '#2c5c2c',
  icon          = '🚫',
  display_order = 6
WHERE name = 'stała nieobecność';

UPDATE absence_types SET
  color         = '#99ccff',
  text_color    = '#0b3f6b',
  icon          = '📅',
  display_order = 7
WHERE name = 'urlop planowany';
