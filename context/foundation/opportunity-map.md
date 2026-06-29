# Mapa możliwości

## Kontekst

- **Projekt / kontekst**: Urlopy — aplikacja do zarządzania nieobecnościami (Astro 6 SSR + React 19 + Supabase + Drizzle + Cloudflare Workers, GitHub Actions CI, Sentry). Lekcja M5L1 „AI Internal Builders"; cel: cienki helper *uzupełniający*, nie zamiennik.
- **Ograniczenie danych**: lokalne pliki repo + publiczne API GitHub + Sentry — **tylko do odczytu, dane niewrażliwe, mock-first**.
- **Data**: 2026-06-29.

## Mapa

| Sygnał | Istniejąca / domyślna odpowiedź | Cienkie uzupełnienie | Pierwsza użyteczna wersja | Ryzyko danych | Kierunek, jeśli wartościowy |
|---|---|---|---|---|---|
| Brak jednego widoku „stan projektu dziś" (godzenie 5+ źródeł) | GitHub Projects / Linear cycles / dashboard CI — każdy zna część prawdy, żaden nie zna `change.md` | read-only digest godzący `change.md` + roadmap + git log (+opc. CI/Sentry), linkuje do źródeł | mock Markdown → skrypt `tsx` czytający repo → `digest.md` | lokalne / read-only / niewrażliwe | Narzędzie wewnętrzne (→ async/zdalne; → Agent zespołu) |
| Mirror-docs vs realny backlog (5 issues vs 18 zmian) | natywny sync GitHub↔Linear — nie zna `change.md`/roadmap | detektor „mirror drift" jako sekcja digestu | sekcja raportu #1 | lokalne / read-only / niewrażliwe | Narzędzie wewnętrzne (sekcja #1) |
| Zmiany utknięte bez ruchu (`admin-bootstrap` implementing od 2026-06-22) | brak — żaden SaaS nie czyta statusów `change.md` | sekcja „utknęło N dni" w digeście | sekcja raportu #1 | lokalne / read-only / niewrażliwe | Narzędzie wewnętrzne (sekcja #1) |
| Review bez twardych kryteriów | code owners, status checks, reguły repo, hooki M3L3 | klasyfikacja ryzyka PR + sugestia recenzenta (komentarz LLM) | komentarz agenta pod kilkoma PR-ami | read-only (diff) / niewrażliwe | Brama recenzji / CI → **Czekaj** (10xChampion M5L2/L3) |

## Zalecany pierwszy kandydat

```text
Kandydat:
Poranny digest statusu projektu Urlopy

Odczytuje:
context/changes/*/change.md (status, data), context/foundation/roadmap.md, git log (zmiany od wczoraj);
opcjonalnie GitHub Actions (ostatni run ci/deploy) i Sentry (nowe issues) przez MCP

Zwraca:
raport Markdown z sekcjami: „co się zmieniło od wczoraj", „co utknęło (status X od N dni)",
„rozjazdy (mirror-docs vs changes, CI vs stan lokalny)", „1–3 decyzje na dziś" — z linkami do źródeł

Nie robi:
nie zastępuje GitHub/Linear/CI; brak panelu, logowania, własnej bazy, harmonogramu, dwukierunkowego synca;
tylko czyta, streszcza i linkuje

Ryzyko danych:
lokalne pliki repo + publiczne API + Sentry tylko-do-odczytu; dane niewrażliwe; mock-first

Kierunek, jeśli okaże się wartościowy:
Narzędzie wewnętrzne (docelowo „Praca async/zdalna" — odpalany na harmonogramie/CI; ewentualnie „Agent zespołu", gdy dojdzie streszczanie LLM)
```

## Dlaczego ten kandydat

Spełnia wszystkie sześć kryteriów: (1) powtarza się codziennie, (2) łączy ≥2 źródła (`change.md` + roadmap + git + opc. CI/Sentry), (3) ma dziś realny ból ręczny (rozjazd 5 vs 18, `admin-bootstrap` wiszący od tygodnia), (4) testowalny read-only/mock, (5) nie przejmuje odpowiedzialności żadnej platformy (linkuje, nie zastępuje), (6) ma jasny dalszy kierunek. Sygnały #2 i #3 nie są osobnymi narzędziami — to sekcje tego samego digestu, co potwierdza, że wartość bierze się z *lokalnego połączenia* sygnałów, których pojedynczy SaaS nie widzi. Sygnał #4 (review) jest świadomie odłożony: to inny kształt („Brama recenzji / CI") i należy do ścieżki 10xChampion (M5L2/L3).

## Następny kierunek, jeśli wartościowy

Narzędzie wewnętrzne. Pierwsza wersja pozostaje skromna (skrypt + raport Markdown, bez utrzymania produktowego). Dopiero jeśli zespół zacznie planować dzień wokół digestu, awansuje do „Pracy async/zdalnej" (harmonogram, np. job CI generujący digest) lub „Agenta zespołu" (streszczanie LLM chaotycznych opisów). Sygnał #4 to naturalne wejście w „Bramę recenzji / CI" w kolejnych lekcjach.
