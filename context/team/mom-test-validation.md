# Plan walidacji testu matki

## Pomysł wejściowy

Poranny digest statusu projektu Urlopy — cienki helper *uzupełniający* (read-only), który godzi
rozproszone źródła stanu projektu (`context/changes/*/change.md`, `roadmap.md`, git log, opcjonalnie
GitHub Actions i Sentry) w jeden raport Markdown: co się zmieniło, co utknęło, gdzie są rozjazdy,
jakie 1–3 decyzje na dziś. Walidowany w ramach lekcji M5L1.

## Hipotezy

- **Użytkownik/rola**: programista prowadzący projekt (dziś solo; docelowo mały zespół 2–4 osób + agent AI).
- **Tarcia**: żeby odtworzyć „stan projektu dziś", trzeba ręcznie zajrzeć w 5+ miejsc, które się rozjeżdżają.
- **Obecne obejście**: pamięć + `git log` + ręczne otwieranie `context/changes/*` i GitHub/Linear; mirror-docs aktualizowane ręcznie (i już nieaktualne: 5 issues vs 18 zmian).
- **Ryzykowne założenia**:
  1. *Rozjazd źródeł realnie kosztuje* (a nie jest jednorazową irytacją, którą rozwiązuje pamięć jednej osoby).
  2. *`change.md` to wiarygodne źródło prawdy o statusie* (statusy są aktualizowane na bieżąco, nie zapominane — a `admin-bootstrap` „implementing" od tygodnia może być właśnie dowodem, że NIE są).
  3. *Digest doda wartość ponad `git log`/GitHub* — czyli połączenie sygnałów pokaże coś, czego pojedyncze narzędzie nie pokazuje.
  4. *Mirror-drift to złożoność przypadkowa* (do skrócenia narzędziem), a nie istotna (świadoma, ręczna migawka, która ma swój powód).
- **Istniejące dowody**: mirror-docs zamrożone na 2026-05-25 (5 issues) vs 18 folderów zmian; `admin-bootstrap` w statusie `implementing` od 2026-06-22 — twarde, obserwowalne ślady rozjazdu w samym repo.

## Krytyka

- **Mylenie rozwiązania z problemem.** „Zbudujmy digest" to już rozwiązanie. Problemem jest „nie ufam statusowi bez otwierania kilku miejsc". Trzeba sprawdzić, czy ten brak zaufania realnie opóźnia decyzje, czy to estetyczna niewygoda.
- **Założenie oparte na przyszłej intencji.** Wartość digestu rośnie z liczbą osób i źródeł. Dla projektu solo część tarcia rozwiązuje pamięć jednej osoby — ryzyko, że budujesz pod *hipotetyczny* zespół, którego jeszcze nie ma.
- **Co obaliłoby sens budowy.** Jeśli przez tydzień ręcznego startu dnia digest nie pokazałby ani razu nic, czego byś sam nie wiedział z `git log` — problem nie jest wart kodu.
- **Co może już wystarczać.** `git log --since=yesterday`, widok GitHub Issues z filtrem, natywny sync GitHub↔Linear. Mirror-docs mogły być świadomą decyzją (zamrożony snapshot do lekcji), a nie zaniedbaniem — wtedy „drift" jest *istotny*, nie do naprawienia.
- **Mocny dowód do kontynuowania.** Digest na realnych danych repo wskazuje ≥1 rzecz wartą działania (utknięta zmiana, realny rozjazd CI vs stan), którą inaczej byś przeoczył lub zauważył później.

## Przewodnik po wywiadach

> Solo-uwaga: zadaj je sobie szczerze (fakty, nie życzenia) lub przyszłemu współpracownikowi, jeśli projekt urośnie. Pytania o przeszłe zachowanie, nie o opinie.

1. **Rozgrzewka**: Jak zwykle zaczynasz dzień pracy nad Urlopy — od czego konkretnie? (narzędzia, kolejność)
2. **Ostatnia historia**: Opisz ostatni raz, gdy nie byłeś pewien statusu jakiejś zmiany. Co zrobiłeś, żeby się dowiedzieć?
3. Ile miejsc otworzyłeś wtedy, zanim miałeś pewność? Które?
4. **Obecne obejście**: Kiedy ostatnio aktualizowałeś `tasks-github.md`/`tasks-linear.md`? Dlaczego (nie)?
5. Czy zdarzyło Ci się działać na nieaktualnym statusie (np. wrócić do „skończonej" zmiany albo pominąć utkniętą)? Opowiedz.
6. **Koszt bólu**: Ile czasu realnie zajmuje Ci złożenie obrazu „co się zmieniło od wczoraj"? Co Cię to kosztowało, gdy się pomyliłeś?
7. **Alternatywy**: Czego już próbowałeś, żeby to ogarnąć (skrypty, filtry, widoki, sync)? Dlaczego przestałeś/zostałeś?
8. Czy `git log` wystarcza? W którym momencie nie wystarcza?
9. **Sygnał decyzyjny**: Co musiałby pokazać taki raport, żebyś otwierał go codziennie, a nie raz?
10. **Drift**: Czy rozjazd mirror-docs vs `change.md` to dla Ciebie problem do rozwiązania, czy świadoma, akceptowana migawka?
11. **Zamknięcie**: Mogę podejrzeć Twój realny `digest.md` po pierwszym uruchomieniu i sprawdzić, czy coś przeoczyłeś?

Uzupełniające: „pokaż mi to na ekranie", „co zrobiłeś w następnym kroku", „jak często w ostatnim miesiącu".

## Ankieta

> Dla szerszego sygnału, gdyby projekt miał zespół. Pytanie przesiewowe odsiewa osoby spoza przepływu.

1. *(przesiewowe)* Jak często pracujesz nad kodem/issue tego projektu? (codziennie / kilka razy w tyg. / rzadziej / wcale)
2. Jak często musisz sprawdzić stan w ≥2 narzędziach, by wiedzieć „co się zmieniło"? (codziennie / co tydzień / rzadziej / nigdy)
3. Ile miejsc zwykle sprawdzasz, żeby ustalić status zmiany? (1 / 2 / 3 / 4+)
4. Kiedy ostatnio działałeś na nieaktualnym statusie? (w tym tyg. / w tym mies. / dawniej / nigdy)
5. Ile czasu dziennie zajmuje Ci „złożenie obrazu" stanu projektu? (0–2 min / 3–10 / 11–30 / 30+)
6. Czego dziś używasz do tego? (git log / GitHub / Linear / pamięć / nic / inne — jakie)
7. *(otwarte)* Opisz ostatnią konkretną sytuację, gdy rozjazd statusów Cię kosztował.
8. *(otwarte)* Co taki dzienny raport musiałby zawierać, żebyś go faktycznie używał?

## Kryteria decyzyjne

- **Kontynuuj**, jeśli: pierwsze uruchomienie na realnych danych repo wskazuje ≥1 rzecz wartą działania, którą inaczej byś przeoczył (utknięta zmiana / realny rozjazd) — ORAZ składanie obrazu stanu zajmuje dziś realnie >5 min lub zdarzyło się działanie na nieaktualnym statusie.
- **Zwęź zakres**, jeśli: wartościowa jest tylko jedna sekcja (np. „utknęło N dni”), a reszta dubluje `git log` → zbuduj tylko tę sekcję.
- **Nie buduj jeszcze**, jeśli: `git log` + GitHub w pełni wystarczają i digest nie pokazał nic nowego przez ~tydzień.
- **Najpierw wypróbuj istniejące narzędzie/proces**, jeśli: ból to głównie rozjazd GitHub↔Linear → włącz natywny sync; jeśli mirror-docs są nieaktualne z wyboru → usuń je lub oznacz jako snapshot, zamiast budować detektor driftu.
