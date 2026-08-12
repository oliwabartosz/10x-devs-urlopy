---
change_id: grid-adjustment-offsite-training
title: Bound the grid's column width and drop the type name from the cell
status: implementing
created: 2026-08-11
updated: 2026-08-12
archived_at: null
---

## Notes

Grid is to wide when user sets szkolenie/wyjście poza miejsce pracy HH:MM -> it should be szkolenie/wyjście \n poza NBP \n HH:MM

2026-08-12 — scope widened to **all seven absence types**, not just offsite training. The follow-up
audit in `research.md` shows four of seven types breach the 120px column floor with no `HH:MM` at all,
and that the employee-name header — not the chip — sets the width of five of seven columns. The title
was retitled the same day from "Wrap the offsite/training label so the grid stops widening" to match
the research's recommendation: drop the type name from the cell (prototype parity, option A) **and**
bound the table structurally (option D), which is the only lever that also bounds the header. The
originally requested three-line wrap (option C) and a DB rename (option E) were both rejected — see
`research.md` follow-up section. The change-id stays `grid-adjustment-offsite-training`.
