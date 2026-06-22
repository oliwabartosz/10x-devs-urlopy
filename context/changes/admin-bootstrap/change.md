---
id: admin-bootstrap
title: "S-11: Bootstrap konta admin z plików env"
status: implementing
created: 2026-06-22
updated: 2026-06-22
roadmap_id: S-11
prerequisites: [data-schema-and-rls, employee-management]
parallel_with: [dev-vars-rename]
---

# S-11: Bootstrap konta admin z plików env

**Outcome:** (tech/auth) pierwsze konto admina (rola: moderator) jest tworzone automatycznie z danych w `.env` / `.env.dev` (e-mail + hasło) przy starcie lub przez jednorazowy skrypt seed — bez potrzeby ręcznej rejestracji. Po wdrożeniu S-11 samorejestracja jest wyłączona: nowych użytkowników (pracowników i moderatorów) mogą dodawać wyłącznie moderatorzy. Konto admin jest kontem technicznym: niewidoczne w siatce miesięcznej, tabeli szczegółów i liście pracowników; nie może być usunięte przez innych moderatorów.

See `frame.md` for the framing analysis that scoped this change.
