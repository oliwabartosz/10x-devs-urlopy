-- =============================================================================
-- S-13: Seed "urlop planowany" absence type (PRD FR-001/FR-002)
--
-- Idempotent: absence_types.name has no unique constraint, so guard with
-- WHERE NOT EXISTS to avoid duplicating the row on re-apply or against a test
-- DB where the S-15 suite already seeded this name.
-- =============================================================================

INSERT INTO absence_types (name, color)
SELECT 'urlop planowany', '#7c3aed'
WHERE NOT EXISTS (
  SELECT 1 FROM absence_types WHERE name = 'urlop planowany'
);
