-- =============================================================================
-- F-01: Database schema and RLS policies
-- Tables: employees, absence_types, absences
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ENUM
-- ---------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('employee', 'moderator');

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------

CREATE TABLE employees (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role        user_role   NOT NULL,
  first_name  TEXT        NOT NULL,
  last_name   TEXT        NOT NULL,
  deleted_at  TIMESTAMPTZ NULL,         -- NULL = active; soft-delete sets this to NOW()
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- absence_types
-- ---------------------------------------------------------------------------

CREATE TABLE absence_types (
  id    SERIAL  PRIMARY KEY,
  name  TEXT    NOT NULL,
  color TEXT    NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$')
);

-- ---------------------------------------------------------------------------
-- absences
-- ---------------------------------------------------------------------------

CREATE TABLE absences (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             UUID        NOT NULL REFERENCES employees(id),
  absence_type_id         INTEGER     NOT NULL REFERENCES absence_types(id),
  date                    DATE        NOT NULL,
  is_full_day             BOOLEAN     NOT NULL DEFAULT TRUE,
  hours                   NUMERIC(4,2) NULL CHECK (is_full_day OR hours IS NOT NULL),
  comment                 TEXT        NULL,
  substitute_employee_id  UUID        NULL REFERENCES employees(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, date)           -- one absence per employee per day (grid model)
);

-- ---------------------------------------------------------------------------
-- updated_at trigger for absences
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER absences_updated_at
  BEFORE UPDATE ON absences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- Role helper — SECURITY DEFINER bypasses employees RLS to avoid recursion
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------

ALTER TABLE employees     ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences      ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS policies: employees
-- ---------------------------------------------------------------------------

-- Any authenticated user reads active employees (needed for grid column headers)
CREATE POLICY "employees_select_authenticated"
  ON employees FOR SELECT
  USING (auth.uid() IS NOT NULL AND deleted_at IS NULL);

-- Only moderators can add employees
CREATE POLICY "employees_insert_moderator"
  ON employees FOR INSERT
  WITH CHECK (get_user_role() = 'moderator');

-- Only moderators can update employees (including soft-delete via deleted_at)
CREATE POLICY "employees_update_moderator"
  ON employees FOR UPDATE
  USING (get_user_role() = 'moderator');

-- No DELETE policy — hard deletes are blocked by omission; use soft-delete instead

-- ---------------------------------------------------------------------------
-- RLS policies: absence_types
-- ---------------------------------------------------------------------------

-- Any authenticated user reads absence types (needed for absence entry form)
CREATE POLICY "absence_types_select_authenticated"
  ON absence_types FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- No INSERT/UPDATE/DELETE policies — static seed, no UI CRUD

-- ---------------------------------------------------------------------------
-- RLS policies: absences
-- ---------------------------------------------------------------------------

CREATE POLICY "absences_select"
  ON absences FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL
    )
    OR get_user_role() = 'moderator'
  );

CREATE POLICY "absences_insert"
  ON absences FOR INSERT
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL
    )
    OR get_user_role() = 'moderator'
  );

CREATE POLICY "absences_update"
  ON absences FOR UPDATE
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL
    )
    OR get_user_role() = 'moderator'
  );

CREATE POLICY "absences_delete"
  ON absences FOR DELETE
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid() AND deleted_at IS NULL
    )
    OR get_user_role() = 'moderator'
  );
