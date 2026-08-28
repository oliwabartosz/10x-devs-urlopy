---
change_id: small-stats-ui-improvment
title: Split absence-type breakdown into year and month views; rename Sign out to Wyloguj
status: archived
created: 2026-08-24
updated: 2026-08-25
archived_at: 2026-08-25T12:10:02Z
---

## Notes

Podział według typu niebeności in stats should be splitted to 1) chosen year 2) chosen month. Secondly Sign out link should be called Wyloguj (in Polish)

## Adaptation (2026-08-25, during Phase 1)

Manual verification of the first Phase 1 build showed the two stacked breakdown cards read as
scroll, not comparison. Changed on the user's instruction to **one card with a `Rok | Miesiąc`
segmented toggle, `Rok` default** — reusing the dashboard tab bar's pill idiom
(`src/pages/dashboard.astro:229-232`) one size down inside the card header.

This deliberately overrides the plan's "**Not** adding a year/month toggle, a period picker, or a
collapse control" exclusion. Side effect: the plan's "two loading lines on screen" open risk is
gone — only the selected side renders, so `Ładowanie statystyk rocznych…` appears once at most.
`YearlyFetchSlot` keeps its two consumers (the card's year side, the yearly matrix).
