#!/usr/bin/env bash
#
# Urlopy — install or upgrade on a prepared Linux VPS.
#
#   sudo ./install.sh --db /var/lib/urlopy/urlopy.db --origin https://urlopy.internal
#
# Run this from inside an extracted artifact directory (see INSTALL.md). It takes a machine that
# already has Node 24 and nginx from "artifact copied" to "service running".
#
# What it does NOT do, on purpose:
#   - install Node, nginx or anything else (the box is offline; there is no package source)
#   - touch the nginx configuration (see deploy/nginx/urlopy.conf — placed by hand)
#   - reach the network at any point
#
# Idempotent: re-running it upgrades in place. The database is never recreated, the env file's
# existing values are kept unless overridden on the command line, and the previous release is left
# on disk so a rollback is one symlink away.

set -euo pipefail

# --- Defaults --------------------------------------------------------------------------------
SERVICE_USER="urlopy"
APP_ROOT="/opt/urlopy"
ENV_FILE="/etc/urlopy/env"
DB_PATH=""
PUBLIC_ORIGIN=""
BACKUP_DIR="/var/backups/urlopy"
BACKUP_KEEP="14"
PORT="3000"
HOST="127.0.0.1"
ADMIN_LOGIN=""
ADMIN_PASSWORD=""
ASSUME_YES="no"

REQUIRED_NODE_MAJOR=24

# The directory this script was invoked from, resolved so the script works when called by path.
ARTIFACT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# --- Output ----------------------------------------------------------------------------------
info() { printf '\033[0;36m•\033[0m %s\n' "$*"; }
ok() { printf '\033[0;32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m!\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[0;31m✖\033[0m %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: sudo ./install.sh [options]

  --db PATH             SQLite database file (default: /var/lib/urlopy/urlopy.db)
  --origin URL          Public origin the browser sees, e.g. https://urlopy.internal
                        MUST match the PUBLIC_ORIGIN the artifact was built with.
  --app-root PATH       Install root (default: /opt/urlopy)
  --env-file PATH       Environment file (default: /etc/urlopy/env)
  --service-user NAME   System user to run as (default: urlopy)
  --port N              Loopback port for the Node process (default: 3000)
  --host ADDR           Loopback bind address (default: 127.0.0.1)
  --backup-dir PATH     Where nightly snapshots land (default: /var/backups/urlopy)
  --backup-keep N       How many snapshots to retain (default: 14)
  --admin-login EMAIL   Bootstrap admin address. Prompted if absent on a first install.
  --admin-password PW   Bootstrap admin password (min 8 chars). Prompted if absent.
  -y, --yes             Do not prompt; fail instead if a required value is missing.
  -h, --help            This text.

Anything already present in the env file is preserved unless overridden here.
USAGE
}

# --- Argument parsing ------------------------------------------------------------------------
need_value() { [[ -n "${2:-}" ]] || die "$1 requires a value."; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) need_value "$1" "${2:-}" && DB_PATH="$2" && shift 2 ;;
    --origin) need_value "$1" "${2:-}" && PUBLIC_ORIGIN="$2" && shift 2 ;;
    --app-root) need_value "$1" "${2:-}" && APP_ROOT="$2" && shift 2 ;;
    --env-file) need_value "$1" "${2:-}" && ENV_FILE="$2" && shift 2 ;;
    --service-user) need_value "$1" "${2:-}" && SERVICE_USER="$2" && shift 2 ;;
    --port) need_value "$1" "${2:-}" && PORT="$2" && shift 2 ;;
    --host) need_value "$1" "${2:-}" && HOST="$2" && shift 2 ;;
    --backup-dir) need_value "$1" "${2:-}" && BACKUP_DIR="$2" && shift 2 ;;
    --backup-keep) need_value "$1" "${2:-}" && BACKUP_KEEP="$2" && shift 2 ;;
    --admin-login) need_value "$1" "${2:-}" && ADMIN_LOGIN="$2" && shift 2 ;;
    --admin-password) need_value "$1" "${2:-}" && ADMIN_PASSWORD="$2" && shift 2 ;;
    -y | --yes) ASSUME_YES="yes" && shift ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

# --- Pre-flight ------------------------------------------------------------------------------
[[ "$(id -u)" -eq 0 ]] || die "Must run as root (use sudo)."

command -v systemctl >/dev/null 2>&1 || die "systemctl not found. This installer targets systemd hosts."
command -v runuser >/dev/null 2>&1 || die "runuser not found (it ships with util-linux). Needed to run the database bootstrap as the service user."

NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || die "Node.js is not installed or not on root's PATH. Install Node ${REQUIRED_NODE_MAJOR} first; this script cannot (the box is offline)."

NODE_VERSION="$("$NODE_BIN" --version)"      # e.g. v24.15.0
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [[ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]]; then
  die "Node ${NODE_VERSION} found at ${NODE_BIN}, but ${REQUIRED_NODE_MAJOR}+ is required. The app uses node:sqlite, which does not exist before 22 and is only stable from 24."
fi

# `node:sqlite` is what the whole storage layer is, so prove it loads rather than discovering it
# is missing three steps later during the migration. A Node built with --without-sqlite reports a
# perfectly good version number and fails only on import.
"$NODE_BIN" -e 'require("node:sqlite")' >/dev/null 2>&1 ||
  die "This Node build has no node:sqlite module (${NODE_VERSION} at ${NODE_BIN}). Urlopy cannot run on it."

for required in \
  "dist/server/entry.mjs" \
  "dist/client" \
  "dist/bootstrap.mjs" \
  "dist/drizzle" \
  "deploy/backup.mjs" \
  "deploy/urlopy.service" \
  "deploy/urlopy-backup.service" \
  "deploy/urlopy-backup.timer" \
  "node_modules" \
  "package.json"; do
  [[ -e "${ARTIFACT_DIR}/${required}" ]] ||
    die "Artifact is incomplete: ${required} is missing from ${ARTIFACT_DIR}. Rebuild with 'npm run build' and re-create the archive (see INSTALL.md)."
done

# A native module in the tree means the artifact was built for a different machine and copied
# rather than re-created. It would fail at require() time with an ELF header error that names the
# module and not the cause.
if find "${ARTIFACT_DIR}/node_modules" -name '*.node' -print -quit 2>/dev/null | grep -q .; then
  warn "The bundled node_modules contains compiled .node binaries. Urlopy itself needs none; if"
  warn "this artifact was built on a different architecture, the app will fail at startup."
fi

ok "Node ${NODE_VERSION} at ${NODE_BIN}; artifact at ${ARTIFACT_DIR} looks complete."

# --- Read back an existing install ------------------------------------------------------------
# Values already in the env file win over the defaults at the top of this script, but lose to
# anything passed on the command line. That is what makes an upgrade run safe with no arguments:
# `sudo ./install.sh` keeps the origin, port and database the box is already using.
read_env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

FIRST_INSTALL="yes"
if [[ -f "$ENV_FILE" ]]; then
  FIRST_INSTALL="no"
  info "Existing install detected (${ENV_FILE}); preserving its values where not overridden."
  [[ -n "$DB_PATH" ]] || DB_PATH="$(read_env_value DATABASE_PATH)"
  [[ -n "$PUBLIC_ORIGIN" ]] || PUBLIC_ORIGIN="$(read_env_value PUBLIC_ORIGIN)"
  existing_port="$(read_env_value PORT)"
  [[ -z "$existing_port" ]] || PORT="$existing_port"
  existing_host="$(read_env_value HOST)"
  [[ -z "$existing_host" ]] || HOST="$existing_host"
  existing_backup_dir="$(read_env_value URLOPY_BACKUP_DIR)"
  [[ -z "$existing_backup_dir" ]] || BACKUP_DIR="$existing_backup_dir"
  existing_keep="$(read_env_value URLOPY_BACKUP_KEEP)"
  [[ -z "$existing_keep" ]] || BACKUP_KEEP="$existing_keep"
fi

[[ -n "$DB_PATH" ]] || DB_PATH="/var/lib/urlopy/urlopy.db"

# --- Prompt for what is still missing ----------------------------------------------------------
prompt_for() {
  local var="$1" question="$2" silent="${3:-no}"
  [[ "$ASSUME_YES" != "yes" ]] || die "${var} is required and --yes was given, so I will not prompt for it."
  [[ -t 0 ]] || die "${var} is required but stdin is not a terminal. Pass it as a flag."
  local value=""
  if [[ "$silent" == "yes" ]]; then
    read -r -s -p "$question" value
    # To stderr: this function's stdout IS the captured value, so a newline written here would be
    # appended to the password.
    printf '\n' >&2
  else
    read -r -p "$question" value
  fi
  printf '%s' "$value"
}

if [[ -z "$PUBLIC_ORIGIN" ]]; then
  PUBLIC_ORIGIN="$(prompt_for PUBLIC_ORIGIN 'Public origin (e.g. https://urlopy.internal): ')"
  [[ -n "$PUBLIC_ORIGIN" ]] || die "PUBLIC_ORIGIN cannot be empty."
fi

[[ "$PUBLIC_ORIGIN" =~ ^https?://[^/]+$ ]] ||
  die "--origin must be a bare scheme+host with no trailing slash and no path, e.g. https://urlopy.internal (got: ${PUBLIC_ORIGIN})."

# The origin is baked into the build (astro.config.mjs derives `site` and
# `security.allowedDomains` from it), so a mismatch here cannot be fixed by editing the env file.
# Left undetected, the only symptom is a 403 on sign-in and sign-out while every JSON route works
# — which reads as a credentials problem and sends you looking in entirely the wrong place.
BUILD_INFO="${ARTIFACT_DIR}/dist/build-info.json"
if [[ -f "$BUILD_INFO" ]]; then
  BUILT_ORIGIN="$(sed -n 's/.*"publicOrigin"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BUILD_INFO")"
  if [[ -z "$BUILT_ORIGIN" ]]; then
    warn "This artifact was built with no PUBLIC_ORIGIN, so it only trusts localhost. Sign-in"
    warn "through nginx will return 403. Rebuild with PUBLIC_ORIGIN=${PUBLIC_ORIGIN} set."
  elif [[ "$BUILT_ORIGIN" != "$PUBLIC_ORIGIN" ]]; then
    die "Origin mismatch: the artifact was built for '${BUILT_ORIGIN}' but --origin says '${PUBLIC_ORIGIN}'. The origin is compiled into the build, so rebuild with PUBLIC_ORIGIN=${PUBLIC_ORIGIN} — changing it here would leave sign-in returning 403."
  fi
fi

# Only a first install needs an admin. On an upgrade the account already exists and the seed would
# no-op anyway, so do not prompt for a credential nobody needs to type twice.
if [[ "$FIRST_INSTALL" == "yes" && -z "$ADMIN_LOGIN" ]]; then
  ADMIN_LOGIN="$(prompt_for ADMIN_LOGIN 'Admin login (e-mail): ')"
  [[ -n "$ADMIN_LOGIN" ]] || die "ADMIN_LOGIN cannot be empty on a first install."
fi
if [[ -n "$ADMIN_LOGIN" && -z "$ADMIN_PASSWORD" ]]; then
  ADMIN_PASSWORD="$(prompt_for ADMIN_PASSWORD 'Admin password (min 8 chars, not echoed): ' yes)"
fi
if [[ -n "$ADMIN_LOGIN" && "${#ADMIN_PASSWORD}" -lt 8 ]]; then
  die "ADMIN_PASSWORD must be at least 8 characters."
fi

DB_DIR="$(dirname -- "$DB_PATH")"
ENV_DIR="$(dirname -- "$ENV_FILE")"

# --- Service user and layout -------------------------------------------------------------------
if id -u "$SERVICE_USER" >/dev/null 2>&1; then
  info "Service user ${SERVICE_USER} already exists."
else
  # A system account: no login shell, no home directory to litter, no password. It needs to own
  # exactly two directories and run one process.
  useradd --system --no-create-home --home-dir "$APP_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER" ||
    die "Failed to create service user ${SERVICE_USER}."
  ok "Created system user ${SERVICE_USER}."
fi

install -d -m 0755 -o root -g root "$APP_ROOT" "$APP_ROOT/releases"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DB_DIR" "$BACKUP_DIR"
install -d -m 0755 -o root -g root "$ENV_DIR"

# --- Env file ------------------------------------------------------------------------------------
# Written fresh each run from the resolved values, which is why the read-back above matters. Mode
# 0640 root:<service user>: the service reads it, nobody else on the box can.
#
# ADMIN_* are deliberately absent. They are passed to the bootstrap step as process environment
# below and never persisted — the account exists in the database after the first run, so leaving
# the plaintext password in a file on disk would buy nothing and cost a great deal.
# Created at its final mode before a byte is written, rather than written and then chmod'ed —
# otherwise the admin-adjacent contents exist world-readable for the width of one syscall.
install -m 0640 -o root -g "$SERVICE_USER" /dev/null "$ENV_FILE"
cat >"$ENV_FILE" <<ENVEOF
# Generated by install.sh on $(date -Is). Edit and 'systemctl restart urlopy' to change.
# Re-running install.sh preserves these values unless you override them with flags.

# Loopback only. nginx is the sole public listener; see deploy/nginx/urlopy.conf.
HOST=${HOST}
PORT=${PORT}

NODE_ENV=production

# The SQLite file. Created on first run and migrated on every start of install.sh.
DATABASE_PATH=${DB_PATH}

# The origin the browser sees. Drives the session cookie's Secure flag at runtime, and was baked
# into 'site' and 'security.allowedDomains' at build time — changing it needs a rebuild, not just
# a restart.
PUBLIC_ORIGIN=${PUBLIC_ORIGIN}

# Backup timer (deploy/backup.mjs).
URLOPY_BACKUP_DIR=${BACKUP_DIR}
URLOPY_BACKUP_KEEP=${BACKUP_KEEP}

# Sentry is unreachable from an offline box; leaving this unset disables the SDK cleanly.
# SENTRY_DSN=
ENVEOF
ok "Wrote ${ENV_FILE}."

# --- Release ---------------------------------------------------------------------------------
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"

if [[ "$ARTIFACT_DIR" == "$RELEASE_DIR" ]]; then
  die "Refusing to copy ${ARTIFACT_DIR} onto itself."
fi

info "Installing release ${RELEASE_ID}…"
install -d -m 0755 -o root -g root "$RELEASE_DIR"
# -a to preserve the executable bits inside node_modules/.bin. The trailing /. copies the contents
# rather than the directory itself.
cp -a "${ARTIFACT_DIR}/." "$RELEASE_DIR/"

# The app reads the database and nothing else it does not own. Code stays root-owned and
# read-only to the service user — a compromised request handler cannot rewrite its own bundle.
chown -R root:root "$RELEASE_DIR"
chmod -R go-w "$RELEASE_DIR"

PREVIOUS_RELEASE=""
if [[ -L "${APP_ROOT}/current" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "${APP_ROOT}/current")"
fi

# Atomic swap: `ln -sfn` to a temporary name then `mv` replaces the symlink in one syscall, so
# there is no instant where `current` does not resolve.
ln -sfn "$RELEASE_DIR" "${APP_ROOT}/.current.new"
mv -T "${APP_ROOT}/.current.new" "${APP_ROOT}/current"
ok "Release ${RELEASE_ID} is now current."

# --- systemd units ---------------------------------------------------------------------------
render_unit() {
  local src="$1" dest="$2"
  sed \
    -e "s|@NODE_BIN@|${NODE_BIN}|g" \
    -e "s|@APP_ROOT@|${APP_ROOT}|g" \
    -e "s|@SERVICE_USER@|${SERVICE_USER}|g" \
    -e "s|@ENV_FILE@|${ENV_FILE}|g" \
    -e "s|@DB_DIR@|${DB_DIR}|g" \
    -e "s|@BACKUP_DIR@|${BACKUP_DIR}|g" \
    "$src" >"$dest"
  chmod 0644 "$dest"
}

render_unit "${RELEASE_DIR}/deploy/urlopy.service" /etc/systemd/system/urlopy.service
render_unit "${RELEASE_DIR}/deploy/urlopy-backup.service" /etc/systemd/system/urlopy-backup.service
render_unit "${RELEASE_DIR}/deploy/urlopy-backup.timer" /etc/systemd/system/urlopy-backup.timer
systemctl daemon-reload
ok "systemd units installed."

# --- Migrate and seed --------------------------------------------------------------------------
# As the service user, so every file this creates (the database, its WAL sidecars) is owned by the
# account that has to write them afterwards. Running it as root leaves a root-owned database and
# the service fails on its first write with a bare EACCES.
info "Migrating database at ${DB_PATH}…"
#
# Exported into this shell rather than passed as `env VAR=... cmd` or interpolated into `su -c`:
# both of those put ADMIN_PASSWORD in a command line, where any user on the box can read it out of
# `ps` for as long as the migration runs. `runuser` without `-l` keeps the environment it is given.
export DATABASE_PATH="$DB_PATH"
export NODE_ENV=production
if [[ -n "$ADMIN_LOGIN" ]]; then
  export ADMIN_LOGIN ADMIN_PASSWORD
fi

if ! runuser -u "$SERVICE_USER" -- "$NODE_BIN" "${RELEASE_DIR}/dist/bootstrap.mjs"; then
  unset ADMIN_PASSWORD
  die "Database bootstrap failed. The release is installed but the service was not started; fix the error above and re-run."
fi
unset ADMIN_PASSWORD

# --- Start -----------------------------------------------------------------------------------
systemctl enable --now urlopy.service
systemctl enable --now urlopy-backup.timer

# Give the service a moment to either come up or fall over, then report which happened. Without
# this the script exits 0 while the unit is still in 'activating' and a crash-loop looks like a
# successful install.
sleep 2
if systemctl is-active --quiet urlopy.service; then
  ok "urlopy.service is running on ${HOST}:${PORT}."
else
  warn "urlopy.service did not come up. Recent log:"
  journalctl -u urlopy.service -n 30 --no-pager >&2 || true
  if [[ -n "$PREVIOUS_RELEASE" ]]; then
    warn "Previous release is still on disk. To roll back:"
    warn "  ln -sfn ${PREVIOUS_RELEASE} ${APP_ROOT}/.current.new && mv -T ${APP_ROOT}/.current.new ${APP_ROOT}/current && systemctl restart urlopy"
  fi
  die "Install did not complete cleanly."
fi

cat <<NEXT

$(ok "Urlopy ${RELEASE_ID} installed.")

  Service    systemctl status urlopy
  Logs       journalctl -u urlopy -f
  Backups    ${BACKUP_DIR} (nightly, keeping ${BACKUP_KEEP}); run one now with
             systemctl start urlopy-backup.service
  Rollback   ln -sfn <previous release> ${APP_ROOT}/current && systemctl restart urlopy

Next step — nginx is NOT configured by this script:

  cp ${APP_ROOT}/current/deploy/nginx/urlopy.conf /etc/nginx/conf.d/urlopy.conf
  \$EDITOR /etc/nginx/conf.d/urlopy.conf     # server_name, root, proxy_pass port
  nginx -t && systemctl reload nginx

Then open ${PUBLIC_ORIGIN} and sign in.
NEXT
