# Poranny digest statusu projektu (team-status-digest) — Implementation Plan

## Overview

Cienki, **read-only**, zero-dependency helper (`tsx`), który godzi rozproszone źródła stanu projektu w jeden datowany raport Markdown. Realizuje lekcję M5L1 „AI Internal Builders" — pierwsza użyteczna wersja, mock-first → skrypt. Helper **uzupełnia** (nie zastępuje) GitHub/Linear/CI: czyta, streszcza i **linkuje** do źródeł, nie staje się nowym źródłem prawdy.

## Current State Analysis

- **Brak jakiegokolwiek narzędzia digestu** — to pierwszy internal-builder w repo. Jedyny istniejący standalone-skrypt to `scripts/seed-admin.ts`, który ustanawia wzorzec ESM/`tsx`/`process.loadEnvFile()`/`main().catch(exit 1)`.
- **Trzy lokalne źródła są wiarygodne i wystarczające** dla rdzenia: `context/changes/*/change.md` (deklarowany status), `context/foundation/roadmap.md` (status slice'ów), `git log` (ruch).
- **Frontmatter jest niespójny** (`research.md`): klucz id to `change_id` **lub** `id`; link do roadmapy to `roadmap_id` **lub** `roadmap_ref`; pole `updated:` bywa równe `created:` → **nie jest wiarygodnym sygnałem ruchu**.
- **Git jest kanoniczny dla „ruchu"**: `git log -1 --format=... -- context/changes/<id>/` daje datę ostatniego dotknięcia folderu. Scope w Conventional Commits = change-id (`feat(admin-bootstrap): …`).
- **Tylko 6 z 18 zmian** ma link do roadmapy → brak linku ≠ błąd.
- **Mirror-docs zamrożone**: `tasks-github.md` / `tasks-linear.md` mają po 5 wierszy (stan 2026-05-25), podczas gdy `context/changes/` ma ~16 aktywnych zmian → mierzalny drift.
- **Zero parsujących zależności**: brak `yaml`/`gray-matter`/`glob` w `package.json`; dostępne `zod` i `tsx`; Node 24 (`fs.globSync` działa).
- **Lint-first**: PostToolUse hooki (`.claude/settings.json:8-17`) odpalają `npm run lint` + `npx astro check` po każdym zapisie `.ts`; `no-console: warn` → każdy `console.*` wymaga inline-disable. Skrypty w `scripts/` **nie są** objęte auto-testami vitest.
- **Sygnały zewnętrzne dostępne**: `gh` CLI v2.87.3 zalogowany (`oliwabartosz`, scope `repo, workflow, read:org`); Sentry przez REST (org `o4511534802993152`, projekt `4511534806007888`, region `de.sentry.io`) wymaga `SENTRY_AUTH_TOKEN` (dziś tylko sekret CI, nie w `.env`).

## Desired End State

Po ukończeniu planu developer uruchamia `npm run digest` i dostaje świeży plik `context/team/digests/RRRR-MM-DD.md` z sekcjami:

1. **Co się zmieniło (od wczoraj)** — commity z ostatniego okna, zgrupowane po change-id (scope).
2. **W toku (wg dni bez ruchu)** — wszystkie zmiany o statusie `new`/`planned`/`implementing`, posortowane malejąco po liczbie dni od ostatniego commita dotykającego ich folder. **Bez progu/etykiety „utknęło"** — sortowanie samo wypycha najstarsze na górę.
3. **Rozjazdy** — (a) git↔frontmatter (deklarowany `status` vs realny ruch), (b) mirror-docs drift (liczba zmian lokalnie vs liczba wierszy w `tasks-github.md`), (c) change-id obecne lokalnie a brakujące w mirror.
4. **Decyzje na dziś** — 1–3 **pytania decyzyjne wyprowadzone z reguł** z wykrytych sygnałów, z linkami do źródeł.
5. **CI / Błędy** (Faza C) — ostatni run GitHub Actions + nowe issues z Sentry; gdy źródło niedostępne → „niedostępne", reszta digestu działa.
6. **⚠️ Nie udało się sparsować** — lista plików z błędnym frontmatterem (skip-and-warn).

Weryfikacja: `npm run digest` tworzy datowany plik bez wyjątku; przy podsuniętym uszkodzonym `change.md` plik dalej powstaje, a wadliwy plik ląduje w sekcji ⚠️; `npm run lint` i `npx astro check` przechodzą.

### Key Discoveries:

- Wzór skryptu do skopiowania: `scripts/seed-admin.ts:1-140` (ESM, `process.loadEnvFile()`, `main().catch(exit 1)`).
- npm-script wzór: `package.json:20` (`"seed:admin": "tsx scripts/seed-admin.ts"`).
- `no-console: warn` — `eslint.config.js:23`; każdy `console.*` → `// eslint-disable-next-line no-console`.
- Git ruch per zmiana: `git log -1 --format="%h %ai %s" -- context/changes/<id>/`.
- Roadmap: tabela „At a glance" `roadmap.md:40-57`; sekcje slice'ów `roadmap.md:101-292` (`- **Status:**`).
- Frontmatter: akceptuj `change_id`|`id` oraz `roadmap_id`|`roadmap_ref`; nie ufaj `updated:`.

## What We're NOT Doing

- **Brak panelu/UI, logowania, bazy danych, harmonogramu (cron), dwukierunkowego synca.** To jednorazowo uruchamiany skrypt CLI.
- **Nie zastępujemy** GitHub/Linear/CI ani roadmapy — tylko streszczamy i linkujemy.
- **Brak stanu między uruchomieniami** — „od wczoraj" to stałe okno (`--since`), nie zapamiętany znacznik ostatniego biegu.
- **Brak progu „utknięcia"** — świadomie (decyzja: sortowanie, nie binarna etykieta).
- **Brak wywołania LLM w skrypcie** — sekcja „decyzje" to deterministyczne pytania z reguł, nie wygenerowany tekst.
- **Digest NIE jest commitowany** — `context/team/digests/` w `.gitignore`; to stan pochodny.
- **Brak nowych zależności npm** — ręczny parser + `zod` + `fs.globSync`.

## Implementation Approach

Trzy fazy, każda samodzielnie wartościowa:

- **Faza A (mock-first)** ustala *kształt* raportu na realnych danych, zanim powstanie kod — staje się fixture'em referencyjnym dla Fazy B.
- **Faza B** automatyzuje rdzeń na trzech lokalnych źródłach. Git jest kanoniczny dla ruchu; frontmatter tylko deklaratywny; rozjazd git↔frontmatter to osobna wartość digestu. Parsowanie odporne na błędy („pomiń i ostrzeż").
- **Faza C** dokłada sygnały zewnętrzne (GitHub Actions + Sentry) z graceful degradation — brak `gh`/tokena nie wywraca digestu.

## Critical Implementation Details

- **Skrypt NIE importuje `@/lib/...` ani `@/db/...`** — tak jak `seed-admin.ts`, te moduły czytają `astro:env/server` i działają tylko w Workerze. Jeśli Faza C potrzebuje Sentry/GitHub, klienty/wywołania budujemy inline z `process.env` / `child_process`.
- **Git jako podproces**: użyj `node:child_process` (`execFileSync("git", [...])`), nigdy nie składaj polecenia przez interpolację stringów (bezpieczeństwo + cudzysłowy).
- **`updated:` jest pułapką** — do liczenia dni bez ruchu używaj wyłącznie daty z `git log -- <folder>`; frontmatter `updated` ignoruj jako sygnał czasowy.
- **Skip-and-warn musi obejmować też brak commita** — zmiana bez żadnego commita w swoim folderze (świeżo utworzona, niezacommitowana) nie ma daty git; potraktuj jako „0 dni / brak historii", nie jako błąd parsowania.

---

## Phase A: Mock-first digest (realny snapshot)

### Overview

Ręcznie napisany przykładowy digest na faktycznym stanie repo. Definiuje kanoniczny układ sekcji i nagłówków, który Faza B ma odtworzyć. Zero kodu produkcyjnego.

### Changes Required:

#### 1. Przykładowy raport

**File**: `context/team/digests/2026-06-29.md` (data dzisiejsza)

**Intent**: Pokazać docelowy kształt digestu na prawdziwych danych (np. `admin-bootstrap` = implementing, `urlop-balance` = planned, `urlop-planowany-category`/`hours-onsite-training-only` = new), żeby zwaliduować wartość i ustalić nagłówki sekcji zanim powstanie parser.

**Contract**: Plik Markdown z sześcioma sekcjami w kolejności z „Desired End State": `## Co się zmieniło (od wczoraj)`, `## W toku (wg dni bez ruchu)`, `## Rozjazdy`, `## Decyzje na dziś`, `## CI / Błędy`, `## ⚠️ Nie udało się sparsować`. Każdy wpis o zmianie linkuje do `context/changes/<id>/`. Sekcja „W toku" to lista posortowana malejąco po dniach bez ruchu (bez etykiet „stuck"). Sekcja „Decyzje" zawiera 1–3 pytania w formie „<sygnał> — <pytanie decyzyjne>? → <link>".

#### 2. Gitignore dla katalogu digestów

**File**: `.gitignore`

**Intent**: Digesty to stan pochodny — nie wersjonujemy ich, ale katalog ma istnieć.

**Contract**: Dodaj wpis ignorujący `context/team/digests/` z wyjątkiem `.gitkeep` (np. `context/team/digests/*` + `!context/team/digests/.gitkeep`). Utwórz pusty `context/team/digests/.gitkeep`. Mock z punktu 1 jest lokalny i nie wchodzi do commita.

### Success Criteria:

#### Automated Verification:

- Plik mocka istnieje: `test -f context/team/digests/2026-06-29.md`
- Katalog jest ignorowany: `git check-ignore context/team/digests/2026-06-29.md` zwraca ścieżkę (exit 0)
- `.gitkeep` jest śledzony: `git status --porcelain context/team/digests/.gitkeep` pokazuje go jako dodany (nie ignorowany)

#### Manual Verification:

- Sekcje i ich kolejność odpowiadają „Desired End State"
- Dane w mocku zgadzają się z realnym stanem repo (statusy zmian, przybliżone dni bez ruchu)
- Format wpisu „Decyzje na dziś" jest jednoznaczny i nadaje się do odtworzenia regułami w Fazie B

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie człowieka, że kształt mocka jest akceptowalny, zanim ruszysz Fazę B (mock jest kontraktem dla parsera).

---

## Phase B: Skrypt lokalny `scripts/team-digest.ts`

### Overview

Automatyzacja rdzenia na trzech lokalnych źródłach. Generuje datowany plik o kształcie z Fazy A, używając git jako kanonicznego sygnału ruchu i parsera frontmatteru odpornego na niespójności.

### Changes Required:

#### 1. Parser i czytniki źródeł

**File**: `scripts/team-digest.ts` (nowy)

**Intent**: Zebrać dane z `change.md` (glob), `roadmap.md` i `git log`, znormalizować niespójny frontmatter i policzyć dni bez ruchu per zmiana.

**Contract**:
- Glob: `fs.globSync("context/changes/*/change.md")` (Node 24).
- Ręczny parser frontmatteru: wytnij blok między `---`/`---`, rozbij po liniach `klucz: wartość`. Zmapuj `change_id`|`id` → `id`, `roadmap_id`|`roadmap_ref` → `roadmapRef`. Waliduj `zod`-schematem (`id: string`, `status: enum[new,planned,implementing,implemented,impl_reviewed,archived]`, `created`, `updated`, reszta opcjonalna). Błąd walidacji → wpis do listy „nie sparsowano", **nie** wyjątek.
- Ruch per zmiana: `execFileSync("git", ["log","-1","--format=%aI","--","context/changes/<id>/"])`; brak wyniku → „brak historii git". Dni bez ruchu liczone względem „teraz" (data uruchomienia).
- „Od wczoraj": `git log --since=yesterday --pretty=%h%x09%s`; scope z `feat(scope): …` mapuj na change-id (pomiń scope nie-zmianowe: `roadmap`, `lint`, `build`, `ai`).
- Roadmap: sparsuj tabelę „At a glance" do mapy `change-id → status`; brak wpisu = `null` (dozwolone).

**Implementacja zewnętrznych szczegółów regex frontmatteru/scope** — opisana intencją; implementer dobiera wzorce. Snippet zbędny (płaski format).

#### 2. Składanie sekcji i zapis raportu

**File**: `scripts/team-digest.ts`

**Intent**: Złożyć sześć sekcji w kolejności z Fazy A i zapisać do datowanego pliku.

**Contract**:
- Sekcja „W toku": filtruj statusy `new`/`planned`/`implementing`, sortuj malejąco po dniach bez ruchu; brak progu.
- Sekcja „Rozjazdy": (a) zmiany, których realny ruch (git) przeczy deklarowanemu statusowi (np. `implemented` ale commit świeższy niż status sugeruje — opisz jako rozbieżność); (b) `liczba(context/changes/*) vs liczba wierszy tasks-github.md`; (c) lista change-id bez wiersza w mirror.
- Sekcja „Decyzje na dziś": z top-N sygnałów (najstarsza zmiana w toku, największy drift, brak runów CI) wygeneruj 1–3 wpisy „<fakt> — <pytanie>? → <link>". Czysto deterministyczne.
- Zapis: `fs.writeFileSync` do `context/team/digests/<RRRR-MM-DD>.md` (data lokalna). Każdy `console.*` z inline `// eslint-disable-next-line no-console`.
- Szkielet: `main().catch((err) => { console.error(...); process.exit(1); })` wzorem `seed-admin.ts:136-140`.

#### 3. npm script

**File**: `package.json`

**Intent**: Udostępnić `npm run digest`.

**Contract**: Dodaj `"digest": "tsx scripts/team-digest.ts"` (wzór: `"seed:admin"`, `package.json:20`).

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Type-check przechodzi: `npx astro check`
- Skrypt biegnie bez błędu i tworzy datowany plik: `npm run digest && test -f "context/team/digests/$(date +%F).md"`
- Odporność na błąd: po podaniu uszkodzonego `change.md` (tymczasowy fixture) skrypt kończy exit 0 i plik powstaje (smoke test w opisie manualnym, ale exit code sprawdzalny automatycznie)

#### Manual Verification:

- Wygenerowany plik odpowiada kształtem mockowi z Fazy A
- Sekcja „W toku" jest poprawnie posortowana po dniach bez ruchu (porównaj z `git log` dla 2–3 zmian)
- Rozjazd git↔frontmatter i mirror-drift pokazują realne, prawdziwe rozbieżności
- Uszkodzony `change.md` ląduje w sekcji „⚠️ Nie udało się sparsować", a nie wywraca biegu
- „Decyzje na dziś" zawierają 1–3 sensowne, połączone z linkami pytania

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie człowieka (manualne sprawdzenie treści digestu), zanim ruszysz Fazę C.

---

## Phase C: Sygnały zewnętrzne (GitHub Actions + Sentry)

### Overview

Wzbogacenie digestu o status CI i błędy produkcyjne, z graceful degradation — brak `gh`/`SENTRY_AUTH_TOKEN` nie przerywa digestu.

### Changes Required:

#### 1. GitHub Actions przez `gh`

**File**: `scripts/team-digest.ts`

**Intent**: Dodać status ostatniego runu CI do sekcji „CI / Błędy".

**Contract**: `execFileSync("gh", ["run","list","--limit","1","--json","status,conclusion,headBranch,createdAt"])` (lub `gh api repos/.../actions/runs`). Brak `gh`/błąd uwierzytelnienia → złap wyjątek, wpisz „GitHub Actions: niedostępne", kontynuuj. Nie blokuj digestu.

#### 2. Sentry przez REST

**File**: `scripts/team-digest.ts`

**Intent**: Dodać liczbę i top nowych issues z Sentry (okno 24h) do sekcji „CI / Błędy".

**Contract**: Czytaj `SENTRY_AUTH_TOKEN` z `process.env` (po `process.loadEnvFile()`); org `o4511534802993152`, projekt `4511534806007888`, host `de.sentry.io`. `fetch` na endpoint issues z filtrem czasu. Brak tokena → „Sentry: niedostępne (brak SENTRY_AUTH_TOKEN)", kontynuuj. Nie commituj tokena; udokumentuj go w `.env.example` jako opcjonalny.

#### 3. Dokumentacja zmiennej

**File**: `.env.example`

**Intent**: Zasygnalizować opcjonalny `SENTRY_AUTH_TOKEN` dla digestu.

**Contract**: Dodaj zakomentowany/oznaczony jako opcjonalny wpis `SENTRY_AUTH_TOKEN=` z krótkim komentarzem, że bez niego sekcja Sentry jest pomijana.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Type-check przechodzi: `npx astro check`
- Bez `SENTRY_AUTH_TOKEN` skrypt kończy exit 0: `SENTRY_AUTH_TOKEN= npm run digest && test -f "context/team/digests/$(date +%F).md"`
- `.env.example` zawiera wpis: `grep -q SENTRY_AUTH_TOKEN .env.example`

#### Manual Verification:

- Z dostępnym `gh` sekcja „CI" pokazuje realny ostatni run
- Z ustawionym `SENTRY_AUTH_TOKEN` sekcja „Błędy" pokazuje realne issues z ostatnich 24h
- Po usunięciu tokena / wylogowaniu `gh` odpowiednie sekcje mówią „niedostępne", a digest dalej powstaje w całości

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie człowieka przed uznaniem zmiany za ukończoną.

---

## Testing Strategy

### Unit Tests:

- Skrypty w `scripts/` nie są objęte auto-vitest (`.claude/settings.json`), więc bez formalnych testów jednostkowych. Jeśli pojawi się potrzeba, wyodrębnij czysty parser frontmatteru/scope do `src/lib/` (objęty vitest) i przetestuj go tam — poza zakresem tej wersji.

### Integration Tests:

- Smoke: `npm run digest` na realnym repo tworzy datowany plik bez wyjątku.
- Odporność: tymczasowy uszkodzony `change.md` → plik powstaje, wadliwy plik w sekcji ⚠️.
- Degradacja: `SENTRY_AUTH_TOKEN=` i/lub niezalogowany `gh` → sekcje „niedostępne", exit 0.

### Manual Testing Steps:

1. `npm run digest`; otwórz `context/team/digests/<dziś>.md` i porównaj z mockiem Fazy A.
2. Dla 2–3 zmian sprawdź `git log -1 -- context/changes/<id>/` i zweryfikuj liczbę dni bez ruchu w sekcji „W toku".
3. Zepsuj tymczasowo frontmatter jednego `change.md`, uruchom ponownie, potwierdź sekcję ⚠️ i że reszta działa; przywróć plik.
4. (Faza C) Uruchom z i bez `SENTRY_AUTH_TOKEN`; potwierdź realne dane vs „niedostępne".

## Performance Considerations

Skala trywialna (~18 plików, kilka wywołań git). Jedyny realny koszt to wywołania sieciowe Fazy C (GitHub/Sentry) — pojedyncze, sekwencyjne, z timeoutem i łapaniem błędów; nie wymaga cache'owania w wersji 1.

## Migration Notes

Brak migracji danych. Jedyna zmiana w repo poza skryptem to wpis w `.gitignore` (+ `.gitkeep`) i opcjonalny `SENTRY_AUTH_TOKEN` w `.env.example`. Rollback = usunięcie `scripts/team-digest.ts`, wpisu w `package.json` i linii `.gitignore`.

## References

- Research: `context/changes/team-status-digest/research.md`
- Change identity: `context/changes/team-status-digest/change.md`
- Wzór skryptu: `scripts/seed-admin.ts:1-140`
- npm-script wzór: `package.json:20`
- Lint/hooki: `eslint.config.js:23`, `.claude/settings.json:8-17`
- Roadmap parsing: `context/foundation/roadmap.md:40-57`, `:101-292`
- Opportunity / walidacja: `context/foundation/opportunity-map.md`, `context/team/mom-test-validation.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase A: Mock-first digest

#### Automated

- [x] A.1 Plik mocka istnieje (`test -f context/team/digests/2026-06-29.md`)
- [x] A.2 Katalog ignorowany (`git check-ignore` zwraca ścieżkę)
- [x] A.3 `.gitkeep` jest śledzony

#### Manual

- [x] A.4 Sekcje i kolejność zgodne z „Desired End State"
- [x] A.5 Dane mocka zgodne z realnym stanem repo
- [x] A.6 Format „Decyzje na dziś" odtwarzalny regułami

### Phase B: Skrypt lokalny `scripts/team-digest.ts`

#### Automated

- [ ] B.1 Lint przechodzi (`npm run lint`)
- [ ] B.2 Type-check przechodzi (`npx astro check`)
- [ ] B.3 `npm run digest` tworzy datowany plik
- [ ] B.4 Uszkodzony `change.md` → exit 0, plik powstaje

#### Manual

- [ ] B.5 Wygenerowany plik odpowiada mockowi Fazy A
- [ ] B.6 Sekcja „W toku" poprawnie posortowana po dniach bez ruchu
- [ ] B.7 Rozjazd git↔frontmatter i mirror-drift pokazują realne rozbieżności
- [ ] B.8 Uszkodzony `change.md` ląduje w sekcji ⚠️
- [ ] B.9 „Decyzje na dziś" zawierają 1–3 sensowne pytania z linkami

### Phase C: Sygnały zewnętrzne (GitHub Actions + Sentry)

#### Automated

- [ ] C.1 Lint przechodzi (`npm run lint`)
- [ ] C.2 Type-check przechodzi (`npx astro check`)
- [ ] C.3 Bez `SENTRY_AUTH_TOKEN` skrypt kończy exit 0 i tworzy plik
- [ ] C.4 `.env.example` zawiera `SENTRY_AUTH_TOKEN`

#### Manual

- [ ] C.5 Z `gh` sekcja „CI" pokazuje realny ostatni run
- [ ] C.6 Z `SENTRY_AUTH_TOKEN` sekcja „Błędy" pokazuje realne issues (24h)
- [ ] C.7 Bez tokena / wylogowany `gh` → „niedostępne", digest dalej powstaje
