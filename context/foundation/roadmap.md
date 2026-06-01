---
project: Urlopy
version: 1
status: draft
created: 2026-05-25
updated: 2026-05-31
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: Urlopy

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Zespół wydziałowy (maks. ~10 osób) zarządza urlopami, chorobami, szkoleniami i innymi
nieobecnościami w arkuszu Excel, co powoduje tarcie operacyjne i luki w raportowaniu
miesięcznym. Produkt zastępuje Excel znajomą siatką miesięczną (dni × pracownicy)
z bezpieczną własnością pól: pracownik edytuje tylko swoje wpisy, moderator zarządza
wszystkimi wpisami i pracownikami. Dodatkowa wartość wynika z powiązania ewidencji
z miesięcznymi i rocznymi statystykami dostępnymi bez ręcznego uzgadniania Excela.

## North star

**S-01: pracownik dodaje wpis nieobecności w siatce miesięcznej i widzi go w siatce,
tabeli szczegółów oraz statystykach** — to dosłowne Kryterium Sukcesu PRD (US-01);
jeśli ten flow działa end-to-end, rdzeń produktu jest udowodniony.

> Północna gwiazda to w tym dokumencie: najmniejszy end-to-end flow, który — jeśli
> zostanie dostarczony — udowadnia, że produkt spełnia swoją główną obietnicę.
> Pojawia się jako pierwszy w kolejności, bo wszystko inne ma sens tylko wtedy, gdy
> ten flow działa.

## At a glance

| ID   | Change ID                    | Outcome (użytkownik może …)                                                                                    | Prerequisites | PRD refs                                    | Status   |
| ---- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------- | -------- |
| F-01 | data-schema-and-rls          | (foundation) tabele employees, absences, absence_types z migracjami + polityki RLS dla ról pracownik/moderator | —             | FR-001, FR-002, FR-003, FR-004, FR-007      | done     |
| S-01 | monthly-grid-own-absence     | wybrać miesiąc, zobaczyć siatkę miesięczną (dni × pracownicy z kolorami), dodać/edytować/usunąć własny wpis   | F-01          | FR-001, FR-002, FR-004, US-01               | done     |
| S-02 | details-and-stats            | zobaczyć tabelę szczegółów nieobecności za dany miesiąc i statystyki miesięczne/roczne                         | S-01          | FR-005, FR-006                              | done     |
| S-03 | moderator-absence-management | (moderator) dodawać/edytować/usuwać wpisy nieobecności wszystkich pracowników                                  | S-01, F-01    | FR-003                                      | done     |
| S-04 | employee-management          | (moderator) dodawać i usuwać pracowników bez usuwania historycznych wpisów nieobecności                        | F-01          | FR-007                                      | done     |
| S-05 | drizzle-migration            | (tech) wymienić klienta Supabase JS na Drizzle ORM — typesafe queries, migracje w kodzie                      | S-04          | —                                           | proposed |
| S-06 | details-subcards             | zakładka Szczegóły pokazuje osobne karty: Dzisiaj, Miesięcznie, Rocznie                                       | S-02          | FR-005, FR-006                              | done     |
| S-07 | employee-grid-order          | (moderator) zmiana kolejności kolumn pracowników w siatce miesięcznej przez przeciąganie                      | S-04          | FR-007                                      | proposed |

## Streams

Nawigacyjna pomoc — grupuje pozycje ze wspólnym łańcuchem zależności. Kanoniczny porządek
wciąż żyje w sekcjach Foundations + Slices; ta tabela to proponowana kolejność czytania
przez równoległe tory.

| Stream | Temat                    | Łańcuch                                  | Uwaga                                                                        |
| ------ | ------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------- |
| A      | Rdzeń siatki i ewidencji | `F-01` → `S-01` → `S-02` / `S-03`       | Ścieżka must-have; S-02 i S-03 można realizować równolegle po S-01           |
| B      | Zarządzanie pracownikami | `F-01` → `S-04` → `S-07`                | S-07 wymaga S-04 (kolumna display_order na tabeli employees)                 |
| C      | Post-MVP enhancements    | `S-02` → `S-06` / `S-04` → `S-05`       | S-05, S-06, S-07 można realizować równolegle; S-05 nie blokuje żadnego z nich |

## Baseline

Stan kodu bazowego na `2026-05-25` (auto-zbadany + potwierdzony przez użytkownika).
Foundations poniżej zakładają, że warstwy „OBECNA" są w miejscu i ich nie re-scaffoldują.

- **Frontend:** OBECNA — Astro + React, auth UI, dashboard (`src/components/auth/`, `src/pages/auth/`, `src/pages/dashboard.astro`)
- **Backend/API:** OBECNA — Cloudflare Workers + Astro SSR, 3 trasy API auth, middleware (`src/pages/api/auth/`, `src/middleware.ts`)
- **Data:** CZĘŚCIOWA — klient Supabase skonfigurowany (`src/lib/supabase.ts`), brak migracji, brak schematu tabel aplikacji
- **Auth:** OBECNA — Supabase email/hasło, strony logowania/rejestracji, middleware chroniący trasy (`src/middleware.ts`)
- **Deploy/infra:** OBECNA — `wrangler.jsonc`, GitHub Actions CI/CD (`.github/workflows/ci.yml`), Cloudflare Workers
- **Observability:** BRAK — żaden logger ani error tracking nie jest skonfigurowany

## Foundations

### F-01: Schemat bazy danych i polityki RLS

- **Outcome:** (foundation) tabele `employees` (z polem roli pracownik/moderator, FK na `auth.users`), `absences` (typ, data, godziny/cały_dzień, komentarz, opcjonalny zastępca, FK na employees) i `absence_types` (seed z 6 typami i kolorami hex) z migracjami Supabase oraz politykami RLS: pracownik czyta/edytuje własne wpisy, moderator czyta/edytuje wszystkie, niezalogowany — brak dostępu.
- **Change ID:** data-schema-and-rls
- **PRD refs:** FR-001, FR-002, FR-003, FR-004, FR-007, sekcja Access Control
- **Unlocks:** S-01 (siatka i własny CRUD), S-03 (moderator CRUD), S-04 (zarządzanie pracownikami); redukuje ryzyko naruszeń własnościowych (guardrail: "pracownik nie może edytować wpisów innych")
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Schematy i polityki RLS decydują o bezpieczeństwie całej aplikacji; błąd tutaj przebija się przez wszystkie slices — lepiej zaprojektować je raz dobrze niż refaktorować przy każdym kolejnym slice. Strategia miękkiego usunięcia pracownika (FR-007) musi być zdecydowana tutaj, nie w S-04.
- **Status:** done

## Slices

### S-01: Siatka miesięczna z własnym formularzem wpisu nieobecności

- **Outcome:** pracownik może wybrać miesiąc i rok, zobaczyć siatkę miesięczną (dni jako wiersze, pracownicy jako kolumny, komórki kolorowane wg typu nieobecności), dodać/edytować/usunąć własny wpis nieobecności z typem, godziną/całym dniem, komentarzem i opcjonalnym zastępcą.
- **Change ID:** monthly-grid-own-absence
- **PRD refs:** FR-001, FR-002, FR-004, US-01
- **Prerequisites:** F-01
- **Parallel with:** S-04 (obydwa zależą tylko od F-01, żaden nie blokuje drugiego)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Siatka miesięczna jest najbardziej wizualnie złożonym elementem produktu (responsywność na desktopie, kolory, wybór miesiąca, interaktywny formularz komórki); to główne ryzyko UX w projekcie. Implementować jako najwcześniejszy slice, żeby wykryć problemy z layoutem zanim pozostałe slices na niej polegają.
- **Status:** done

### S-02: Tabela szczegółów i statystyki miesięczne/roczne

- **Outcome:** pracownik może zobaczyć tabelę szczegółów nieobecności za dany miesiąc (typ, osoba, zastępca, godziny, komentarz, data wpisu) oraz statystyki nieobecności miesięczne i roczne.
- **Change ID:** details-and-stats
- **PRD refs:** FR-005, FR-006
- **Prerequisites:** S-01
- **Parallel with:** S-03 (obydwa zależą od S-01, żaden nie blokuje drugiego)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Statystyki roczne wymagają danych z wielu miesięcy — dla weryfikacji MVP może brakować realnych danych; weryfikacja może wymagać ręcznego wprowadzenia seed data. Poza tym slice jest relatywnie prosty (odczyt + agregacja).
- **Status:** done

### S-03: Uprawnienia moderatora — edycja wpisów wszystkich pracowników

- **Outcome:** moderator może dodawać/edytować/usuwać wpisy nieobecności dla wszystkich pracowników w siatce miesięcznej (te same widoki co pracownik, lecz bez ograniczeń własnościowych).
- **Change ID:** moderator-absence-management
- **PRD refs:** FR-003
- **Prerequisites:** S-01, F-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Uprawnienia moderatora są egzekwowane przez polityki RLS z F-01 — jeśli polityki są poprawne, S-03 to głównie zmiana warunkowego renderowania UI; jeśli polityki mają błąd, dane wszystkich pracowników są narażone.
- **Status:** done

### S-04: Zarządzanie pracownikami przez moderatora

- **Outcome:** moderator może dodawać nowych pracowników i usuwać istniejących bez usuwania historycznych wpisów nieobecności (pracownik usunięty pozostaje widoczny w historycznych rekordach).
- **Change ID:** employee-management
- **PRD refs:** FR-007
- **Prerequisites:** F-01
- **Parallel with:** S-01 (obydwa zależą tylko od F-01, żaden nie blokuje drugiego)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** FR-007 wymaga "usunięcia bez usuwania historii" — strategia (pole `is_active`, `deleted_at`, czy FK z `ON DELETE RESTRICT`) musi być zdecydowana w F-01; jeśli schema nie przewidzi tego z góry, S-04 wymagałoby cofającej migracji schematu.
- **Status:** done

### S-05: Migracja Supabase JS → Drizzle ORM

- **Outcome:** (tech) wszystkie zapytania do bazy danych używają Drizzle ORM zamiast klienta Supabase JS — typesafe queries, schemat bazy zdefiniowany w kodzie, migracje zarządzane przez Drizzle Kit. Żadna zmiana widoczna dla użytkownika.
- **Change ID:** drizzle-migration
- **PRD refs:** —
- **Prerequisites:** S-04 (wszystkie slices MVP gotowe — migracja nie blokuje żadnej funkcji)
- **Parallel with:** S-06, S-07
- **Blockers:** —
- **Unknowns:** Drizzle nie wspiera Supabase Auth admin API — `createAdminClient()` (Supabase JS) pozostaje dla operacji auth; tylko zapytania do tabel aplikacji przechodzą na Drizzle.
- **Risk:** Duże ryzyko regresji — każde zapytanie musi być przetestowane. RLS nadal egzekwowane przez Supabase, ale Drizzle omija klienta Supabase JS, więc konfiguracja połączenia z row-level security wymaga weryfikacji (connection string z `?role=authenticated` lub service role).
- **Status:** proposed

### S-06: Zakładka Szczegóły — karty Dzisiaj / Miesięcznie / Rocznie

- **Outcome:** pracownik otwiera zakładkę Szczegóły i widzi trzy osobne karty: "Dzisiaj" (nieobecności na bieżący dzień), "Miesięcznie" (bieżący miesiąc, jak dotychczas), "Rocznie" (agregat za bieżący rok kalendarzowy). Przełączanie kart nie powoduje przeładowania strony.
- **Change ID:** details-subcards
- **PRD refs:** FR-005, FR-006
- **Prerequisites:** S-02
- **Parallel with:** S-05, S-07
- **Blockers:** —
- **Unknowns:** Widok "Rocznie" wymaga danych z wielu miesięcy — dodatkowe zapytanie lub rozszerzenie istniejącego zakresu dat.
- **Risk:** Niskie — rozszerzenie istniejącego komponentu `AbsenceDetailsTable`; brak zmian schematu.
- **Status:** done

### S-07: Moderator — zmiana kolejności pracowników w siatce

- **Outcome:** moderator przeciąga kolumny pracowników w siatce miesięcznej i zmienia ich kolejność; nowa kolejność jest zapisywana i widoczna dla wszystkich użytkowników.
- **Change ID:** employee-grid-order
- **PRD refs:** FR-007
- **Prerequisites:** S-04
- **Parallel with:** S-05, S-06
- **Blockers:** —
- **Unknowns:** Persystencja kolejności — nowa kolumna `display_order` w tabeli `employees` (migracja) lub osobna tabela ustawień. Drag-and-drop w poziomie na siatce z zamrożoną pierwszą kolumną (dni) wymaga weryfikacji z wybraną biblioteką (np. `@dnd-kit/core`).
- **Risk:** Średnie — drag-and-drop na siatce z poziomym scrollem może być złożony UX; warto zprototypować layout przed pełną implementacją.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                    | Sugerowany tytuł issue                                                | Gotowy na `/10x-plan` | Uwagi                                        |
| ---------- | ---------------------------- | --------------------------------------------------------------------- | --------------------- | -------------------------------------------- |
| F-01       | data-schema-and-rls          | [Urlopy] Schemat bazy danych i polityki RLS (employees, absences)     | yes                   | Uruchom `/10x-plan data-schema-and-rls`      |
| S-01       | monthly-grid-own-absence     | [Urlopy] Siatka miesięczna + dodaj/edytuj/usuń własną nieobecność     | no                    | Czeka na F-01                                |
| S-02       | details-and-stats            | [Urlopy] Tabela szczegółów i statystyki miesięczne/roczne             | no                    | Czeka na S-01                                |
| S-03       | moderator-absence-management | [Urlopy] Moderator: edycja wpisów wszystkich pracowników              | no                    | Czeka na S-01                                |
| S-04       | employee-management          | [Urlopy] Moderator: zarządzanie pracownikami (bez usuwania historii)  | no                    | Czeka na F-01; równolegle z S-01             |
| S-05       | drizzle-migration            | [Urlopy] Migracja Supabase JS → Drizzle ORM                          | yes                   | Gotowy po S-04; równolegle z S-06, S-07      |
| S-06       | details-subcards             | [Urlopy] Szczegóły: karty Dzisiaj / Miesięcznie / Rocznie            | yes                   | Gotowy po S-02; równolegle z S-05, S-07      |
| S-07       | employee-grid-order          | [Urlopy] Moderator: zmiana kolejności kolumn pracowników w siatce    | yes                   | Gotowy po S-04; równolegle z S-05, S-06      |

## Open Roadmap Questions

Brak. PRD: "No open questions at this time." Wywiad nie ujawnił żadnych cross-cutting pytań nierozwiązanych.

## Parked

- **FR-008: plan urlopów z oznaczeniem priorytetu** — Why parked: PRD §Non-Goals: nice-to-have, poza głównym MVP flow.
- **Moduł planu urlopów** — Why parked: PRD §Non-Goals: poza zakresem MVP.
- **Złożony workflow zatwierdzania urlopów** — Why parked: PRD §Non-Goals.
- **Integracje zewnętrzne (inne platformy firmowe)** — Why parked: PRD §Non-Goals.
- **Aplikacja natywna mobilna** — Why parked: PRD §Non-Goals; pierwsza wersja web-only.
- **Osobne reguły widoczności statystyk dla pracownika i moderatora** — Why parked: PRD §Non-Goals.
- **Observability (logging, error tracking)** — Why parked: brak wymogu w PRD NFRs; odkłada na post-MVP.

## Done

- **S-02: pracownik może zobaczyć tabelę szczegółów nieobecności za dany miesiąc (typ, osoba, zastępca, godziny, komentarz, data wpisu) oraz statystyki nieobecności miesięczne i roczne.** — Archived 2026-05-30 → `context/archive/2026-05-30-details-and-stats/`. Lesson: —.
- **S-03: moderator może dodawać/edytować/usuwać wpisy nieobecności wszystkich pracowników w siatce miesięcznej (te same widoki co pracownik, lecz bez ograniczeń własnościowych).** — Implemented 2026-05-31 → `context/changes/moderator-absence-management/`. Lesson: prop threading vs. self-contained component lookup (see `context/foundation/lessons.md`).
- **S-06: zakładka Szczegóły pokazuje osobne karty Dzisiaj / Miesięcznie / Rocznie** — Implemented 2026-06-01 → `context/changes/details-subcards/`. Extends GET /api/absences with date-range mode; AbsenceDetailsSubcards island with AbortController lazy-fetch pattern; className + emptyLabel props added to AbsenceDetailsTable.
