-- Fix absences SELECT policy: allow all authenticated users to read all absences.
-- The previous policy restricted employees to their own rows only, which breaks
-- the team grid (days × employees colored by absence type) — other employees'
-- cells would always be empty. INSERT/UPDATE/DELETE remain own-only.
DROP POLICY IF EXISTS "absences_select" ON absences;

CREATE POLICY "absences_select"
  ON absences FOR SELECT
  USING (auth.uid() IS NOT NULL);
