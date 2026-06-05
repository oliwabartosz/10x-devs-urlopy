-- =============================================================================
-- Replace absence duration with start/end time range (absence-hours-range)
--   Intent: Swap hours NUMERIC column for start_time/end_time TIME columns.
--   Old: hours NUMERIC(4,2) nullable; CHECK (biconditional on is_full_day)
--   New: start_time/end_time TIME WITHOUT TIME ZONE; CHECK absences_time_check
--   Data conversion: partial-day rows are converted using 09:00 as start_time;
--   end_time is derived as 09:00 + hours (e.g. hours=2 → 09:00–11:00).
-- =============================================================================

ALTER TABLE absences DROP CONSTRAINT IF EXISTS absences_hours_check;

ALTER TABLE absences
  ADD COLUMN start_time TIME WITHOUT TIME ZONE,
  ADD COLUMN end_time   TIME WITHOUT TIME ZONE;

-- Convert existing partial-day rows: anchor start at 09:00, derive end from hours.
UPDATE absences
SET
  start_time = '09:00:00'::TIME,
  end_time   = ('09:00:00'::TIME + (hours * INTERVAL '1 hour'))
WHERE NOT is_full_day AND hours IS NOT NULL;

ALTER TABLE absences DROP COLUMN IF EXISTS hours;

ALTER TABLE absences ADD CONSTRAINT absences_time_check
  CHECK (
    (is_full_day AND start_time IS NULL AND end_time IS NULL)
    OR
    (NOT is_full_day AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  );
