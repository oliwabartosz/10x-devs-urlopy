-- Enable RLS on holiday_balances (defense-in-depth baseline).
--
-- The app path uses a service-role pooler that BYPASSES RLS — all runtime authz
-- lives in handler code (src/pages/api/holiday-balances/*). These policies exist
-- so the table is not the lone exception to the repo's RLS convention (every other
-- table enables RLS in 20260526000001_schema.sql), guarding the case where an
-- anon/authenticated key ever reaches this table.
--
-- Design mirror: "both employees and moderators can read/edit/delete ANY balance"
-- (the routes carry no owner/role gate). SELECT is open to any authenticated user
-- (matching the absences_select fix in 20260529000001); writes/deletes require the
-- caller to be a non-deleted employee — the DB equivalent of the handler's
-- valid-caller (403) guard.

ALTER TABLE holiday_balances ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may read any balance (matches the GET endpoint, which lets
-- any valid caller read any employee's balance — same model as absences).
CREATE POLICY "holiday_balances_select"
  ON holiday_balances FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Writes/deletes: any non-deleted employee (both roles), no owner gate.
CREATE POLICY "holiday_balances_insert"
  ON holiday_balances FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

CREATE POLICY "holiday_balances_update"
  ON holiday_balances FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

CREATE POLICY "holiday_balances_delete"
  ON holiday_balances FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );
