---
project: Urlopy
version: 1
status: draft
created: 2026-05-25
updated: 2026-08-17
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
| S-05 | drizzle-migration            | (tech) wymienić klienta Supabase JS na Drizzle ORM — typesafe queries, migracje w kodzie                      | S-04          | —                                           | done     |
| S-06 | details-subcards             | zakładka Szczegóły pokazuje osobne karty: Dzisiaj, Miesięcznie, Rocznie                                       | S-02          | FR-005, FR-006                              | done     |
| S-07 | employee-grid-order          | (moderator) zmiana kolejności kolumn pracowników w siatce miesięcznej przez przeciąganie                      | S-04          | FR-007                                      | done     |
| S-08 | deactivated-employee-grid    | (bugfix) siatka miesięczna pokazuje historyczne nieobecności zdezaktywowanych pracowników                     | S-03, S-04    | FR-003, FR-007                              | done     |
| S-09 | absence-hours-range          | (UX) użytkownik widzi zakres godzin (np. "12:00–14:00") dla nieobecności niepełnodniowych w siatce i szczegółach | S-01       | FR-004, US-01                               | done     |
| S-10 | dev-vars-rename              | (tech) jeden plik `.env` dla Node tooling i Cloudflare local dev — wrangler czyta `.env` natywnie             | —             | —                                           | done     |
| S-11 | admin-bootstrap              | (tech/auth) konto admin tworzone z .env/.env.dev; brak samorejestracji — tylko moderatorzy dodają użytkowników; admin niewidoczny w siatce/szczegółach/liście pracowników i niesuwalny przez innych moderatorów | F-01, S-04 | FR-007 | done     |
| S-12 | sentry-integration           | (tech) Sentry SDK wdrożone dla Cloudflare Workers — automatyczne raportowanie błędów runtime, source maps, alerting; zera ręcznego triage logów po incydentach produkcyjnych                                     | —          | —      | done     |
| S-13 | urlop-planowany-category     | wybrać nową kategorię nieobecności "urlop planowany" z listy typów przy dodawaniu/edycji wpisu — widoczną w siatce i szczegółach z własnym kolorem                                                              | F-01       | FR-001, FR-002 | done |
| S-14 | hours-onsite-training-only   | przy dodawaniu/edycji wpisu pole godzin (zakres czasu) jest dostępne wyłącznie dla kategorii "szkolenie w miejscu pracy"; pozostałe kategorie pozostają całodniowe                                              | S-09       | FR-004         | done     |
| S-15 | urlop-balance                | (pracownik) wpisać wymiar urlopu z systemu kadrowego (bieżący + zaległy) i widzieć ile dni urlopu zostało — aplikacja zlicza wykorzystane wpisy "urlop" i pokazuje saldo na karcie dashboardu, per rok          | F-01       | FR-005, FR-006 | done     |
| S-16 | main-page-redesign           | (tech/UX) zalogować się z nowej, jasnej strony logowania na `/` (branding NBP „Nieobecności") zamiast startowego szablonu; zalogowany użytkownik trafia od razu do `/dashboard`                                 | —          | —              | done     |
| S-17 | huge-ui-ux-improvement       | (UX) korzystać z całego dashboardu w jednym języku wizualnym marki NBP — warstwa design-tokenów, przeprojektowane karty, siatka, filtry typów; koniec trzech współistniejących motywów                          | S-16       | FR-001, FR-002, FR-005 | done |
| S-18 | absence-hours-window         | zakres godzin nieobecności niepełnodniowej jest ograniczony (maks. 8 h, start ≥ 06:00) i korygowany zarówno w formularzu, jak i po stronie API                                                                  | S-09, S-14 | FR-004         | review pending |
| S-19 | radial-timepicker-ux         | wybrać godziny nieobecności na tarczy zegara w skoku 15 min i zobaczyć komunikat o korekcie zamiast cichego przycięcia wartości                                                                                 | S-18       | FR-004         | done |
| S-20 | grid-adjustment-offsite-training | siatka mieści ~10 pracowników — komórka pokazuje ikonę + zakres godzin (nazwa typu w legendzie i tooltipie), a szerokości kolumn są związane `table-fixed`                                                  | S-17       | FR-001, FR-002 | done |
| S-21 | grid-multicheck              | zaznaczyć wielodniową nieobecność jednym przeciągnięciem myszy po siatce, z pominięciem nieklikalnych weekendów                                                                                                 | S-17       | FR-001, FR-004 | planned  |
| S-22 | workers-data-edit            | (moderator) zmienić e-mail pracownika oraz wymiar urlopu (bieżący / zaległy / korekta); pracownik zmienia własne hasło z poziomu swojego e-maila w topbarze                                                     | S-04, S-15 | FR-005, FR-007 | planned  |

Legenda statusów: `done` = zaimplementowane i po impl-review · `review pending` =
zaimplementowane, czeka na `/10x-impl-review` przed archiwizacją · `in progress` =
w trakcie implementacji · `planned` = folder zmiany otwarty, brak planu.

## Streams

Nawigacyjna pomoc — grupuje pozycje ze wspólnym łańcuchem zależności. Kanoniczny porządek
wciąż żyje w sekcjach Foundations + Slices; ta tabela to proponowana kolejność czytania
przez równoległe tory.

| Stream | Temat                    | Łańcuch                                  | Uwaga                                                                        |
| ------ | ------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------- |
| A      | Rdzeń siatki i ewidencji | `F-01` → `S-01` → `S-02` / `S-03` / `S-09` | Ścieżka must-have; S-02, S-03 i S-09 można realizować równolegle po S-01  |
| B      | Zarządzanie pracownikami | `F-01` → `S-04` → `S-07`                | S-07 wymaga S-04 (kolumna display_order na tabeli employees)                 |
| C      | Post-MVP enhancements    | `S-02` → `S-06` / `S-04` → `S-05`       | S-05, S-06, S-07 można realizować równolegle; S-05 nie blokuje żadnego z nich |
| D      | Bugfixy integralności    | `S-03` + `S-04` → `S-08`                | Bug odkryty podczas S-03; wymaga S-04 (is_active/deleted_at na employees)    |
| E      | Redesign i dopracowanie UX | `S-16` → `S-17` → `S-20` / `S-21`     | S-17 wprowadza tokeny i ikony; S-20 i S-21 to jego świadome carve-outy      |
| F      | Godziny nieobecności     | `S-09` → `S-14` → `S-18` → `S-19`       | Kolejne zawężenia tej samej reguły; S-19 dokłada kontrolkę i feedback       |

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
- **Status:** done

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

### S-08: Siatka miesięczna — historyczne nieobecności zdezaktywowanych pracowników

- **Outcome:** moderator widzi w siatce miesięcznej historyczne nieobecności pracowników, których konto zostało zdezaktywowane — wpisy nie znikają po dezaktywacji konta.
- **Change ID:** deactivated-employee-grid
- **PRD refs:** FR-003, FR-007
- **Prerequisites:** S-03 (moderator grid), S-04 (employee deactivation logic)
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:** Czy kolumna zdezaktywowanego pracownika powinna pozostać widoczna (ze wskaźnikiem nieaktywności), czy być ukryta dla nowych miesięcy, ale widoczna dla historycznych? Wymaga decyzji UX przed implementacją.
- **Risk:** Niskie — prawdopodobnie zmiana filtra zapytania grid z `is_active = true` na `is_active = true OR has_absences_in_month`; nie wymaga zmian schematu jeśli F-01 już ma `is_active`.
- **Status:** done

### S-09: Nieobecności — widok zakresu godzin w siatce i szczegółach

- **Outcome:** użytkownik widzi zakres godzin (np. "12:00–14:00") dla nieobecności niepełnodniowych w siatce miesięcznej i tabeli szczegółów; formularz umożliwia wprowadzenie godziny rozpoczęcia i zakończenia zamiast liczby godzin.
- **Change ID:** absence-hours-range
- **PRD refs:** FR-004, US-01
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Niskie — zmiana schematu (`hours` → `start_time`/`end_time`) jest czystym swap'em; brak danych produkcyjnych dla nieobecności niepełnodniowych eliminuje konieczność migracji danych.
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
- **Status:** done

### S-10: Konsolidacja środowisk lokalnych do jednego pliku .env

- **Outcome:** (tech) Jeden plik `.env` (gitignored) pokrywa zarówno Node tooling jak i Cloudflare local dev — wrangler czyta `.env` natywnie, zbędny drugi plik wyeliminowany. Żadna zmiana widoczna dla użytkownika.
- **Change ID:** dev-vars-rename
- **PRD refs:** —
- **Prerequisites:** —
- **Parallel with:** wszystkie slices
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Niskie — zrealizowane.
- **Status:** done

### S-12: Integracja Sentry — error tracking i debugging

- **Outcome:** (tech) Sentry SDK (`@sentry/cloudflare`) wdrożone w aplikacji Cloudflare Workers — nieobsłużone wyjątki i odrzucone Promise'y są automatycznie raportowane do Sentry z pełnym stack trace'em i source mapami. Deweloper może debugować błędy produkcyjne bez ręcznego przeszukiwania `wrangler tail`. Opcjonalnie: alerty Sentry na Slack/e-mail przy nowych błędach.
- **Change ID:** sentry-integration
- **PRD refs:** —
- **Prerequisites:** —
- **Parallel with:** S-10, S-11
- **Blockers:** —
- **Unknowns:**
  - Sentry DSN jako sekret Wranglera (`wrangler secret put SENTRY_DSN`) vs. zmienna env w `wrangler.jsonc` — DSN nie jest wrażliwy (public), ale konwencja projektu do ustalenia.
  - Source maps: `@sentry/astro` może generować i uploadować source mapy automatycznie podczas `npm run build` (wymaga `SENTRY_AUTH_TOKEN` w CI), albo upload ręczny/pominięty dla MVP.
  - Czy Sentry ma mieć wgląd w requesty i cookies (PII)? Wymaga konfiguracji `sendDefaultPii` i ewentualnej `beforeSend` scrub funkcji ze względu na RODO.
- **Risk:** Niskie — Sentry SDK dla Cloudflare Workers jest dojrzały; instrumentacja przez `withSentry` wrapper w `src/middleware.ts` lub `src/pages/api/` jest addytywna i nie zmienia logiki biznesowej. Ryzyko wycieku PII w breadcrumbach/requestach jeśli `sendDefaultPii: true` bez scrubowania.
- **Status:** done

### S-11: Bootstrap konta admin z plików env

- **Outcome:** (tech/auth) pierwsze konto admina (rola: moderator) jest tworzone automatycznie z danych w `.env` / `.env.dev` (e-mail + hasło) przy starcie lub przez jednorazowy skrypt seed — bez potrzeby ręcznej rejestracji. Po wdrożeniu S-11 samorejestracja jest wyłączona: nowych użytkowników (pracowników i moderatorów) mogą dodawać wyłącznie moderatorzy. Konto admin jest kontem technicznym: niewidoczne w siatce miesięcznej, tabeli szczegółów i liście pracowników; nie może być usunięte przez innych moderatorów.
- **Change ID:** admin-bootstrap
- **PRD refs:** FR-007
- **Prerequisites:** F-01 (schemat auth/employees + RLS), S-04 (logika zarządzania pracownikami)
- **Parallel with:** S-10
- **Blockers:** —
- **Unknowns:**
  - Mechanizm seedowania: migracja SQL (Supabase `auth.users` insert przez service role) vs. jednorazowy skrypt Node/CLI vs. endpoint `/api/seed` zabezpieczony tokenem z env — trzeba wybrać przed implementacją.
  - Wyłączenie samorejestracji: czy blokować na poziomie RLS/Supabase Auth settings (wyłączyć "Enable email signup"), czy przez middleware Astro, czy przez ukrycie formularza + walidację po stronie API? Supabase Auth settings to najprostszy toggle, ale wymaga zmiany konfiguracji projektu Supabase poza migracją SQL.
  - Jak moderatorzy będą dodawać nowych użytkowników bez samorejestracji? S-04 implementuje dodawanie pracowników, ale zakłada, że użytkownik `auth.users` już istnieje (FK). Tworzenie konta auth + rekordu employee w jednej operacji (Supabase Admin API) musi być obsłużone — może wymagać rozszerzenia S-04 lub nowego slice.
  - Czy admin powinien być w tabeli `employees` (z flagą `is_system = true` lub `is_hidden = true`), czy w ogóle poza tą tabelą? Decyzja wpływa na RLS i zapytania grid.
- **Risk:** Średnie — wyłączenie samorejestracji jest nieodwracalne dla użytkowników w produkcji; błąd w seedzie blokuje cały onboarding. Mechanizm tworzenia użytkowników przez moderatora (Supabase Admin API po stronie serwera) wymaga service role key — musi pozostać wyłącznie po stronie API, nigdy nie wyciekać do klienta. Jeśli admin jest w tabeli `employees`, każde zapytanie grid/details musi go filtrować — ryzyko pominięcia filtra w nowym kodzie.
- **Status:** done

### S-13: Nowa kategoria nieobecności — "urlop planowany"

- **Outcome:** użytkownik wybiera nowy typ nieobecności "urlop planowany" z listy kategorii w formularzu dodawania/edycji wpisu; typ jest widoczny w siatce miesięcznej i tabeli szczegółów z własnym, odróżnialnym kolorem — tak jak istniejące kategorie (`urlop`, `choroba`, itd.).
- **Change ID:** urlop-planowany-category
- **PRD refs:** FR-001, FR-002
- **Prerequisites:** F-01 (tabela `absence_types` + seed kanonicznych typów)
- **Parallel with:** wszystkie slices — addytywna zmiana danych, nie blokuje i nie jest blokowana
- **Blockers:** —
- **Unknowns:**
  - Kolor nowej kategorii — musi być odróżnialny od 6 istniejących (`#2f578c`, `#10bbef`, `#ffcc00`, `#58873e`, `#e50040`, `#6f6f6f`); do wyboru przy planowaniu.
  - Czy formularz/siatka czytają typy dynamicznie z `absence_types` (wtedy wystarczy migracja seed), czy gdzieś istnieje zahardkodowana lista typów do zaktualizowania — do weryfikacji w researchu/planie.
- **Risk:** Niskie — typy nieobecności były oznaczone jako "kanoniczne" w seedzie F-01 (`PRD Business Logic section`), więc to świadome rozszerzenie listy; sama zmiana to dodanie wiersza do `absence_types`. Ryzyko tylko jeśli lista typów jest zduplikowana/zahardkodowana poza bazą.
- **Status:** done

### S-14: Pole godzin tylko dla kategorii "szkolenie w miejscu pracy"

- **Outcome:** w formularzu dodawania/edycji nieobecności możliwość wpisania zakresu godzin (nieobecność niepełnodniowa) jest dostępna wyłącznie po wybraniu kategorii "szkolenie w miejscu pracy"; pozostałe kategorie są traktowane jako całodniowe. Zawęża funkcję wprowadzoną w S-09.
- **Change ID:** hours-onsite-training-only
- **PRD refs:** FR-004
- **Prerequisites:** S-09 (zakres godzin / `start_time`/`end_time` + przełącznik `is_full_day`)
- **Parallel with:** wszystkie slices — zmiana logiki formularza, nie blokuje i nie jest blokowana
- **Blockers:** —
- **Unknowns:**
  - Czy bramkowanie po kategorii ma być zahardkodowane do nazwy "szkolenie w miejscu pracy", czy zrobione jako per-kategoria zdolność (np. flaga na `absence_types`) — istotne, bo dochodzą nowe kategorie (S-13); do decyzji przy planowaniu.
  - Egzekwowanie tylko w UI czy też walidacja po stronie API (`is_full_day`/czas vs typ) — do weryfikacji.
- **Risk:** Niskie–średnie — głównie logika warunkowa formularza; ryzyko regresji istniejących wpisów godzinowych z innych kategorii, jeśli istnieją dane produkcyjne (pre-launch: brak).
- **Status:** done

### S-15: Saldo urlopu — wymiar z systemu kadrowego i licznik pozostałych dni

- **Outcome:** pracownik wpisuje swój wymiar urlopu z zewnętrznego systemu kadrowego (Bieżący + Zaległy); aplikacja zlicza wykorzystane wpisy typu `urlop` i pokazuje na karcie dashboardu, ile dni urlopu zostało (Pozostało = Bieżący + Zaległy − Wykorzystane), per rok kalendarzowy. Kartę widzą i edytują zarówno pracownicy, jak i moderatorzy.
- **Change ID:** urlop-balance
- **PRD refs:** FR-005, FR-006
- **Prerequisites:** F-01 (tabele `employees`/`absences`/`absence_types`)
- **Parallel with:** wszystkie slices — addytywna tabela + endpoint + karta; nie blokuje innych
- **Blockers:** —
- **Unknowns:**
  - Niedoszacowanie "Wykorzystane" przy adopcji w trakcie roku (urlop sprzed wdrożenia aplikacji) — łagodzone opcjonalnym polem `used_adjustment_days`; szczegóły w planie.
  - Interakcja z S-13: nowa kategoria "urlop planowany" NIE może być liczona jako wykorzystany `urlop` (dopasowanie po dokładnej nazwie + test regresji).
- **Risk:** Niskie–średnie — wzorce (tabela + endpoint + karta) istnieją; główne ryzyko to poprawność zliczania (dzielnik /8 musi zgadzać się z `AbsenceStats.tsx`) i wykluczenie `urlop planowany`.
- **Amendment (2026-08-10, change `holiday-balance-valid-until`):** data-wskazówka „Do dnia:" (`holiday_balances.valid_until`) została usunięta z produktu — nic jej nie czytało, jej znaczenie nigdy nie zostało ustalone, a karta jest teraz przypięta do bieżącego roku kalendarzowego. Oryginalny Outcome zobowiązywał pracownika do jej wpisywania; ten fragment został wykreślony powyżej.
- **Status:** done

### S-16: Przeprojektowanie strony głównej — jasna karta logowania na `/`

- **Outcome:** (tech/UX) trasa główna `/` renderuje jasną, polskojęzyczną kartę logowania (branding NBP „Nieobecności", granatowy przycisk `#072143` / złoty hover `#c5ac75`) zamiast startowego szablonu „10x Astro Starter"; formularz posta e-mail/hasło do istniejącego `/api/auth/signin`, a zalogowany użytkownik wchodzący na `/` jest przekierowany do `/dashboard`. `/auth/signin` pozostaje niezmienioną, ciemną trasą awaryjną.
- **Change ID:** main-page-redesign
- **PRD refs:** — (pochodzi z makiety, nie z PRD)
- **Prerequisites:** — (korzysta z istniejącego auth Supabase i middleware)
- **Parallel with:** wszystkie slices — zmiana prezentacji `/`, nie blokuje i nie jest blokowana
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Niskie — jasny wariant formularza tylko dla `/` (bez zmiany współdzielonych, ciemnych komponentów `src/components/auth/*`), więc bez regresji `/auth/signin`; makietowe LDAP/AD i „WRIFboard" potraktowane jako referencja wizualna, nie wymagania.
- **Status:** done

### S-17: Adopcja prototypu `new-design` jako UI/UX aplikacji

- **Outcome:** (UX) użytkownik korzysta z całego dashboardu w jednym języku wizualnym marki NBP: wprowadzona warstwa design-tokenów (granat `#072143`, złoto `#c5ac75`, focus `#b4dceb`), przeprojektowane karty, siatka miesięczna, zakładki i filtry typów nieobecności. Kończy współistnienie trzech motywów (`/`, `/dashboard`, `/auth/signin`).
- **Change ID:** huge-ui-ux-improvement
- **PRD refs:** FR-001, FR-002, FR-005
- **Prerequisites:** S-16 (paleta i branding wprowadzone na `/`)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Średnie–wysokie — zmiana dotyka każdej powierzchni dashboardu plus addytywna migracja `absence_types` (`icon`, `text_color`, `display_order`) i bramka moderatora na zapisie salda urlopu. Zweryfikowane 80 wierszami Progress + manualną weryfikacją, z której wypadły trzy zmiany potomne (`absence-hours-window`, `holiday-balance-valid-until`, `grid-multicheck`).
- **Carve-outs:** flaga priorytetu, wielodniowe zaznaczanie przeciągnięciem (→ S-21) i batchowy endpoint sald („Podgląd wykorzystania urlopów") świadomie **poza** tą zmianą.
- **Status:** done

### S-18: Ograniczenie zakresu godzin nieobecności niepełnodniowej

- **Outcome:** zakres godzin dla nieobecności niepełnodniowej jest ograniczony do maks. 8 h i startu nie wcześniej niż 06:00; wartości spoza zakresu są korygowane, a reguła obowiązuje zarówno w formularzu, jak i po stronie API (nie tylko jako `min`/`max` na inpucie).
- **Change ID:** absence-hours-window
- **PRD refs:** FR-004
- **Prerequisites:** S-09 (`start_time`/`end_time`), S-14 (niepełnodniowe tylko dla szkoleń)
- **Parallel with:** wszystkie slices
- **Blockers:** —
- **Unknowns:** — (rozstrzygnięte we `frame.md`: brak CHECK-a w bazie, brak grandfatheringu, dwa śmieciowe wiersze wyczyszczone; pierwotne 07:15–23:59 zastąpione przez 06:00 + 8 h)
- **Risk:** Niskie — walidacja serwerowa już istniała, zmieniły się granice, nie warstwa.
- **Status:** review pending — zaimplementowane 2026-08-11, brak `reviews/`

### S-19: Radialny wybór godzin + widoczna korekta wartości

- **Outcome:** użytkownik ustawia godziny nieobecności na tarczy zegara ze skokiem 15 minut i widzi komunikat, gdy wartość została skorygowana do dozwolonego okna — zamiast cichego przycięcia, które rozwiązywało poprzednie dwa symptomy („wolno/pracowicie" = granularność, „wartości się zmieniają" = brak informacji zwrotnej).
- **Change ID:** radial-timepicker-ux
- **PRD refs:** FR-004
- **Prerequisites:** S-18 (okno i clamp, na których opiera się informacja o korekcie)
- **Parallel with:** S-20
- **Blockers:** — (był: czerwony setup E2E, naprawiony przez `e2e-auth-locators`)
- **Unknowns:** —
- **Risk:** Średnie — wymiana natywnego `<input type="time">` na własną kontrolkę; precedens: podobna kontrolka została zbudowana i cofnięta w 3 minuty 2026-06-06 (`9fcac6f` → `876a89b`), a powód nigdy nie trafił poza komunikat commita.
- **Status:** done

### S-20: Związanie szerokości kolumn siatki i uproszczenie komórki

- **Outcome:** siatka miesięczna mieści zakładane ~10 kolumn pracowników: komórka pokazuje ikonę typu + zakres godzin (nazwa typu żyje w legendzie i tooltipie, zgodnie z prototypem), a tabela dostaje `table-fixed`, co jako jedyne wiąże także nagłówek z imieniem i nazwiskiem.
- **Change ID:** grid-adjustment-offsite-training
- **PRD refs:** FR-001, FR-002
- **Prerequisites:** S-17 (design-tokeny, ikony na `absence_types`)
- **Parallel with:** S-19
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Niskie–średnie — zakres poszerzony 2026-08-12 z jednego typu na wszystkie siedem po audycie w `research.md`; odrzucono trzyliniowe zawijanie (opcja C) i zmianę nazwy w bazie (opcja E). Brak testów komponentowych dla `AbsenceGrid.tsx` (vitest działa w `environment: "node"`) — weryfikacja opiera się na testach jednostkowych helperów + E2E.
- **Status:** done

### S-21: Wielodniowe zaznaczanie komórek siatki przeciągnięciem

- **Outcome:** użytkownik zaznacza wielodniową nieobecność (np. 10 dni urlopu) jednym przeciągnięciem myszy po siatce zamiast klikać każdą komórkę osobno; weekendy pozostają nieklikalne i są pomijane w zaznaczeniu.
- **Change ID:** grid-multicheck
- **PRD refs:** FR-001, FR-004
- **Prerequisites:** S-17 (carve-out z S-17: „drag-to-select multi-day writes")
- **Parallel with:** S-22
- **Blockers:** —
- **Unknowns:**
  - Zapis wsadowy: N żądań `POST /api/absences` czy nowy endpoint batch? Wpływa na obsługę częściowej porażki i na duplikaty (409).
  - Czy przeciągnięcie po komórkach zajętych nadpisuje istniejące wpisy, pomija je, czy blokuje zaznaczenie?
  - Interakcja z drag-and-drop kolejności kolumn z S-07 — dwa gesty przeciągania na tej samej tabeli.
- **Risk:** Średnie — gest myszy na tabeli, która już obsługuje DnD kolumn; referencja UX istnieje w `new-design/`.
- **Status:** planned — `research.md` gotowy, brak planu

### S-22: Moderator edytuje dane pracownika; pracownik zmienia hasło

- **Outcome:** moderator zmienia e-mail pracownika oraz jego wymiar urlopu (bieżący, zaległy, korekta); każdy pracownik może zmienić własne hasło, klikając swój e-mail w lewym górnym rogu.
- **Change ID:** workers-data-edit
- **PRD refs:** FR-005, FR-007
- **Prerequisites:** S-04 (zarządzanie pracownikami), S-15 (`holiday_balances` — bieżący/zaległy/korekta)
- **Parallel with:** S-21
- **Blockers:** —
- **Unknowns:**
  - Zmiana e-maila to operacja na `auth.users` (Supabase Admin API), nie tylko na `employees` — czy wymaga potwierdzenia mailowego i co z aktywną sesją pracownika?
  - Zmiana hasła przez pracownika: `updateUser` na sesji użytkownika vs. flow resetu mailem; czy wymagać starego hasła?
  - „Korekta" mapuje się na istniejące `used_adjustment_days` z S-15 czy na nowe pole?
- **Risk:** Średnie — dotyka warstwy auth (service role po stronie serwera, nigdy w kliencie) i danych, które S-15 liczy do salda.
- **Status:** planned — `research.md` gotowy, brak planu

## Poza roadmapą — inżynieria, testy i narzędzia

Zmiany bez wartości użytkowej per se, więc bez numeru slice'a — ale realne i archiwizowane
tak samo. Śledzone tu, żeby archiwum dało się odczytać wstecz. Rollout testów ma własny
dokument: `context/foundation/test-plan.md`.

| Change ID           | Czego dotyczy                                                                 | Status                              |
| ------------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| ci-cd-code-review   | Pipeline CI/CD + AI code review na PR-ach (`packages/code-reviewer`)          | archived 2026-07-06                 |
| code-review-evals   | promptfoo jako harness ewaluacyjny dla agenta code-review                     | review pending                      |
| crud-integrity      | Bootstrap Vitest + testy integralności CRUD i 409 (test-plan §3, faza 1)      | archived 2026-08-12                 |
| tool-loop-agent     | Agent z pętlą narzędziową (ćwiczenie M4)                                      | archived 2026-08-12                 |
| team-status-digest  | Poranny digest statusu projektu — `scripts/team-digest.ts` (M5L1)             | archived 2026-08-12                 |
| e2e-auth-locators   | Naprawa lokatorów logowania w `tests/e2e/setup/auth.setup.ts`                 | archived 2026-08-12                 |
| dev-vars-rename     | (ma slice S-10) — konsolidacja `.dev.vars` → `.env.dev`                       | done                                |
| bootstrap-verification | Log weryfikacji ze scaffoldingu (`/10x-bootstrapper`) — nie jest zmianą     | artefakt, nie do archiwizacji       |

## Backlog Handoff

Rozliczone zostały wszystkie pozycje do S-20 włącznie; poniżej tylko to, co realnie czeka
na pracę. Pełna historia zamkniętych pozycji jest w sekcji **Done** i w `context/archive/`.

| Roadmap ID | Change ID                        | Sugerowany tytuł issue                                                 | Gotowy na `/10x-plan` | Uwagi                                                             |
| ---------- | -------------------------------- | ---------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------- |
| S-21       | grid-multicheck                  | [Urlopy] Zaznaczanie wielu dni przeciągnięciem po siatce               | yes                   | `research.md` gotowy; uruchom `/10x-plan grid-multicheck`         |
| S-22       | workers-data-edit                | [Urlopy] Moderator edytuje e-mail i wymiar urlopu; pracownik zmienia hasło | yes               | `research.md` gotowy; uruchom `/10x-plan workers-data-edit`       |
| —          | code-review-evals                | [Tooling] promptfoo — ewaluacja agenta code-review                     | done                  | Zaimplementowane, czeka na impl-review przed archiwizacją          |

## Open Roadmap Questions

Brak. PRD: "No open questions at this time." Wywiad nie ujawnił żadnych cross-cutting pytań nierozwiązanych.

## Parked

- **FR-008: plan urlopów z oznaczeniem priorytetu** — Why parked: PRD §Non-Goals: nice-to-have, poza głównym MVP flow.
- **Moduł planu urlopów** — Why parked: PRD §Non-Goals: poza zakresem MVP.
- **Złożony workflow zatwierdzania urlopów** — Why parked: PRD §Non-Goals.
- **Integracje zewnętrzne (inne platformy firmowe)** — Why parked: PRD §Non-Goals.
- **Aplikacja natywna mobilna** — Why parked: PRD §Non-Goals; pierwsza wersja web-only.
- **Osobne reguły widoczności statystyk dla pracownika i moderatora** — Why parked: PRD §Non-Goals.
- **Zaawansowane logowanie strukturalne** — Why parked: brak wymogu w PRD NFRs; podstawowy error tracking pokrywa S-12 (Sentry); pełne structured logging to post-MVP.

## Done

- **S-17: cały dashboard w jednym języku wizualnym marki NBP — warstwa design-tokenów w `global.css`, przeprojektowane karty, siatka, zakładki i filtry typów; koniec trzech współistniejących motywów.** — Implemented + impl-reviewed 2026-08-10, archived 2026-08-12 → `context/archive/2026-08-07-huge-ui-ux-improvement/`. 8 faz, 80/80 wierszy Progress potwierdzonych; addytywna migracja `absence_types` (`icon`, `text_color`, `display_order`), usunięcie zduplikowanych ciemnych prymitywów auth, bramka moderatora na zapisie salda urlopu. Dwa wiersze zamknięte z odstępstwem opisanym w `change.md` (m.in. `Wyczyść filtry` jako toggle dwustanowy, `8b25781`). Ręczna weryfikacja wygenerowała trzy zmiany potomne: `absence-hours-window` (S-18), `holiday-balance-valid-until` i `grid-multicheck` (S-21). Reports: `reviews/impl-review.md`, `reviews/impl-review-2.md`.
- **S-18: zakres godzin nieobecności niepełnodniowej ograniczony do maks. 8 h ze startem nie wcześniej niż 06:00, korygowany w formularzu i po stronie API.** — Implemented 2026-08-11 → `context/changes/absence-hours-window/`, 25/25 wierszy Progress. **Impl-review jeszcze nie wykonany** — do zrobienia przed archiwizacją. `frame.md` przestawił zakres z pierwotnego 07:15–23:59 (źródło „01:22" okazało się dummy data z makiety); dwa śmieciowe wiersze wyczyszczone, bez backfillu i bez CHECK-a w bazie.
- **S-19: radialna tarcza zegara ze skokiem 15 min zamiast dwóch natywnych `<input type="time">`, plus widoczny komunikat o korekcie wartości.** — Implemented + impl-reviewed 2026-08-12, archived 2026-08-17 → `context/archive/2026-08-11-radial-timepicker-ux/`, 32/32 wierszy Progress. Blokada E2E zdjęta przez `e2e-auth-locators` (zarchiwizowane 2026-08-12). Report: `reviews/impl-review.md`. Lesson: —.
- **S-20: siatka miesięczna mieści zakładane ~10 kolumn pracowników: komórka pokazuje ikonę typu + zakres godzin (nazwa typu żyje w legendzie i tooltipie, zgodnie z prototypem), a tabela dostaje `table-fixed`, co jako jedyne wiąże także nagłówek z imieniem i nazwiskiem.** — Implemented + impl-reviewed 2026-08-13, archived 2026-08-13 → `context/archive/2026-08-11-grid-adjustment-offsite-training/`. 4 fazy, 28/28 wierszy Progress; zakres poszerzony z jednego typu na wszystkie siedem po audycie w `research.md`. Cztery commity dotknęły dokładnie czterech zaplanowanych plików. Impl-review NEEDS ATTENTION — trzy ustalenia, wszystkie naprawione w `643eb49`: migracja ikony nie miała ścieżki wykonania (dziennikowany seed przywraca sekwencję ZWJ na świeżym środowisku — udokumentowane w `AGENTS.md`), `role="img"` ukrywał znacznik zastępstwa i komentarza przed czytnikami ekranu, a formatowanie zakresu w tooltipie było nietestowaną kopią (`rawTimeRange` współdzielony). Report: `reviews/impl-review.md`. Lesson: —.
- **(bez slice'a) Usunięcie pola „Do dnia:" i przypięcie karty salda do bieżącego roku** — Archived 2026-08-10 → `context/archive/2026-08-07-holiday-balance-valid-until/`. Poprawka do S-15, opisana jako Amendment przy tamtym slice'ie; wykryta podczas ręcznej weryfikacji S-17 (wiersze 7.8 / 7.10).
- **(bez slice'a) Naprawa lokatorów logowania w suicie E2E** — Archived 2026-08-12 → `context/archive/2026-08-11-e2e-auth-locators/`. Odblokowała weryfikację S-19.
- **S-16: trasa `/` renderuje jasną kartę logowania (branding NBP „Nieobecności", granatowy przycisk `#072143` / złoty hover `#c5ac75`), postującą e-mail/hasło do istniejącego `/api/auth/signin`; zalogowany użytkownik wchodzący na `/` jest przekierowany do `/dashboard`; `/auth/signin` pozostaje niezmienioną trasą awaryjną.** — Archived 2026-08-06 → `context/archive/2026-08-06-main-page-redesign/`. Nowy jasny komponent `LoginCardForm.tsx` (współdzielone ciemne komponenty `src/components/auth/*` nietknięte). Impl-review APPROVED (0 critical/0 warnings); F1 (martwy spinner `useFormStatus` przy formularzu z akcją-stringiem) naprawiony (f419d87). Report: `context/archive/2026-08-06-main-page-redesign/reviews/impl-review.md`. Lesson: —.
- **S-11: pierwsze konto admina (rola moderator) tworzone automatycznie z `.env`/`.env.dev`; samorejestracja wyłączona (nowych użytkowników dodają wyłącznie moderatorzy); konto admin techniczne — niewidoczne w siatce/szczegółach/liście pracowników i niesuwalne przez innych moderatorów.** — Implemented + impl-reviewed 2026-08-06, archived 2026-08-12 → `context/archive/2026-06-22-admin-bootstrap/`. Impl-review APPROVED; F1 (martwe linki `/auth/signup`) naprawiony (ac98b0b).
- **S-13: użytkownik wybiera nowy typ nieobecności "urlop planowany" z listy kategorii w formularzu dodawania/edycji wpisu; typ jest widoczny w siatce miesięcznej i tabeli szczegółów z własnym, odróżnialnym kolorem — tak jak istniejące kategorie (`urlop`, `choroba`, itd.).** — Archived 2026-07-22 → `context/archive/2026-06-22-urlop-planowany-category/`. Lesson: —.
- **S-14: w formularzu dodawania/edycji nieobecności możliwość wpisania zakresu godzin (nieobecność niepełnodniowa) jest dostępna wyłącznie po wybraniu kategorii "szkolenie w miejscu pracy"; pozostałe kategorie są traktowane jako całodniowe. Zawęża funkcję wprowadzoną w S-09.** — Archived 2026-07-22 → `context/archive/2026-06-22-hours-onsite-training-only/`. Lesson: —.
- **S-01: pracownik wybiera miesiąc, widzi siatkę miesięczną (dni × pracownicy, kolory wg typu) i dodaje/edytuje/usuwa własny wpis nieobecności — północna gwiazda produktu.** — Implemented + impl-reviewed 2026-05-29, archived 2026-08-12 → `context/archive/2026-05-28-monthly-grid-own-absence/`. Reports: `reviews/impl-review.md`, `reviews/impl-review-phase-2.md`, `reviews/impl-review-phase-3.md`, `reviews/plan-review.md`. Lesson: —.
- **S-02: pracownik może zobaczyć tabelę szczegółów nieobecności za dany miesiąc (typ, osoba, zastępca, godziny, komentarz, data wpisu) oraz statystyki nieobecności miesięczne i roczne.** — Archived 2026-05-30 → `context/archive/2026-05-30-details-and-stats/`. Lesson: —.
- **S-03: moderator może dodawać/edytować/usuwać wpisy nieobecności wszystkich pracowników w siatce miesięcznej (te same widoki co pracownik, lecz bez ograniczeń własnościowych).** — Implemented 2026-05-31, archived 2026-08-12 → `context/archive/2026-05-31-moderator-absence-management/`. Lesson: prop threading vs. self-contained component lookup (see `context/foundation/lessons.md`).
- **S-06: zakładka Szczegóły pokazuje osobne karty Dzisiaj / Miesięcznie / Rocznie** — Implemented 2026-06-01, archived 2026-08-17 → `context/archive/2026-06-01-details-subcards/`. Extends GET /api/absences with date-range mode; AbsenceDetailsSubcards island with AbortController lazy-fetch pattern; className + emptyLabel props added to AbsenceDetailsTable.
- **S-04: (moderator) dodawać i usuwać pracowników bez usuwania historycznych wpisów nieobecności** — Implemented + impl-reviewed 2026-05-31, archived 2026-08-17 → `context/archive/2026-05-31-employee-management/`. 27/27 wierszy Progress. Report: `reviews/impl-review.md`. Lesson: —.
- **S-07: (moderator) zmiana kolejności kolumn pracowników w siatce miesięcznej przez przeciąganie** — Implemented 2026-06-09, archived 2026-08-12 → `context/archive/2026-06-08-employee-grid-order/`. display_order column + seeding migration, PATCH /api/employees/order (UNNEST bulk update), dashboard orderBy with active-first CASE expression, @dnd-kit DnD with two SortableContexts + DragOverlay, self-first sort.
- **S-08: (bugfix) siatka miesięczna pokazuje historyczne nieobecności zdezaktywowanych pracowników** — Archived 2026-06-03 → `context/archive/2026-06-03-deactivated-employee-grid/`. Lesson: —.
- **S-05: wszystkie zapytania do bazy danych używają Drizzle ORM zamiast klienta Supabase JS — typesafe queries, schemat bazy zdefiniowany w kodzie, migracje zarządzane przez Drizzle Kit.** — Implemented, archived 2026-08-12 → `context/archive/2026-06-01-drizzle-migration/`. Note: `createAdminClient()` (Supabase JS) retained for auth admin operations; only app table queries migrated to Drizzle.
- **S-12: Sentry SDK wdrożone dla Cloudflare Workers — error tracking, source maps, 10% performance sampling, captureException we wszystkich catch blokach API + middleware Sentry.setUser/setTag.** — Implemented 2026-06-10 → `context/changes/sentry-integration/`. Phase 1: tracesSampleRate + SENTRY_DSN secret. Phase 2: captureException in 12 files, userRole lookup in middleware.
- **S-15: pracownik wpisuje wymiar urlopu (Bieżący + Zaległy) i widzi saldo pozostałych dni na karcie dashboardu, per rok; aplikacja zlicza wykorzystane wpisy `urlop` (z wykluczeniem `urlop planowany`).** — Implemented + impl-reviewed + Archived 2026-07-14 → `context/archive/2026-06-22-urlop-balance/`. 4 fazy: `holiday_balances` + migracja (CHECK constraints), API GET/POST z serwerowym liczeniem Used (`/8` = `AbsenceStats.FULL_DAY_HOURS`, upsert on `(employee_id, year)`), karta dashboardu + dialog edycji, oraz Faza 4 (dodana ad-hoc): endpoint `DELETE /api/holiday-balances/[id]` + delete w dialogu. Impl-review: 5 findings, wszystkie naprawione (m.in. dodano RLS na `holiday_balances` przez ręczną migrację `20260714114608_holiday_balances_rls.sql`, zastosowaną na prod przez `supabase db push` po `migration repair`). Report: `context/archive/2026-06-22-urlop-balance/reviews/impl-review.md`.
- **S-09: (UX) użytkownik widzi zakres godzin (np. „12:00–14:00") dla nieobecności niepełnodniowych w siatce i szczegółach** — Implemented + impl-reviewed 2026-06-08, archived 2026-08-17 → `context/archive/2026-06-05-absence-hours-range/`. 27/27 wierszy Progress; schemat `hours` → `start_time`/`end_time`. Report: `reviews/impl-review.md`. Lesson: —.
