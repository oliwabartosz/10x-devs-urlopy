---
date: 2026-06-29T10:22:36+02:00
researcher: Bartosz Oliwa
git_commit: 1361e99a0a5fd42d71f8479872f48986bfd19a13
branch: main
repository: oliwabartosz/10x-devs-urlopy
topic: "Jak zbudować poranny digest statusu projektu (cienki helper M5L1) — źródła danych, formaty parsowania, wzorce do reuse"
tags: [research, codebase, team-status-digest, internal-builder, m5l1]
status: complete
last_updated: 2026-06-29
last_updated_by: Bartosz Oliwa
---

# Research: Poranny digest statusu projektu (team-status-digest)

**Date**: 2026-06-29T10:22:36+02:00
**Researcher**: Bartosz Oliwa
**Git Commit**: 1361e99a0a5fd42d71f8479872f48986bfd19a13
**Branch**: main
**Repository**: oliwabartosz/10x-devs-urlopy

## Research Question

Jak zbudować read-only helper „poranny digest statusu" (lekcja M5L1, kandydat #1 z `context/foundation/opportunity-map.md`): jakie są dokładne źródła danych, ich formaty do parsowania oraz wzorce w repo do ponownego użycia? Co jest wykonalne w fazie A (mock), B (skrypt na realnych danych) i C (sygnały zewnętrzne)?

## Summary

Helper jest w pełni wykonalny **bez nowych zależności**. Trzy lokalne źródła (`context/changes/*/change.md`, `context/foundation/roadmap.md`, `git log`) wystarczają na sekcje „zmienione / utknięte / rozjazdy / decyzje". Kluczowe ryzyko parsowania: **frontmatter jest niespójny** (`change_id` vs `id`, `roadmap_id` vs `roadmap_ref`) i pole `updated:` bywa nieaktualizowane (często `== created`) — więc do wykrywania „utknięcia" i „zmian od wczoraj" **wiarygodnym źródłem jest git** (`git log -- context/changes/<id>/`), a frontmatter służy tylko jako deklarowany status. Fazy B/C zewnętrzne są dostępne (gh CLI uwierzytelniony; Sentry przez REST + token), ale opcjonalne.

## Detailed Findings

### Źródło 1 — change.md (status zmian)

- **Niespójny frontmatter** (do obsłużenia: akceptuj oba klucze):
  - `change_id` **lub** `id` (np. `context/changes/admin-bootstrap/change.md` używa `id:`, a `context/changes/crud-integrity/change.md` używa `change_id:`).
  - `roadmap_id` **lub** `roadmap_ref` (np. `details-subcards` → `roadmap_ref`, reszta → `roadmap_id`).
  - Stałe pola: `status`, `created`, `updated`, czasem `archived_at`, `prerequisites`, `parallel_with`, `prd_refs`.
- **Pełny zbiór statusów** (grep `^status:` po `context/changes/*` i `context/archive/*`): `new`, `planned`, `implementing`, `implemented`, `impl_reviewed`, `archived`.
- **Cykl życia (wywnioskowany)**: `new → planned → implementing → implemented → impl_reviewed` (`archived` to opcjonalny koniec w `context/archive/`).
- **Kubełki dla digestu**:
  - *W toku / potencjalnie utknięte*: `new`, `planned`, `implementing`.
  - *Dostarczone / done*: `implemented`, `impl_reviewed`.
  - *Historyczne*: `archived`.
- **Realny stan dziś (18 zmian)** — m.in.: `admin-bootstrap` = `implementing` (created=updated=2026-06-22), `urlop-balance` = `planned`, `urlop-planowany-category` i `hours-onsite-training-only` = `new`. To są kandydaci do sekcji „utknęło".
- ⚠️ `updated:` często równe `created:` → **nie ufać `updated` jako sygnałowi ruchu**; używać git.

### Źródło 2 — roadmap.md (status slice'ów)

- Tabela „At a glance" (`context/foundation/roadmap.md:40-57`): kolumny `ID | Change ID | Outcome | Prerequisites | PRD refs | Status`; statusy roadmapy: `done` / `proposed` / `planned` (inny słownik niż change.md!).
- Sekcje szczegółowe slice'ów (`roadmap.md:101-292`): nagłówki `### S-xx:` + linia `- **Status:** <done|proposed|planned>`.
- Parsowanie: z tabeli wyciągnij trójki `S-xx → change_id → status`. Tylko **6 z 18** zmian ma link do roadmapy (`team-status-digest`, `crud-integrity` są poza roadmapą) — digest musi to znieść (brak linku ≠ błąd).

### Źródło 3 — git log (ruch / „od wczoraj")

- **Conventional Commits ze scope = change-id**: `feat(admin-bootstrap): … (p3)`, `chore(dev-vars-rename): …`. Scope mapuje się 1:1 na folder `context/changes/<scope>/` (poza scope'ami nie-zmianowymi: `roadmap`, `lint`, `build`, `ai`).
- „Zmiany od wczoraj": `git log --since="yesterday" --oneline`.
- Ruch per zmiana: `git log -1 --format="%h %ai %s" -- context/changes/<id>/` → data ostatniego commita = podstawa „utknęło N dni".
- **Porównanie metod „od wczoraj"**: git `--since -- <path>` = HIGH (kanoniczne), `updated:` frontmatter = MEDIUM (zależne od dyscypliny), mtime plików = LOW (szum z linterów/testów). → digest opiera „ruch" na git.

### Źródło 4 — mirror-docs (rozjazd backlogu, sygnał #2)

- `context/foundation/tasks-github.md` i `tasks-linear.md` zawierają tabele issues (po **5 wierszy**, zamrożone 2026-05-25). Liczba zmian w `context/changes/` (~16 aktywnych) ≫ liczba wierszy mirror → **drift do zgłoszenia** (porównanie liczności + ewentualnie brakujące change-id).

### Sygnały zewnętrzne (faza B/C, opcjonalne)

- **GitHub Actions** (faza B): `gh` CLI v2.87.3, **uwierzytelniony** jako `oliwabartosz`, scope `repo, workflow, read:org`. Repo `oliwabartosz/10x-devs-urlopy`. Ostatni run CI: `gh api repos/oliwabartosz/10x-devs-urlopy/actions/runs`. (Brak nowych runów po 2026-06-22 — bo brak commitów.)
- **Sentry** (faza C): **brak MCP dla Sentry**; jest bezpośrednie API. Z `sentry.client.config.js`: org `o4511534802993152`, projekt `4511534806007888`, region `de.sentry.io`. Wymaga `SENTRY_AUTH_TOKEN` (dziś tylko jako secret CI, nie w `.env`).
- **Cloudflare MCP**: aktywne (`.mcp.json`, `enabledMcpjsonServers: ["cloudflare"]`) — opcjonalne, nie potrzebne do statusu.

## Code References

- `scripts/seed-admin.ts:1-140` — wzorzec standalone skryptu `tsx` do skopiowania.
- `scripts/seed-admin.ts:8-10` — komentarz: nie importować `@/lib/...` (czyta `astro:env/server`, działa tylko w Workerze).
- `scripts/seed-admin.ts:48` — `process.loadEnvFile()` (ładowanie `.env`).
- `scripts/seed-admin.ts:136-140` — `main().catch((err) => { console.error(...); process.exit(1); })`.
- `package.json:3` — `"type": "module"` (ESM).
- `package.json:20` — `"seed:admin": "tsx scripts/seed-admin.ts"` (wzór dla `"digest"`).
- `tsconfig.json:9-11` — alias `@/*` → `./src/*` (działa w tsx, ale unikać `@/lib` w skrypcie).
- `eslint.config.js:23` — `"no-console": "warn"` → każdy `console.*` wymaga `// eslint-disable-next-line no-console`.
- `.claude/settings.json:8-17` — PostToolUse: `npm run lint` + `npx astro check` po zapisie `.ts`; `vitest related` tylko dla `src/(lib|db|pages/api|tests)` (skrypty w `scripts/` NIE są testowane automatycznie).
- `.husky/pre-commit:1-9`, `.husky/pre-push:1-13` — lint-staged + testy; pre-push pełny lint + `test:run`.
- `context/foundation/roadmap.md:40-57` — tabela „At a glance"; `:101-292` — sekcje slice'ów ze `- **Status:**`.
- `.github/workflows/ci.yml` — joby `ci` + `deploy` (push do main).
- `.mcp.json`, `.claude/settings.local.json:54` — Cloudflare MCP aktywne.
- `sentry.client.config.js` — DSN → org/projekt/region Sentry.

## Architecture Insights

- **Zero-dependency parsing**: brak `yaml`/`gray-matter`/`glob` w `package.json`; `zod` i `tsx` są. Frontmatter jest płaski (`klucz: wartość`) → ręczny parser (regex/`split`) + walidacja `zod`. Globowanie: `fs.globSync` (Node 22+; tu Node 24).
- **Helper pozostaje skromny**: czyta, streszcza, **linkuje** do źródeł (ścieżki plików/PR/run). Nie jest nowym źródłem prawdy — zgodnie z M5L1 i `opportunity-map.md`.
- **Wiarygodność danych**: git jest kanoniczny dla „ruchu"; frontmatter dla „deklarowanego statusu"; rozbieżność git↔frontmatter to sama w sobie wartościowa sekcja digestu (potwierdza ryzyko #2 z `mom-test-validation.md`).
- **Lint-first**: skrypt musi przejść `npm run lint` + `npx astro check` natychmiast po zapisie (hooki). Minimalizować `console`; pisać raport przez `fs.writeFileSync` do `digest.md`.

## Historical Context (from prior changes)

- `context/foundation/opportunity-map.md` — kandydat #1 i klasyfikacja (digest jako uzupełnienie).
- `context/team/mom-test-validation.md` — kryteria go/no-go; ryzyko #2 (statusy zapominane) = dokładnie to, co digest wyłapuje.
- `scripts/seed-admin.ts` (zmiana `admin-bootstrap`) — jedyny istniejący standalone-skrypt; ustanawia wzorzec ESM/`tsx`/env/exit.
- `context/foundation/lessons.md` — jedyna lekcja dot. komponentów Astro/`Astro.locals`; nieistotna dla skryptu Node (odnotowane).

## Related Research

- Brak wcześniejszych `research.md` dotyczących narzędzi wewnętrznych/digestu (to pierwszy).

## Open Questions

1. **Definicja „utknięcia"**: próg N dni bez commita dla statusów `implementing`/`planned`/`new` (propozycja: 3 dni dla `implementing`, 7 dla `planned/new`) — do ustalenia w `/10x-plan`.
2. **„Od wczoraj" vs „od ostatniego uruchomienia”**: stałe okno (24h / `--since=yesterday`) czy zapamiętany znacznik ostatniego digestu? Dla pierwszej wersji: stałe okno (prostsze, bez stanu).
3. **Mock fixtures fazy A**: czy mockować na bazie realnego stanu repo (wiarygodniejsze demo), czy syntetyczne przykłady z lekcji? Propozycja: realny stan (pokazuje wartość od razu).
4. **Zakres fazy C**: czy w ogóle wchodzić w Sentry (wymaga `SENTRY_AUTH_TOKEN` lokalnie) — czy zostać na lokalne + GitHub Actions (gh już uwierzytelniony).
