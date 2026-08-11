-- =============================================================================
-- Purge two demo partial-day absences (absence-hours-window)
--   Intent: Remove the only two live rows that violate the new partial-day
--   bounds (start >= 06:00, duration <= 8 h). Both are hand-entered
--   reproductions of design-mockup fixtures from
--   `new-design/10xUrlopy.dc.html:646,652` — they are not real absences.
--
--   2026-06-12  01:14-06:14  (5 h)  — starts before the 06:00 floor
--   2026-06-01  01:22-03:22  (2 h)  — starts before the floor AND carries
--                                     "wyjazd zagraniczny", a type
--                                     `src/lib/absence-types.ts` has never
--                                     permitted as partial-day. Both rows
--                                     predate the partial-day type guard.
--
--   The six surviving partial-day rows already comply, so no backfill and no
--   grandfathering is needed. The application clamps rather than rejects, so
--   an un-purged copy of these rows in another environment stays editable —
--   this DELETE is a cleanup, not a prerequisite.
--
--   Predicate: keyed on the exact date, both exact time values and
--   NOT is_full_day, so it can only ever match these two rows. Deliberately
--   NOT a range expression (`start_time < '06:00'`) and not keyed on the row
--   ids, which differ per environment.
--
--   Not reversible by drizzle-kit, but the rows are recorded here in full so the
--   DELETE can be undone by hand if it ever needs to be. Both carried no comment
--   and no substitute, and both belong to the same employee:
--
--     INSERT INTO absences
--       (id, employee_id, absence_type_id, date, is_full_day, start_time, end_time)
--     VALUES
--       ('34552099-52bf-4a61-9f48-df5d70254aaf',
--        '9ffe41cd-e7cd-449a-990d-8fcd6253880a', 3, DATE '2026-06-12', false,
--        TIME '01:14:00', TIME '06:14:00'),
--       ('07e1a0fd-d2e6-4554-9ad9-a2503b3120df',
--        '9ffe41cd-e7cd-449a-990d-8fcd6253880a', 1, DATE '2026-06-01', false,
--        TIME '01:22:00', TIME '03:22:00');
--
--   (type 3 = "szkolenie w miejscu pracy", type 1 = "wyjazd zagraniczny")
-- =============================================================================

DELETE FROM absences
WHERE NOT is_full_day
  AND (
    (date = DATE '2026-06-12' AND start_time = TIME '01:14:00' AND end_time = TIME '06:14:00')
    OR
    (date = DATE '2026-06-01' AND start_time = TIME '01:22:00' AND end_time = TIME '03:22:00')
  );
