# Poranny digest statusu projektu — Plan Brief

> Full plan: `context/changes/team-status-digest/plan.md`
> Research: `context/changes/team-status-digest/research.md`

## What & Why

Budujemy cienki, **read-only** helper CLI (`npm run digest`), który godzi rozproszone źródła stanu projektu — `change.md`, `roadmap.md`, `git log`, opcjonalnie GitHub Actions i Sentry — w jeden datowany raport Markdown. Motywacja (M5L1 „AI Internal Builders", kandydat #1 z opportunity-map): solo-developer gubi status zmian rozsianych po wielu miejscach; digest wyłapuje, co się ruszyło, co stoi i gdzie deklaracje rozjeżdżają się z rzeczywistością — **uzupełniając, nie zastępując** GitHub/Linear/CI.

## Starting Point

Brak jakiegokolwiek narzędzia digestu — to pierwszy internal-builder w repo. Jedyny istniejący standalone-skrypt, `scripts/seed-admin.ts`, ustanawia wzorzec ESM/`tsx`/env/exit do skopiowania. Trzy lokalne źródła są wiarygodne, ale frontmatter jest niespójny (`change_id` vs `id`) a pole `updated:` bywa nieaktualne — dlatego git jest kanoniczny dla „ruchu".

## Desired End State

Developer uruchamia `npm run digest` i dostaje `context/team/digests/RRRR-MM-DD.md` z sekcjami: co się zmieniło od wczoraj, zmiany w toku posortowane wg dni bez ruchu, rozjazdy (git↔frontmatter + mirror-drift), 1–3 pytania decyzyjne, status CI + błędy Sentry, oraz lista plików, których nie udało się sparsować. Raport linkuje do źródeł i nie jest nowym źródłem prawdy.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Sygnał „ruchu" | `git log -- <folder>`, nie `updated:` | Frontmatter `updated` bywa równy `created` — niewiarygodny | Research |
| Reguła „utknięcia" | Sortowanie wg dni bez ruchu, **bez progu** | Jedna liczba nie pasuje do aktywnych i backlogu; sort wypycha najstarsze | Plan |
| „Decyzje na dziś" | Pytania wyprowadzone z reguł (deterministyczne) | Skrypt nie ma LLM; przekuwa fakty w pytania, nie wymyśla odpowiedzi | Plan |
| Sygnały zewnętrzne | GitHub Actions **+** Sentry (Faza C, opcjonalna) | Pełniejszy obraz „co się psuje"; graceful degradation gdy brak tokena | Plan |
| Lokalizacja raportu | Datowane pliki `context/team/digests/`, w `.gitignore` | Archiwum na dysku bez szumu w diffach; digest to stan pochodny | Plan |
| Błędy parsowania | Pomiń i ostrzeż (sekcja ⚠️) | Read-only — częściowy raport lepszy niż żaden; lista błędów to sygnał higieny | Plan |

## Scope

**In scope:** skrypt `scripts/team-digest.ts` (`tsx`, zero nowych zależności), parser frontmatteru + `git log` + roadmap, 6 sekcji raportu, npm-script `digest`, opcjonalne GitHub Actions + Sentry, wpis `.gitignore`.

**Out of scope:** panel/UI, logowanie, baza, cron/harmonogram, dwukierunkowy sync, stan między biegami, próg „utknięcia", wywołanie LLM w skrypcie, commitowanie digestów, nowe zależności npm.

## Architecture / Approach

Pojedynczy skrypt Node/`tsx` (wzór: `seed-admin.ts`), uruchamiany ręcznie. Czyta lokalne pliki przez `fs.globSync` + ręczny parser walidowany `zod`, ruch przez `execFileSync("git", …)`, sygnały zewnętrzne przez `gh` CLI i `fetch` do Sentry. Składa sekcje w string i zapisuje przez `fs.writeFileSync`. **Nie** importuje `@/lib`/`@/db` (czytają `astro:env/server`, działają tylko w Workerze). Wszystkie wywołania zewnętrzne łapią błędy → „niedostępne", digest zawsze powstaje.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| A. Mock-first | Ręczny `digests/<dziś>.md` na realnych danych — kontrakt kształtu | Mock rozjedzie się ze stanem repo przed Fazą B |
| B. Skrypt lokalny | `team-digest.ts` + `npm run digest`, 4 rdzeniowe sekcje | Niespójny frontmatter; poprawne liczenie dni bez ruchu z git |
| C. Sygnały zewnętrzne | Sekcja CI (gh) + Błędy (Sentry), graceful degradation | Sentry wymaga `SENTRY_AUTH_TOKEN` lokalnie; obsługa awarii sieci |

**Prerequisites:** Node 24 (`fs.globSync`), `tsx` + `zod` (są), `gh` zalogowany (jest); dla Sentry opcjonalny `SENTRY_AUTH_TOKEN`.
**Estimated effort:** ~2–3 sesje (A krótka, B główna, C opcjonalna).

## Open Risks & Assumptions

- Mapowanie scope commita → change-id zakłada dyscyplinę Conventional Commits (research potwierdza wzorzec, ale wyjątki możliwe).
- Sekcja „rozjazdy git↔frontmatter" wymaga zdefiniowania, co dokładnie liczymy jako rozbieżność — doprecyzowane w Fazie B na realnych danych.
- `SENTRY_AUTH_TOKEN` nie jest dziś w lokalnym `.env`; bez niego Faza C działa w trybie zdegradowanym (świadomie).

## Success Criteria (Summary)

- `npm run digest` tworzy datowany raport bez wyjątku, kształtem zgodny z mockiem Fazy A.
- Uszkodzony `change.md` ląduje w sekcji ⚠️, a digest i tak powstaje (skip-and-warn).
- Sekcje CI/Błędy pokazują realne dane gdy `gh`/token dostępne, „niedostępne" gdy nie — bez wywracania biegu.
