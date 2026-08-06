---
change_id: main-page-redesign
title: Redesign the main sign-in page to the WRIFboard mockup
status: implemented
created: 2026-08-06
updated: 2026-08-06
archived_at: null
---

## Notes

Update the main page to match the provided mockup (see `target-design.png`).

The mockup is a centered sign-in card with:
- App logo (chart-in-circle icon) above a **WRIFboard** wordmark
- Subtitle: "Zaloguj się, aby uzyskać dostęp do panelu rynkowego"
- **Użytkownik / ID** field with a user icon, placeholder "np. U123456 lub login LDAP", and a trailing status/validation icon
- **Hasło** field with a lock icon
- Dark navy primary **"Zaloguj się"** button with a shield/check icon
- Footer line: "Wspiera logowanie przez **LDAP (Active Directory)** oraz konta lokalne."
- Copyright: "© 2026 WRIFboard. Wszystkie prawa zastrzeżone."
- Light gray page background, soft-shadowed white card

Open question to resolve in framing/planning: this mockup introduces a new brand (WRIFboard) and LDAP/Active Directory login, which differ from the current app. Confirm scope — pure visual restyle of the existing sign-in vs. also wiring up LDAP auth.
