---
project: Urlopy
created: 2026-05-25
workspace: bartorelli
linear_project_url: https://linear.app/bartorelli/project/urlopy-b67955381b3b
---

# Linear Issues — Urlopy

Backlog mirrored from `context/foundation/tasks-github.md` on 2026-05-25.

## Workspace

| Resource | Value |
|---|---|
| Workspace | bartorelli |
| Team | Bartorelli (`BAR`) |
| Project | [Urlopy](https://linear.app/bartorelli/project/urlopy-b67955381b3b) |

## Status mapping

GitHub labels `status: ready` / `status: proposed` are not recreated as Linear labels — Linear's native state field covers this.

| GitHub label | Linear state |
|---|---|
| `status: ready` | **Todo** |
| `status: proposed` | **Backlog** |

## Labels (team-scoped to Bartorelli)

| Label | Color | Purpose |
|---|---|---|
| `foundation` | `#7057ff` | Horizontal enabler (F-xx) |
| `slice` | `#0075ca` | Vertical user-visible slice (S-xx) |
| `stream: A` | `#e99695` | Core grid + attendance chain |
| `stream: B` | `#f9d0c4` | Employee management chain |

## Issues

| Linear ID | Roadmap ID | Change ID | Title | State | Labels | GitHub |
|---|---|---|---|---|---|---|
| [BAR-5](https://linear.app/bartorelli/issue/BAR-5) | F-01 | `data-schema-and-rls` | Schemat bazy danych i polityki RLS (employees, absences) | **Todo** | `foundation`, `stream: A`, `stream: B` | [#1](https://github.com/oliwabartosz/10x-devs-urlopy/issues/1) |
| [BAR-6](https://linear.app/bartorelli/issue/BAR-6) | S-01 | `monthly-grid-own-absence` | Siatka miesięczna + dodaj/edytuj/usuń własną nieobecność | **Backlog** | `slice`, `stream: A` | [#2](https://github.com/oliwabartosz/10x-devs-urlopy/issues/2) |
| [BAR-7](https://linear.app/bartorelli/issue/BAR-7) | S-04 | `employee-management` | Moderator: zarządzanie pracownikami (bez usuwania historii) | **Backlog** | `slice`, `stream: B` | [#3](https://github.com/oliwabartosz/10x-devs-urlopy/issues/3) |
| [BAR-8](https://linear.app/bartorelli/issue/BAR-8) | S-02 | `details-and-stats` | Tabela szczegółów i statystyki miesięczne/roczne | **Backlog** | `slice`, `stream: A` | [#4](https://github.com/oliwabartosz/10x-devs-urlopy/issues/4) |
| [BAR-9](https://linear.app/bartorelli/issue/BAR-9) | S-03 | `moderator-absence-management` | Moderator: edycja wpisów wszystkich pracowników | **Backlog** | `slice`, `stream: A` | [#5](https://github.com/oliwabartosz/10x-devs-urlopy/issues/5) |

## Relationships

| Issue | Blocked by | Related to (parallel) |
|---|---|---|
| BAR-5 (F-01) | — | — |
| BAR-6 (S-01) | BAR-5 | BAR-7 |
| BAR-7 (S-04) | BAR-5 | BAR-6 |
| BAR-8 (S-02) | BAR-6 | BAR-9 |
| BAR-9 (S-03) | BAR-5, BAR-6 | BAR-8 |

## Dependency graph

```
BAR-5 F-01 (data-schema-and-rls)  ← Todo, start here
├── BAR-6 S-01 (monthly-grid-own-absence)
│   ├── BAR-8 S-02 (details-and-stats)            ← related to BAR-9
│   └── BAR-9 S-03 (moderator-absence-management) ← related to BAR-8
└── BAR-7 S-04 (employee-management)              ← related to BAR-6
```

## Issue body template

Each issue mirrors the GitHub body structure with a GitHub back-link:

```markdown
## Outcome
## PRD References
## Prerequisites
## Parallel with
## Risk
---
**Change ID:** `<id>`
**Roadmap ID:** <F-01 / S-xx>
**Stream:** <A / B>
**GitHub:** <link to GH issue>
```

Each issue also carries a link attachment pointing to its corresponding GitHub issue.
