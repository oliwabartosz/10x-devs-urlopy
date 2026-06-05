-- Replace hours column with start_time and end_time TIME columns.
-- Biconditional CHECK mirrors the pattern from 20260527000001.
-- No data conversion needed — no partial-day absence data exists.

ALTER TABLE absences DROP CONSTRAINT IF EXISTS absences_hours_check;
ALTER TABLE absences DROP COLUMN IF EXISTS hours;

ALTER TABLE absences
  ADD COLUMN start_time TIME WITHOUT TIME ZONE,
  ADD COLUMN end_time   TIME WITHOUT TIME ZONE;

ALTER TABLE absences ADD CONSTRAINT absences_time_check
  CHECK (
    (is_full_day AND start_time IS NULL AND end_time IS NULL)
    OR
    (NOT is_full_day AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  );
