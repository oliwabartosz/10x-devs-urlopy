---
project: Urlopy
created: 2026-05-25
repo: oliwabartosz/10x-devs-urlopy
---

# GitHub Issues — Urlopy

Backlog migrated from `context/foundation/roadmap.md` on 2026-05-25.

## Labels

| Label | Color | Purpose |
|---|---|---|
| `foundation` | `#7057ff` | Horizontal enabler (F-xx) |
| `slice` | `#0075ca` | Vertical user-visible slice (S-xx) |
| `status: ready` | `#0e8a16` | Can be started now |
| `status: proposed` | `#e4e669` | Blocked on prerequisite |
| `stream: A` | `#e99695` | Core grid + attendance chain |
| `stream: B` | `#f9d0c4` | Employee management chain |

## Issues

| # | Roadmap ID | Change ID | Title | Labels | Status |
|---|---|---|---|---|---|
| [#1](https://github.com/oliwabartosz/10x-devs-urlopy/issues/1) | F-01 | `data-schema-and-rls` | Schemat bazy danych i polityki RLS (employees, absences) | `foundation`, `status: ready`, `stream: A`, `stream: B` | open |
| [#2](https://github.com/oliwabartosz/10x-devs-urlopy/issues/2) | S-01 | `monthly-grid-own-absence` | Siatka miesięczna + dodaj/edytuj/usuń własną nieobecność | `slice`, `status: proposed`, `stream: A` | open |
| [#3](https://github.com/oliwabartosz/10x-devs-urlopy/issues/3) | S-04 | `employee-management` | Moderator: zarządzanie pracownikami (bez usuwania historii) | `slice`, `status: proposed`, `stream: B` | open |
| [#4](https://github.com/oliwabartosz/10x-devs-urlopy/issues/4) | S-02 | `details-and-stats` | Tabela szczegółów i statystyki miesięczne/roczne | `slice`, `status: proposed`, `stream: A` | open |
| [#5](https://github.com/oliwabartosz/10x-devs-urlopy/issues/5) | S-03 | `moderator-absence-management` | Moderator: edycja wpisów wszystkich pracowników | `slice`, `status: proposed`, `stream: A` | open |

## Dependency graph

```
#1 F-01 (data-schema-and-rls)  ← start here
├── #2 S-01 (monthly-grid-own-absence)
│   ├── #4 S-02 (details-and-stats)          ← parallel with #5
│   └── #5 S-03 (moderator-absence-management) ← parallel with #4
└── #3 S-04 (employee-management)             ← parallel with #2
```

## Issue body template

Each issue follows this structure:

```markdown
## Outcome
## PRD References
## Prerequisites
## Parallel with
## Risk
---
**Change ID:** `<id>`
**Roadmap ID:** <F-xx / S-xx>
**Stream:** <A / B>
```
