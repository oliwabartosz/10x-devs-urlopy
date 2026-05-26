-- =============================================================================
-- F-01: Seed canonical absence types (PRD Business Logic section)
-- =============================================================================

INSERT INTO absence_types (name, color) VALUES
  ('wyjazd zagraniczny',                    '#2f578c'),
  ('szkolenie/wyjście poza miejsce pracy',  '#10bbef'),
  ('szkolenie w miejscu pracy',             '#ffcc00'),
  ('urlop',                                 '#58873e'),
  ('choroba',                               '#e50040'),
  ('stała nieobecność',                     '#6f6f6f');
