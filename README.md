# Urlopy — absence tracking

An internal absence-tracking app for a single department (~10 people): a monthly grid of days ×
employees, a details table, monthly and yearly statistics, holiday-balance tracking, and an XLSX
export of the whole year. The UI is Polish and branded "Nieobecności".

Self-hosted: one Node process, one SQLite file, nginx in front. No database server, no cloud
account, no network access required on the host.

> **Branch note.** `main` still deploys to Cloudflare Workers against Supabase. The
> `sqlite-install` branch — described here — is the self-hosted target. Supabase and Cloudflare
> packages remain in `package.json` but are unused on this branch.

## Tech Stack

- [Astro](https://astro.build/) v6 — server-first rendering, `output: "server"`
- [React](https://react.dev/) v19 — islands, only where interactivity is needed
- [TypeScript](https://www.typescriptlang.org/) v5
- [Tailwind CSS](https://tailwindcss.com/) v4 + [shadcn/ui](https://ui.shadcn.com/) (new-york)
- [Drizzle ORM](https://orm.drizzle.team/) over `node:sqlite` — no compiled dependency
- `node:crypto` scrypt + opaque server-side sessions — no auth provider
- [`@astrojs/node`](https://docs.astro.build/en/guides/integrations-guide/node/) standalone, behind nginx

## Prerequisites

- **Node.js 24.15.0** (see `.nvmrc`). Node 24 is a hard floor, not a preference: the database layer is `node:sqlite`, and `hucre` (the XLSX writer) declares `engines: node >=24`.
- npm (comes with Node.js)

## Getting Started

```bash
nvm use
npm ci
cp .env.example .env      # set DATABASE_PATH; PUBLIC_ORIGIN can stay on localhost
npm run db:bootstrap      # create + migrate the database, seed types and the admin
npm run dev
```

`npm run db:bootstrap` reads `ADMIN_LOGIN` and `ADMIN_PASSWORD` from `.env` and creates the hidden
technical admin. It is idempotent — re-running is a no-op. Sign in as that admin to create
employees; there is no self-registration.

## Available Scripts

| Script                  | What it does                                                          |
| ----------------------- | --------------------------------------------------------------------- |
| `npm run dev`           | Astro dev server                                                      |
| `npm run build`         | Production build + the artifact `postbuild` step                      |
| `npm run preview`       | Preview the production build                                          |
| `npm run pack`          | Archive the offline install artifact (after `npm prune --omit=dev`)   |
| `npm run lint`          | ESLint with type-checked rules                                        |
| `npm run lint:fix`      | Auto-fix lint issues                                                  |
| `npm run lint:sh`       | shellcheck `install.sh`                                               |
| `npm run format`        | Prettier                                                              |
| `npm test`              | Vitest (watch)                                                        |
| `npm run test:run`      | Vitest (once)                                                         |
| `npm run db:generate`   | Generate a migration from schema changes                              |
| `npm run db:bootstrap`  | Migrate + seed catalogue + seed admin                                 |
| `npm run seed:admin`    | Just the admin seed                                                   |
| `npm run e2e`           | Playwright (still targets the deployed Workers app — see `AGENTS.md`) |

## Project Structure

```
.
├── src/
│   ├── db/            # Drizzle schema, sqlite-proxy driver, migrate + seed
│   ├── lib/
│   │   ├── auth/      # password hashing, sessions, rate limiting
│   │   └── services/  # modules that take a Db and run queries
│   ├── layouts/
│   ├── pages/
│   │   └── api/       # API endpoints
│   ├── components/    # Astro + React
│   └── tests/         # Vitest; each file owns a temp SQLite database
├── drizzle/           # generated migrations
├── deploy/            # systemd units, backup script, nginx template
├── scripts/           # build-artifact, pack-artifact, bootstrap, seed-admin
└── install.sh         # VPS installer
```

## Environment

Copy `.env.example` to `.env`. Two variables matter:

| Variable        | Purpose                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `DATABASE_PATH` | Filesystem path to the SQLite file. Created on first run.                  |
| `PUBLIC_ORIGIN` | The origin the browser sees. Drives the session cookie's `Secure` flag.    |

**`PUBLIC_ORIGIN` is half a build-time value.** `astro.config.mjs` bakes it into `site` and
`security.allowedDomains`, so changing the origin needs a rebuild, not a restart. A mismatch shows
up as a 403 on sign-in and sign-out while every other route works normally.

`ADMIN_LOGIN` / `ADMIN_PASSWORD` are consumed once, by the admin seed. `SENTRY_DSN` is optional and
unreachable from an offline host — leaving it unset disables the SDK cleanly.

## Deployment

See **[INSTALL.md](./INSTALL.md)** for the full procedure: building the artifact, copying it to an
offline VPS, `install.sh`, the nginx block, backups, restore, upgrade and rollback.

```bash
export PUBLIC_ORIGIN=https://urlopy.internal
npm ci && npm run build && npm prune --omit=dev && npm run pack
# copy the tarball across, extract, then:
sudo ./install.sh --db /var/lib/urlopy/urlopy.db --origin https://urlopy.internal
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR to `main`: lint, shellcheck,
tests, build, a smoke test against a locally-started server, and the offline artifact pack. There
is no deploy job — the VPS is unreachable from CI by design.

## Documentation

- `AGENTS.md` / `CLAUDE.md` — conventions for AI agents working in this repo
- `INSTALL.md` — self-hosted install and operations
- `context/foundation/` — PRD, roadmap, tech stack, infrastructure, lessons

## License

MIT
