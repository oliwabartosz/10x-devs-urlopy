# Follow-ups from the implementation review

Queued from `context/changes/favicon-ui-improvement/reviews/impl-review.md` (2026-09-02).

## F9 — Pin the server timezone in the systemd units

**Where**: `deploy/urlopy.service`, `deploy/user/urlopy.service` (and the two backup units, which
share the same `EnvironmentFile=@ENV_FILE@` shape at `deploy/urlopy-backup.service:18` and
`deploy/user/urlopy-backup.service:15`).

**Problem**: no unit sets `TZ`, so the Node process inherits whatever the VPS's system timezone is.
Every server-side "today" in the app is therefore unpinned. This is pre-existing, not introduced by
`favicon-ui-improvement` — but the review surfaced it there, because the new "Wróć do bieżącego
miesiąca" control is the third consumer of a server-local `now`:

- `src/pages/dashboard.astro:29` → the default month when `?month=` is absent, **and** the new
  `currentMonthStr` at `:226`. These two read the same binding, so they can never disagree with each
  other — the control always returns you to exactly the month the app calls current. That part is
  correct and needs no change.
- `src/pages/dashboard.astro:39` → `balanceYear`.
- `src/components/absence/AbsenceDetailsSubcards.tsx:28` → computes "today" in the **browser**, not
  on the server. This is the actual split: for an hour or two around a month or year boundary, a
  UTC-hosted server and a `Europe/Warsaw` client disagree about what day it is.

**Fix**: add `Environment=TZ=Europe/Warsaw` to the unit files (above the existing
`EnvironmentFile=` line, so `/etc/urlopy/env` can still override it). One line resolves the
month-nav case, the `balanceYear` case and the subcard split together.

**Why not done in this change**: it edits deployment units, which no phase of the plan touches, and
it needs an `INSTALL.md` note plus a `systemctl daemon-reload` on upgrade. Out of scope for a UI
polish change; sized as its own small change.

**Not blocking**: if the VPS's system timezone is already `Europe/Warsaw` (the likely case for an
NBP-hosted box), there is no live symptom today — the risk is that nothing records the dependency.
Check with `timedatectl` on the VPS before sizing this.
