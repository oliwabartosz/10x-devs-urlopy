---
change_id: team-status-digest
title: Poranny digest statusu projektu (cienki helper M5L1)
status: impl_reviewed
created: 2026-06-29
updated: 2026-06-29
archived_at: null
---

## Notes

Read-only helper *uzupełniający* (nie zamiennik) godzący rozproszone źródła stanu projektu w jeden raport Markdown. Realizacja lekcji M5L1 „AI Internal Builders" — pierwsza użyteczna wersja (mock-first → skrypt tsx).

Artefakty wejściowe:
- `context/foundation/opportunity-map.md` (rekomendowany kandydat #1)
- `context/team/mom-test-validation.md` (walidacja + kryteria go/no-go)

Zakres pierwszej wersji:
- **Czyta**: `context/changes/*/change.md` (status, data), `context/foundation/roadmap.md`, `git log` (zmiany od wczoraj); opcjonalnie GitHub Actions i Sentry przez MCP.
- **Zwraca**: `digest.md` z sekcjami „co się zmieniło", „co utknęło (status X od N dni)", „rozjazdy (mirror-docs 5 vs 18; CI vs lokalnie)", „1–3 decyzje na dziś", z linkami do źródeł.
- **Nie robi**: brak panelu, logowania, bazy, harmonogramu, dwukierunkowego synca; nie zastępuje GitHub/Linear/CI.
- **Plan techniczny**: faza A mock-first (`digest.md` z przykładów), faza B skrypt `scripts/team-digest.ts` (wzór: `scripts/seed-admin.ts`) + npm script `digest`, faza C opcjonalnie wzbogacenie o GitHub Actions/Sentry przez MCP.
- **Ryzyko danych**: lokalne / read-only / niewrażliwe.
