---
change_id: employee-management
roadmap_id: S-04
title: "Zarządzanie pracownikami przez moderatora"
status: impl_reviewed
created: 2026-05-31
updated: 2026-05-31
prd_refs:
  - FR-007
prerequisites:
  - F-01
---

## Summary

Moderator może dodawać nowych pracowników (z tworzeniem konta Supabase Auth), edytować ich imię/nazwisko i rolę, usuwać (soft-delete z zachowaniem historycznych wpisów nieobecności) oraz przywracać usuniętych pracowników. Zarządzanie dostępne z poziomu panelu bocznego (Sheet) w dashboardzie.

## Implementation Notes

**Date-aware employee filter (Phase 3)**: Filtr pracowników w siatce sprawdza oba krańce przedziału czasowego:
- `created_at <= firstDayNextMonth` — pracownik istniał przed końcem przeglądanego miesiąca
- `deleted_at IS NULL OR deleted_at >= firstDay` — pracownik nie był usunięty przed początkiem miesiąca

Dzięki temu pracownicy dodani w późniejszych miesiącach nie pojawiają się retroaktywnie w starszych miesiącach.
