---
project: "Urlopy"
version: 1
status: draft
created: 2026-05-18
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
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

### Secondary persona

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

### Core Attendance

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

### Leave Planning

- FR-008: Pracownik can mark an absence of type `urlop` or `urlop planowany` as priority; the marker `[P]` is shown on the monthly grid chip, in the cell tooltip and legend, in the absence details view, and in the XLSX export. Priority: nice-to-have — **delivered 2026-08-31** by `context/changes/priority-absence-flag/`.
  > Socratic: Counter-argument considered: "Not in primary flow." Resolution: originally kept as nice-to-have and outside the primary MVP flow; amended 2026-08-31, when the marker shipped on its own, decoupled from the leave-plan module that stays a non-goal.
  > Scope (load-bearing, read before planning anything on top of this): the marker is **informational only**. It resolves no collision between absences, has no effect on the holiday balance, and appears in no statistic. That boundary is what made the item shippable after it had been parked three times on one unanswered question — "what does priority do when two absences collide?" (`context/archive/2026-08-07-huge-ui-ux-improvement/research.md:183-187`). The answer this requirement records is: nothing. Eligibility is limited to the two leave types above and is enforced in application code, not by a database constraint.

## Non-Functional Requirements

- The product remains usable on current major desktop browser versions.
- The monthly grid remains readable for a workplace department of up to about 10 people.
- A user receives visible success or error feedback after saving an entry without noticeable waiting.
- A non-moderator cannot change entries belonging to another employee.

## Business Logic

The application classifies each absence entry by absence type and presents it in the monthly grid as a consistent color category with hours and comment metadata when provided.

The rule consumes the absence type selected by the user, the date in the monthly grid, optional hours or full-day value, and optional comment or substitute information. Its output is a visually consistent monthly cell that communicates the type of absence and exposes additional details without changing the familiar spreadsheet-like layout.

The rule applies to these absence types from the seed notes: wyjazd zagraniczny, szkolenie/wyjscie poza miejsce pracy, szkolenie w miejscu pracy, urlop, choroba, and stala nieobecnosc.

Accepted color mapping (superseded 2026-08-07 by S-17 `huge-ui-ux-improvement`, which adopted the `new-design/` prototype palette). Each type now also carries an explicit foreground colour and an emoji icon, and the catalogue has a stable display order. All three live in `absence_types` alongside the colour — adding or recolouring a type is a data change, not a code change.

| Order | Type                                 | Background | Foreground | Icon |
| ----- | ------------------------------------ | ---------- | ---------- | ---- |
| 1     | urlop                                | #cceeff    | #0b5a72    | 🌴   |
| 2     | szkolenie/wyjscie poza miejsce pracy | #ffcc99    | #8a4a00    | 🏃🏼‍♂️‍➡️   |
| 3     | szkolenie w miejscu pracy            | #ffe8a8    | #7a5b00    | 🎓   |
| 4     | choroba                              | #2f578c    | #ffffff    | 🤒   |
| 5     | wyjazd zagraniczny                   | #f2a3a3    | #7d0d1c    | 🌍   |
| 6     | stala nieobecnosc                    | #ccffcc    | #2c5c2c    | 🚫   |
| 7     | urlop planowany                      | #99ccff    | #0b3f6b    | 📅   |

Note that `choroba` takes the navy `wyjazd zagraniczny` previously used; the icon, not the colour, is now the fast discriminator. `urlop planowany` (seeded by S-13) is included here — the superseded list predated it.

## Access Control

Uzytkownicy loguja sie przez email i haslo.

- Pracownik moze dodawac, edytowac i usuwac tylko wpisy dotyczace jego wlasnej kolumny / osoby.
- Moderator moze dodawac, edytowac i usuwac wpisy wszystkich pracownikow.
- Moderator moze dodawac i usuwac pracownikow.
- Moderator widzi statystyki wszystkich pracownikow; pozostali uzytkownicy widza w zakladce Statystyki
  wylacznie wlasne dane. Nie jest to pelna granica prywatnosci: siatka miesieczna i tabela szczegolow
  pozostaja wspolne dla calego zespolu, wiec te same dni nieobecnosci sa nadal widoczne. Znika wylacznie
  porownawczy, rankingowy widok statystyk (medale, macierz "kto wzial najwiecej dni").
- Niezalogowany uzytkownik nie ma dostepu do widokow ewidencji, planu urlopow ani statystyk.

## Non-Goals

- The leave plan module is not required for the primary MVP flow; it remains nice-to-have unless pulled into scope later. This does not cover FR-008's priority marker, which was delivered separately on 2026-08-31 as an informational flag on ordinary absence entries.
- No external integrations with other workplace platforms in the MVP.
- No native mobile application in the MVP; the first version is web-only.
- No full leave-planning module in the primary MVP flow.
- No complex vacation approval workflow in the MVP.

## Open Questions

No open questions at this time.
