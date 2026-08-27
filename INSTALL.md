# Installing Urlopy on a self-hosted Linux VPS

Urlopy runs as a single Node process behind nginx, storing everything in one SQLite file. There is
no database server, no cloud account, and no runtime dependency on anything outside the box.

**The target VPS has no network access.** That is the constraint the whole procedure is shaped
around: you cannot `npm ci` there, so the artifact is built on a developer machine and copied
across whole — `node_modules` included.

---

## Why copying `node_modules` works

Normally you cannot move `node_modules` between machines: any dependency with a compiled addon
(`*.node`) is built for one specific platform, architecture, libc and Node ABI, and fails at
`require()` time anywhere else.

**Nothing Urlopy needs at runtime is compiled.** SQLite comes from `node:sqlite`, built into Node
24 itself; password hashing comes from `node:crypto`; the backup uses `node:sqlite`'s own
`backup()`. That is not an accident — it is the reason those choices were made — and it is what
lets the shipped `node_modules` move between any two Linux x64 machines running Node 24.

The tree on disk is a different story, and worth being precise about: `npm prune --omit=dev`
leaves **ten** native binaries behind (sharp, rollup, lightningcss, `@tailwindcss/oxide`), because
the Astro starter declares `astro`, `@tailwindcss/vite`, `@astrojs/cloudflare` and `wrangler` as
`dependencies`. Every one of those is used only while building. `npm run pack` excludes them and
then greps the finished tarball to prove none survived — so the archive really does contain zero
compiled modules, verified rather than assumed.

CI runs that same command on every push (`.github/workflows/ci.yml`, "Pack the offline artifact"),
so a dependency that brings a native addon fails there rather than on the VPS. `install.sh` checks
once more at install time.

---

## Prerequisites on the VPS

Install these before you start; the installer explicitly does **not**, because there is no package
source to install them from.

| Requirement | Why                                                                          |
| ----------- | ---------------------------------------------------------------------------- |
| Node ≥ 24   | `node:sqlite` (`DatabaseSync`, `backup()`) is only stable from 24. Pinned in `.nvmrc` to 24.15.0. |
| systemd     | The service and the backup timer are systemd units.                          |
| nginx       | TLS termination, static files, and the two headers Astro's origin check needs. |
| `runuser`   | Ships with util-linux. Used to run the database bootstrap as the service user. |

`install.sh` checks all of these and stops with an actionable message rather than failing halfway.

---

## 1. Build the artifact (developer machine)

```bash
nvm use                       # Node 24.15.0, per .nvmrc
npm ci

# The origin the browser will use. This is BAKED INTO THE BUILD — see the warning below.
export PUBLIC_ORIGIN=https://urlopy.internal

npm run build
```

`npm run build` runs `astro build` and then `scripts/build-artifact.mjs` (npm's `postbuild` hook),
producing:

```
dist/server/entry.mjs    the app
dist/client/             hashed static assets, served by nginx
dist/bootstrap.mjs       migrate + seed, bundled to plain JS (the VPS has no tsx)
dist/drizzle/            the migrations, copied so bootstrap.mjs can find them
dist/build-info.json     which origin this build was made for
```

> **`PUBLIC_ORIGIN` must be set at build time, not just on the VPS.**
> `astro.config.mjs` derives both `site` (baked into the sitemap) and `security.allowedDomains`
> from it. Build without it and the server trusts only `localhost`, so Astro's origin check
> rejects every form POST from the real hostname: **sign-in and sign-out return 403 while every
> other page and JSON route works perfectly.** That failure reads as a password problem, which is
> why `install.sh` compares `dist/build-info.json` against its own `--origin` and refuses to
> continue on a mismatch. Changing the origin later means rebuilding, not editing a config file.

Then prune to production dependencies and pack:

```bash
npm prune --omit=dev
npm run pack
```

That writes `urlopy-<timestamp>.tar.gz` (~98 MiB) containing `dist/`, `node_modules/`,
`package.json`, `deploy/`, `install.sh` and this file — and **fails** if a single compiled
`*.node` binary made it in.

> `npm prune --omit=dev` is not enough on its own. It leaves a 728 MiB tree with ten native
> binaries in it (sharp, rollup, lightningcss, `@tailwindcss/oxide`), because the Astro starter
> puts `astro`, `@tailwindcss/vite`, `@astrojs/cloudflare` and `wrangler` in `dependencies` rather
> than `devDependencies`. All of them are build-time only. `scripts/pack-artifact.mjs` carries the
> hand-maintained exclusion list and the check that proves it worked — read the comment at the top
> of that file before changing it.

`npm prune --omit=dev` leaves the tree without dev tooling. Run `npm ci` again before your next
`npm run lint` / `npm test`.

---

## 2. Copy and install (VPS)

```bash
# From wherever you can reach the box — USB, an internal jump host, a one-off scp.
scp urlopy-*.tar.gz you@vps:/tmp/

ssh you@vps
mkdir -p /tmp/urlopy-install && tar -xzf /tmp/urlopy-*.tar.gz -C /tmp/urlopy-install
cd /tmp/urlopy-install

sudo ./install.sh --db /var/lib/urlopy/urlopy.db --origin https://urlopy.internal
```

The installer prompts for the admin e-mail and password on a first install (the password is not
echoed and is never written to disk — the account lands in the database, and that is the only copy).
Pass `--admin-login` / `--admin-password` to script it, or `--help` for every option.

What it does:

1. Verifies Node 24, `node:sqlite`, systemd, `runuser`, and that the artifact is complete.
2. Creates the `urlopy` system user (no shell, no home).
3. Lays out `/opt/urlopy/releases/<timestamp>/`, `/var/lib/urlopy/`, `/var/backups/urlopy/`.
4. Writes `/etc/urlopy/env` (mode 0640, `root:urlopy`).
5. Copies the artifact into the release directory and points `/opt/urlopy/current` at it.
6. Renders and installs the three systemd units.
7. Runs `dist/bootstrap.mjs` **as the `urlopy` user** — migrates, seeds the seven absence types,
   creates the hidden `is_system` admin.
8. Enables and starts `urlopy.service` and `urlopy-backup.timer`, then reports whether the service
   actually came up.

---

## 3. nginx (by hand)

`install.sh` deliberately does not touch nginx — it cannot know what else this box serves or where
your certificates live.

```bash
sudo cp /opt/urlopy/current/deploy/nginx/urlopy.conf /etc/nginx/conf.d/urlopy.conf
sudo $EDITOR /etc/nginx/conf.d/urlopy.conf     # server_name, root, proxy_pass port
sudo nginx -t && sudo systemctl reload nginx
```

Three things in that file are load-bearing:

- **`proxy_set_header Host $host;`** and **`proxy_set_header X-Forwarded-Proto $scheme;`** — without
  both, Astro computes the wrong origin and 403s sign-in and sign-out.
- **`proxy_set_header X-Forwarded-For $remote_addr;`** — the sign-in throttle buckets by client IP;
  without it the whole office shares one bucket.
- **The security headers.** There is no `_headers` file in this repo and never was. On Cloudflare
  the edge supplied a baseline for free; nginx is now the only thing that can.

Open the origin and sign in as the seeded admin.

---

## Operating

```bash
systemctl status urlopy                 # is it up
journalctl -u urlopy -f                 # logs
systemctl restart urlopy                # after an env-file edit

systemctl list-timers urlopy-backup     # next backup
systemctl start urlopy-backup.service   # take one now
ls -lh /var/backups/urlopy              # snapshots (nightly 03:15, 14 kept)
```

`/etc/urlopy/env` holds `HOST`, `PORT`, `DATABASE_PATH`, `PUBLIC_ORIGIN` and the backup settings.
Everything there takes effect on restart **except `PUBLIC_ORIGIN`**, which is half a build-time
value — changing the origin for real needs a rebuild.

### Restoring a backup

Each snapshot is a single self-contained file with the WAL already folded in, so a restore is a
copy:

```bash
sudo systemctl stop urlopy

# Verify before overwriting anything.
sqlite3 /var/backups/urlopy/urlopy-20260826T031500Z.db 'PRAGMA integrity_check;'   # if sqlite3 is present
# or, with no sqlite3 on the box:
sudo -u urlopy node -e 'const{DatabaseSync}=require("node:sqlite");
  console.log(new DatabaseSync(process.argv[1],{readOnly:true}).prepare("PRAGMA integrity_check").get())' \
  /var/backups/urlopy/urlopy-20260826T031500Z.db

sudo -u urlopy cp /var/backups/urlopy/urlopy-20260826T031500Z.db /var/lib/urlopy/urlopy.db
sudo rm -f /var/lib/urlopy/urlopy.db-wal /var/lib/urlopy/urlopy.db-shm
sudo systemctl start urlopy
```

Removing the stale `-wal` / `-shm` sidecars matters: leaving them next to a replaced database file
is how you get a database that opens and then serves the *old* contents.

---

## Upgrading

Build and copy a new artifact exactly as above, then:

```bash
cd /tmp/urlopy-install-new
sudo ./install.sh
```

No flags needed. The installer reads `/etc/urlopy/env` and keeps the origin, port, database path
and backup settings the box is already using. It creates a **new** release directory, re-points
`/opt/urlopy/current`, re-runs the migrations (idempotent), and restarts the service. The database
is never touched beyond migrating it, and the admin seed no-ops because the `is_system` row exists.

Take a backup first anyway — migrations are the one irreversible step:

```bash
sudo systemctl start urlopy-backup.service
```

## Rolling back

Releases are kept, so a rollback is a symlink and a restart:

```bash
ls -1t /opt/urlopy/releases          # newest first; the one below the top is the previous
sudo ln -sfn /opt/urlopy/releases/<previous> /opt/urlopy/.current.new
sudo mv -T /opt/urlopy/.current.new /opt/urlopy/current
sudo systemctl restart urlopy
```

`install.sh` prints this exact command pair, filled in, if the service fails to start after an
upgrade.

**A rollback does not undo a migration.** Rolling the code back past a schema change leaves an
older build looking at a newer database. If the upgrade included one, restore the pre-upgrade
backup as well.

Prune old releases by hand when disk gets tight — each one carries a full `node_modules`:

```bash
ls -1t /opt/urlopy/releases | tail -n +4 | xargs -r -I{} sudo rm -rf /opt/urlopy/releases/{}
```

---

## Troubleshooting

| Symptom                                                        | Cause                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Sign-in returns 403, everything else works                     | `PUBLIC_ORIGIN` mismatch, or nginx is not sending `Host` / `X-Forwarded-Proto`. Rebuild with the right origin; check the proxy headers. |
| Sign-in succeeds, then bounces straight back to the login page | `PUBLIC_ORIGIN` says `https://` but the site is served over plain HTTP. The cookie is set `Secure` and the browser never sends it back. |
| One bad password locks out the whole office                    | nginx is not setting `X-Forwarded-For`, so every request throttles under the same key.      |
| `EACCES` on the database at startup                            | The database file is not owned by the service user. `chown -R urlopy:urlopy /var/lib/urlopy`. |
| Service will not start, `ERR_DLOPEN_FAILED` in the log         | A native module got into `node_modules`. Rebuild the artifact on a matching machine.        |
| `systemctl list-timers` shows the backup timer but no files    | The service user cannot write `URLOPY_BACKUP_DIR`. Check `journalctl -u urlopy-backup`.     |
