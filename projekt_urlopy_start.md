## Urlopy - MVP

### Główny problem
Utworzenie aplikacji pozwalającej na zarządzanie urlopami w pracy. Aplikacja webowa powinna składać się z dwóch głównych modułów:
1. Pierwszy moduł przedstawia widok miesięczny w formie tabeli, gdzie wiersze stanowią liczbę dni w miesiącu, a kolumny imiona i nazwiska pracowników. Pracownik może wybrać dany dzień i wstawić następującą informację:
["wyjazd zagraniczny", "szkolenie/wyjście poza miejsce pracy (podać godziny lub cały dzień)", "szkolenie w miejscu pracy (podać godziny lub cały dzień", "urlop (w komentarzu osoba zastępująca)", "choroba", "stała nieobecność"]. Pracownik powinien móc wypełniać tylko swoje pola w kolumnie, która jego dotyczy.
Szefostwo natomiast powinno móc edytować wszysktich - powinni mieć rolę Moderator. Praca trwa od poniedziałku do piątku. W UI dobrze żeby było widać godziny wyjścia i komentarz opatrzony symbolem, który podczas hover go wyświetli.
Wygląd modułu:
1. Filtry zarzadzające - wybór miesiąca i roku.
2. Poniżej tabela z imionami i nazwiskami pracowników jako nagłówki tabeli, dni miesiąca jako wiersze tabeli. W komórkach tabela z określonymi kolorami i ewentualnie godzinami i komentarzem
3. Poniżej statysyki, pokazujące statysyki za miesiąc i rok.
4. Poniżej szczegółowa tabela za dany miesiąc z typem "urlopu", kogo dotyczy, kto zastępuje, godziny, komentarz, data dodania.

Na obrazku przyklad_excel.png podano jak to obecnie wygląda w Excelu. Ważne, żeby zachować podobny widok, bo ludzie są do tego przyzwyczajeni.

2. Drugi moduł to plan urlopów - na obrazku pokazano jak to ma wyglądać, to jest podobnie jak w systemie docelowym, w którym pracownik wprowadza plany urlopów. 
Pracownik jednak powinien móc wprowadzić czy dany plan urlopu jest priorytetowy czy nie. Po uzupełnieniu planu urlopów w module pierwszym mogłaby być jakaś informacja albo ikonka odnośnie, że jest ten dzień został zaplanowany.

### Najmniejszy zestaw funkcjonalności
- UI w React
- Dodawanie, usuwanie, edytowanie urlopów przez pracowników i moderatorów,
- Prosty system Moderatora, który może dodawać, usuwać pracowników. 
- Estetyczny wygląd, który zachowuje następującą kolorystykę:
    /* Podstawowe */
    --color-primary: #072143;
    /* Granatowy */
    --color-primary-light: #c5ac75;
    /* Złoty (hover/accent) */
    --color-background: #ffffff;
    /* Biały */
    --color-surface: #ffffff;
    --color-border: #c8c8c8;
    /* Szara ramka */

    /* Text Colors */
    --color-text-main: #000000;
    /* Czarny */
    --color-text-sub: #6f6f6f;
    /* Szary */

    /* Chart Colors */
    --color-chart-0: #2f578c;
    /* Niebieski */
    --color-chart-1: #58873e;
    /* Zielony */
    --color-chart-2: #ffcc00;
    /* Żółty */
    --color-chart-3: #10bbef;
    /* Cyjanowy */
    --color-chart-4: #cc654e;
    /* Brązowy */
    --color-chart-5: #82368C;
    /* Jasnofioletowy */
    --color-chart-6: #afca0b;
    /* Jasnozielony */
    --color-chart-7: #6f6f6f;
    /* Szary */
    --color-chart-8: #e4aa94;
    /* Łososiowy */
    --color-chart-9: #e50040;
    /* Czerwony */

    /* Grid Color */
    --color-grid: #e8e8e8;
    /* Szare tło (zaadaptowane do siatki) */

    /* Typography */
    --font-display: "Arial", sans-serif;
    --font-body: "Arial", sans-serif;

    /* Border Radius */
    --radius-card: 0;
    /* Zakładam prosty styl, 'sharp' jak w NBP */
    --radius-btn: 0;


### Co NIE wchodzi w zakres MVP
- Integracje z innymi platformami w pracy
- Aplikacje mobilne (na początek tylko web)
- Podział statystyk widocznych dla wszystkich i moderatorów - statystyki będa ogólne dla wszystkich.

### Kryteria sukcesu
- Użytkownicy są w stanie dodawać, edytować, usuwać swoje urlopy.
- Moderatorzy mogą dodawać/edytować/usuwać użytkowników.
