ALTER TABLE "employees" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Seed initial display_order from current alphabetical position (0-indexed)
WITH ranked AS (
  SELECT id,
         (row_number() OVER (ORDER BY last_name, first_name) - 1)::integer AS rn
  FROM employees
)
UPDATE employees
SET display_order = ranked.rn
FROM ranked
WHERE employees.id = ranked.id;
