-- =============================================================================
-- Post-review fixes (plan-review F1 + F2):
--   F1: Tighten hours CHECK to biconditional (prevents full-day rows with hours)
--   F2: Add moderator-only SELECT policy to expose soft-deleted employees
-- =============================================================================

-- F1: Replace partial CHECK with biconditional enforcement
--     Old: CHECK (is_full_day OR hours IS NOT NULL)
--     New: CHECK ((is_full_day AND hours IS NULL) OR (NOT is_full_day AND hours IS NOT NULL))
ALTER TABLE absences DROP CONSTRAINT IF EXISTS absences_hours_check;
ALTER TABLE absences ADD CONSTRAINT absences_hours_check
  CHECK ((is_full_day AND hours IS NULL) OR (NOT is_full_day AND hours IS NOT NULL));

-- F2: Allow moderators to SELECT all employees including soft-deleted ones
--     (required for S-04 employee management / restoration)
CREATE POLICY "employees_select_moderator_all"
  ON employees FOR SELECT
  USING (get_user_role() = 'moderator');
