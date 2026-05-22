---
project: "Urlopy"
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
created: 2026-05-18
updated: 2026-05-18
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "context type"
      decision: "greenfield"
    - topic: "pain category"
      decision: "spreadsheet friction; reporting gap"
    - topic: "primary persona"
      decision: "pracownik"
    - topic: "product insight"
      decision: "Excel lacks safe ownership; familiar grid matters; planned vs actual matters"
    - topic: "auth strategy"
      decision: "email and password login"
    - topic: "role model"
      decision: "Pracownik and Moderator"
    - topic: "MVP flow"
      decision: "monthly grid entry"
    - topic: "timeline budget"
      decision: "3 weeks after-hours target"
    - topic: "business logic rule"
      decision: "classify each absence entry by absence type and present it as a consistent color category with hours/comment metadata when provided"
    - topic: "product type"
      decision: "web app"
    - topic: "target scale"
      decision: "one department, max 10 people"
    - topic: "non-goals"
      decision: "no external integrations; no native mobile app; no separate stats visibility; no full leave planning MVP; no complex approval workflow"
    - topic: "secondary success criterion"
      decision: "moderator can use monthly details and statistics to verify absences without manually reconciling Excel"
    - topic: "absence type color mapping"
      decision: "wyjazd zagraniczny #2f578c; szkolenie poza miejsce pracy #10bbef; szkolenie w miejscu pracy #ffcc00; urlop #58873e; choroba #e50040; stala nieobecnosc #6f6f6f"
  frs_drafted: 8
  quality_check_status: accepted
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-06-08
  after_hours_only: false
---

## Vision & Problem Statement

Pracownicy i szefostwo zarzadzaja urlopami, chorobami, szkoleniami, wyjsciami poza miejsce pracy, wyjazdami zagranicznymi i stalymi nieobecnosciami w ukladzie podobnym do arkusza Excel. Obecny sposob pracy powoduje tarcie operacyjne i utrudnia raportowanie miesieczne oraz roczne.

Produkt ma zachowac znajomy widok siatki miesiecznej, do ktorego zespol jest przyzwyczajony, ale dodac bezpieczna wlasnosc pol: pracownik edytuje tylko swoje wpisy, a moderatorzy moga zarzadzac wszystkimi wpisami i pracownikami. Dodatkowa wartosc wynika z powiazania planu urlopow z faktyczna miesieczna ewidencja.

Pain: tarcie pracy w Excelu oraz luka w raportowaniu.
Person: pracownik.
Moment: kiedy pracownik musi wpisac albo sprawdzic swoja nieobecnosc w danym miesiacu.
Cost today: zespol korzysta z arkusza Excel, ktory nie pilnuje wlasnosci pol i wymaga recznej kontroli oraz raportowania.
Scale note: aplikacja jest dla jednego wydzialu, maksymalnie okolo 10 osob; 100x scale is not relevant to the MVP.

## User & Persona

Primary persona: pracownik, ktory w dniach roboczych planuje lub zglasza wlasne nieobecnosci i potrzebuje szybko wpisac typ nieobecnosci, godziny oraz komentarz bez zmiany danych innych osob.

Secondary persona: moderator / szefostwo, ktore moze edytowac wpisy wszystkich pracownikow oraz dodawac i usuwac pracownikow.

## Success Criteria

### Primary

- Pracownik loguje sie, wybiera miesiac i rok, dodaje wpis nieobecnosci we wlasnej komorce siatki miesiecznej, a wpis jest widoczny w siatce, tabeli szczegolow oraz statystykach dla tego miesiaca.

### Secondary

- Moderator moze uzyc miesiecznej tabeli szczegolow i statystyk, aby zweryfikowac nieobecnosci bez recznego uzgadniania danych w Excelu.

### Guardrails

- Pracownik nie moze edytowac wpisow innych pracownikow.
- Widok miesieczny pozostaje podobny do obecnego arkusza Excel.
- Widok i statystyki respektuja zalozenie, ze praca trwa od poniedzialku do piatku.

## User Stories

### US-01: Employee adds absence

- **Given** zalogowany pracownik i wybrany miesiac oraz rok
- **When** pracownik dodaje wpis nieobecnosci we wlasnej komorce widoku miesiecznego
- **Then** wpis jest widoczny w siatce miesiecznej, tabeli szczegolow i statystykach dla tego miesiaca

#### Acceptance Criteria

- Pracownik moze zapisac wpis tylko dla siebie.
- Wpis zawiera typ nieobecnosci oraz, gdy dotyczy, godziny lub komentarz.
- Po zapisie widok miesieczny, szczegoly i statystyki pokazuja ten sam wpis.

## Functional Requirements

- FR-001: Pracownik can view a monthly grid where days are rows and employees are columns. Priority: must-have
  > Socratic: Counter-argument considered: "No counter-argument." Resolution: kept as written.
- FR-002: Pracownik can add, edit, and delete their own absence entries. Priority: must-have
  > Socratic: Counter-argument considered: "No counter-argument." Resolution: kept as written.
- FR-003: Moderator can add, edit, and delete absence entries for all employees. Priority: must-have
  > Socratic: Counter-argument considered: "No counter-argument." Resolution: kept as written.
- FR-004: Pracownik can record absence entry metadata: absence type, hours or full-day value, comment, and optional substitute person for vacation. Priority: must-have
  > Socratic: Counter-argument considered: "Substitute not always known." Resolution: revised so the substitute person is optional.
- FR-005: Pracownik can view monthly and yearly statistics for recorded absences. Priority: must-have
  > Socratic: Counter-argument considered: "No counter-argument." Resolution: kept as written.
- FR-006: Pracownik can view a detailed monthly table with absence type, affected person, substitute, hours, comment, and creation date. Priority: must-have
  > Socratic: Counter-argument considered: "Creation date irrelevant." Resolution: kept, but creation date is less critical than the absence date and entry details.
- FR-007: Moderator can add and remove employees without deleting historical absence records. Priority: must-have
  > Socratic: Counter-argument considered: "Needs richer lifecycle." Resolution: revised so removal must not delete historical records.
- FR-008: Pracownik can enter leave plans with a priority marker. Priority: nice-to-have
  > Socratic: Counter-argument considered: "Not in primary flow." Resolution: kept as nice-to-have and outside the primary MVP flow.

## Non-Functional Requirements

- The product remains usable on current major desktop browser versions.
- The monthly grid remains readable for a workplace department of up to about 10 people.
- A user receives visible success or error feedback after saving an entry without noticeable waiting.
- A non-moderator cannot change entries belonging to another employee.

## Business Logic

The application classifies each absence entry by absence type and presents it in the monthly grid as a consistent color category with hours and comment metadata when provided.

The rule consumes the absence type selected by the user, the date in the monthly grid, optional hours or full-day value, and optional comment or substitute information. Its output is a visually consistent monthly cell that communicates the type of absence and exposes additional details without changing the familiar spreadsheet-like layout.

The rule applies to these absence types from the seed notes: wyjazd zagraniczny, szkolenie/wyjscie poza miejsce pracy, szkolenie w miejscu pracy, urlop, choroba, and stala nieobecnosc.

Accepted color mapping: wyjazd zagraniczny uses #2f578c, szkolenie/wyjscie poza miejsce pracy uses #10bbef, szkolenie w miejscu pracy uses #ffcc00, urlop uses #58873e, choroba uses #e50040, and stala nieobecnosc uses #6f6f6f.

## Access Control

Uzytkownicy loguja sie przez email i haslo.

- Pracownik moze dodawac, edytowac i usuwac tylko wpisy dotyczace jego wlasnej kolumny / osoby.
- Moderator moze dodawac, edytowac i usuwac wpisy wszystkich pracownikow.
- Moderator moze dodawac i usuwac pracownikow.
- Niezalogowany uzytkownik nie ma dostepu do widokow ewidencji, planu urlopow ani statystyk.

## Non-Goals

- The leave plan module is not required for the primary MVP flow; it remains nice-to-have unless pulled into scope later.
- No external integrations with other workplace platforms in the MVP.
- No native mobile application in the MVP; the first version is web-only.
- No separate statistics visibility rules for employees and moderators; statistics are general for everyone.
- No full leave-planning module in the primary MVP flow.
- No complex vacation approval workflow in the MVP.

## Open Questions

No open questions at this time.

## Quality cross-check

- Access Control: present.
- Business Logic: present.
- Project artifacts: present.
- Timeline-cost acknowledgement: present; MVP budget is 3 weeks.
- Non-Goals: present.
- Preserved behavior: n/a for greenfield.

## Forward: product-framing-notes

- Product surface: web app.
- Target scale: one department, up to about 10 people.
- Timing: target within 3 weeks, mixed after-hours and day-job work.
