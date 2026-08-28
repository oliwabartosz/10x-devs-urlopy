#!/usr/bin/env bash
#
# Urlopy — install or upgrade WITHOUT root, into the invoking user's home directory.
#
#   ./install-user.sh --origin http://analiza-p.vm.cen:3000
#
# The rootless sibling of install.sh, for a box where you have an account but no sudo. Everything
# the root installer puts in /opt, /etc and /var goes under ~/urlopy instead, and the three
# systemd units become `systemctl --user` units in ~/.config/systemd/user.
#
# What you give up by not having root, and cannot get back from inside this script:
#   - nginx. The Node process is the public listener, so it binds 0.0.0.0 rather than loopback
#     and serves its own static files. The security headers in deploy/nginx/urlopy.conf have no
#     equivalent here; there is nothing in front of the app to add them.
#   - An open firewall port. `firewall-cmd --add-port` needs root. Until somebody runs it the app
#     answers only from the box itself.
#   - Lingering, usually. Without it the user manager — and therefore the app and the backup
#     timer — is torn down when your last session ends. This script tries to enable it and tells
#     you plainly if it could not.
#
# Idempotent, exactly like install.sh: re-running upgrades in place, the database is never
# recreated, env values are preserved unless overridden, and the previous release stays on disk.

set -euo pipefail

# --- Defaults --------------------------------------------------------------------------------
APP_ROOT="${HOME}/urlopy"
ENV_FILE=""
DB_PATH=""
BACKUP_DIR=""
PUBLIC_ORIGIN=""
BACKUP_KEEP="14"
PORT="3000"
# 0.0.0.0, not 127.0.0.1: with no reverse proxy in front, loopback would make the app reachable
# only from the box itself.
HOST="0.0.0.0"
ADMIN_LOGIN=""
ADMIN_PASSWORD=""
ASSUME_YES="no"
SANDBOX="yes"

REQUIRED_NODE_MAJOR=24

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
Usage: ./install-user.sh [options]        (no sudo — see install.sh for the root install)

  --origin URL          Public origin the browser sees, e.g. http://host.internal:3000
                        MUST match the PUBLIC_ORIGIN the artifact was built with, PORT INCLUDED,
                        because nothing proxies port 80 to the app in this variant.
  --db PATH             SQLite database file (default: <app-root>/data/urlopy.db)
  --app-root PATH       Install root (default: ~/urlopy)
  --env-file PATH       Environment file (default: <app-root>/env)
  --port N              Port the Node process listens on (default: 3000)
  --host ADDR           Bind address (default: 0.0.0.0 — there is no proxy in front)
  --backup-dir PATH     Where nightly snapshots land (default: <app-root>/backups)
  --backup-keep N       How many snapshots to retain (default: 14)
  --admin-login EMAIL   Bootstrap admin address. Prompted if absent on a first install.
  --admin-password PW   Bootstrap admin password (min 8 chars). Prompted if absent.
  --no-sandbox          Skip the namespace-dependent hardening drop-ins from the start.
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
    --port) need_value "$1" "${2:-}" && PORT="$2" && shift 2 ;;
    --host) need_value "$1" "${2:-}" && HOST="$2" && shift 2 ;;
    --backup-dir) need_value "$1" "${2:-}" && BACKUP_DIR="$2" && shift 2 ;;
    --backup-keep) need_value "$1" "${2:-}" && BACKUP_KEEP="$2" && shift 2 ;;
    --admin-login) need_value "$1" "${2:-}" && ADMIN_LOGIN="$2" && shift 2 ;;
    --admin-password) need_value "$1" "${2:-}" && ADMIN_PASSWORD="$2" && shift 2 ;;
    --no-sandbox) SANDBOX="no" && shift ;;
    -y | --yes) ASSUME_YES="yes" && shift ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

# Defaults that depend on APP_ROOT have to wait until the flags are parsed.
[[ -n "$ENV_FILE" ]] || ENV_FILE="${APP_ROOT}/env"
[[ -n "$BACKUP_DIR" ]] || BACKUP_DIR="${APP_ROOT}/backups"

# --- Pre-flight ------------------------------------------------------------------------------
# The inverse of install.sh's check. Running this as root would scatter a "rootless" install
# through /root and leave units in root's user manager, which is nobody's intent.
[[ "$(id -u)" -ne 0 ]] || die "Do not run this as root — it installs into \$HOME. Use ./install.sh for the system-wide install."

command -v systemctl >/dev/null 2>&1 || die "systemctl not found. This installer targets systemd hosts."

# A user manager needs a session bus to talk to. Over plain ssh with lingering off this is the
# thing that is missing, and every later `systemctl --user` call would fail with a bare
# "Failed to connect to bus" — worth naming up front.
if ! systemctl --user show-environment >/dev/null 2>&1; then
  die "No systemd user manager for $(id -un) (systemctl --user cannot reach its bus).
     Usually XDG_RUNTIME_DIR is unset because this is a non-login shell, or lingering is off and
     you have no active session. Try logging in over ssh directly rather than via su/sudo -u."
fi

NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || die "Node.js is not installed or not on your PATH. Install Node ${REQUIRED_NODE_MAJOR} first; this script cannot (the box is offline)."
# Resolved to an absolute real path: it is written into ExecStart= of both units, where a relative
# name or a symlink into a directory that later moves would break the service at next boot.
NODE_BIN="$(readlink -f "$NODE_BIN")"

NODE_VERSION="$("$NODE_BIN" --version)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [[ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]]; then
  die "Node ${NODE_VERSION} found at ${NODE_BIN}, but ${REQUIRED_NODE_MAJOR}+ is required. The app uses node:sqlite, which does not exist before 22 and is only stable from 24."
fi

# `node:sqlite` is what the whole storage layer is, so prove it loads rather than discovering it
# is missing three steps later during the migration.
"$NODE_BIN" -e 'require("node:sqlite")' >/dev/null 2>&1 ||
  die "This Node build has no node:sqlite module (${NODE_VERSION} at ${NODE_BIN}). Urlopy cannot run on it."

for required in \
  "dist/server/entry.mjs" \
  "dist/client" \
  "dist/bootstrap.mjs" \
  "dist/drizzle" \
  "deploy/backup.mjs" \
  "deploy/user/urlopy.service" \
  "deploy/user/urlopy-backup.service" \
  "deploy/user/urlopy-backup.timer" \
  "node_modules" \
  "package.json"; do
  [[ -e "${ARTIFACT_DIR}/${required}" ]] ||
    die "Artifact is incomplete: ${required} is missing from ${ARTIFACT_DIR}. Rebuild with 'npm run build' and re-create the archive (see INSTALL.md)."
done

if find "${ARTIFACT_DIR}/node_modules" -name '*.node' -print -quit 2>/dev/null | grep -q .; then
  warn "The bundled node_modules contains compiled .node binaries. Urlopy itself needs none; if"
  warn "this artifact was built on a different architecture, the app will fail at startup."
fi

ok "Node ${NODE_VERSION} at ${NODE_BIN}; artifact at ${ARTIFACT_DIR} looks complete."

# --- Read back an existing install ------------------------------------------------------------
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

[[ -n "$DB_PATH" ]] || DB_PATH="${APP_ROOT}/data/urlopy.db"

# --- Prompt for what is still missing ----------------------------------------------------------
prompt_for() {
  local var="$1" question="$2" silent="${3:-no}"
  [[ "$ASSUME_YES" != "yes" ]] || die "${var} is required and --yes was given, so I will not prompt for it."
  [[ -t 0 ]] || die "${var} is required but stdin is not a terminal. Pass it as a flag."
  local value=""
  if [[ "$silent" == "yes" ]]; then
    read -r -s -p "$question" value
    printf '\n' >&2
  else
    read -r -p "$question" value
  fi
  printf '%s' "$value"
}

if [[ -z "$PUBLIC_ORIGIN" ]]; then
  PUBLIC_ORIGIN="$(prompt_for PUBLIC_ORIGIN 'Public origin (e.g. http://host.internal:3000): ')"
  [[ -n "$PUBLIC_ORIGIN" ]] || die "PUBLIC_ORIGIN cannot be empty."
fi

[[ "$PUBLIC_ORIGIN" =~ ^https?://[^/]+$ ]] ||
  die "--origin must be a bare scheme+host[:port] with no trailing slash and no path, e.g. http://host.internal:3000 (got: ${PUBLIC_ORIGIN})."

# With no proxy, the browser talks to PORT directly, so the origin has to name it. Getting this
# wrong is survivable — astro.config.mjs derives allowedDomains from hostname and protocol only,
# ignoring the port — but the sitemap and any absolute URL would be wrong, so say so.
if [[ "$PORT" != "80" && "$PORT" != "443" && "$PUBLIC_ORIGIN" != *":${PORT}" ]]; then
  warn "PUBLIC_ORIGIN (${PUBLIC_ORIGIN}) does not end in :${PORT}, and nothing proxies to the app"
  warn "in this variant. Unless something else forwards that port, the browser will need the port"
  warn "in the URL. Sign-in still works — Astro's origin check ignores the port — but 'site' is wrong."
fi

# A box that already runs other services is the normal case for this variant — you are a guest on
# it, not its owner. Binding a port something else holds fails inside systemd, where the error
# surfaces as a restart loop in the journal rather than on this terminal, so check it here while
# there is still somebody reading. Skipped on an upgrade: the port is ours, held by the running
# instance we are about to replace.
if command -v ss >/dev/null 2>&1 && [[ "$FIRST_INSTALL" == "yes" ]]; then
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "(^|:)${PORT}\$"; then
    die "Port ${PORT} is already in use on this host. Pick a free one with --port N (and rebuild
     the artifact with a matching PUBLIC_ORIGIN if nothing proxies to it). Currently listening:
$(ss -ltn 2>/dev/null | awk 'NR>1 {print "       " $4}' | sort -u)"
  fi
fi

BUILD_INFO="${ARTIFACT_DIR}/dist/build-info.json"
if [[ -f "$BUILD_INFO" ]]; then
  BUILT_ORIGIN="$(sed -n 's/.*"publicOrigin"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BUILD_INFO")"
  if [[ -z "$BUILT_ORIGIN" ]]; then
    warn "This artifact was built with no PUBLIC_ORIGIN, so it only trusts localhost. Sign-in from"
    warn "another machine will return 403. Rebuild with PUBLIC_ORIGIN=${PUBLIC_ORIGIN} set."
  elif [[ "$BUILT_ORIGIN" != "$PUBLIC_ORIGIN" ]]; then
    die "Origin mismatch: the artifact was built for '${BUILT_ORIGIN}' but --origin says '${PUBLIC_ORIGIN}'. The origin is compiled into the build, so rebuild with PUBLIC_ORIGIN=${PUBLIC_ORIGIN} — changing it here would leave sign-in returning 403."
  fi

  # The mount path is baked in just as hard, and there is nothing on this side to compare it
  # against — the proxy that routes to it is nginx's business, not the installer's. Report it, so
  # whoever edits the nginx block is reading the value from the artifact rather than remembering
  # it. A mismatch here serves the first page and then 404s every asset and every fetch.
  BUILT_BASE="$(sed -n 's/.*"basePath"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BUILD_INFO")"
  if [[ -n "$BUILT_BASE" ]]; then
    info "This artifact is built to be served under ${BUILT_BASE}/ — the nginx location must match, and proxy_pass must carry NO trailing slash (see deploy/nginx/urlopy-location.conf)."
  fi
fi

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
UNIT_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"

# --- Layout ------------------------------------------------------------------------------------
# No -o/-g: everything here is owned by the invoking user by construction. 0700 on the data and
# backup directories is the whole access-control story in this variant — there is no service
# account to separate from, so the only boundary left is "other users on the box cannot read it".
mkdir -p "$APP_ROOT" "${APP_ROOT}/releases" "$ENV_DIR" "$UNIT_DIR"
mkdir -p "$DB_DIR" "$BACKUP_DIR"
chmod 0700 "$DB_DIR" "$BACKUP_DIR"

# --- Env file ------------------------------------------------------------------------------------
# ADMIN_* are deliberately absent: they are passed to the bootstrap step as process environment
# below and never persisted.
# Created at its final mode before a byte is written, rather than written and then chmod'ed.
install -m 0600 /dev/null "$ENV_FILE"
cat >"$ENV_FILE" <<ENVEOF
# Generated by install-user.sh on $(date -Is). Edit and 'systemctl --user restart urlopy'.
# Re-running install-user.sh preserves these values unless you override them with flags.

# There is no reverse proxy in this variant, so the app is the public listener.
HOST=${HOST}
PORT=${PORT}

NODE_ENV=production

# The SQLite file. Created on first run and migrated on every run of install-user.sh.
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
# Extracting the artifact *inside* APP_ROOT and then copying it into APP_ROOT/releases would
# recurse. The root installer cannot hit this (it installs to /opt, you extract to /tmp); here the
# natural thing to do is extract into the home directory, so it is worth catching.
case "$RELEASE_DIR/" in
  "$ARTIFACT_DIR"/*) die "Refusing to install: ${RELEASE_DIR} sits inside the artifact directory ${ARTIFACT_DIR}. Extract the archive somewhere outside ${APP_ROOT} (e.g. ~/urlopy-install) and re-run." ;;
esac

info "Installing release ${RELEASE_ID}…"
mkdir -p "$RELEASE_DIR"
# -a to preserve the executable bits inside node_modules/.bin. The trailing /. copies the contents
# rather than the directory itself.
cp -a "${ARTIFACT_DIR}/." "$RELEASE_DIR/"
# Code is not writable by the process running out of it where the sandbox drop-in applies, and not
# writable by anyone else regardless.
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

# --- systemd user units ------------------------------------------------------------------------
render_unit() {
  local src="$1" dest="$2"
  sed \
    -e "s|@NODE_BIN@|${NODE_BIN}|g" \
    -e "s|@APP_ROOT@|${APP_ROOT}|g" \
    -e "s|@ENV_FILE@|${ENV_FILE}|g" \
    -e "s|@DB_DIR@|${DB_DIR}|g" \
    -e "s|@BACKUP_DIR@|${BACKUP_DIR}|g" \
    "$src" >"$dest"
  chmod 0644 "$dest"
}

render_unit "${RELEASE_DIR}/deploy/user/urlopy.service" "${UNIT_DIR}/urlopy.service"
render_unit "${RELEASE_DIR}/deploy/user/urlopy-backup.service" "${UNIT_DIR}/urlopy-backup.service"
render_unit "${RELEASE_DIR}/deploy/user/urlopy-backup.timer" "${UNIT_DIR}/urlopy-backup.timer"

APP_DROPIN="${UNIT_DIR}/urlopy.service.d/10-sandbox.conf"
BACKUP_DROPIN="${UNIT_DIR}/urlopy-backup.service.d/10-sandbox.conf"
rm -f "$APP_DROPIN" "$BACKUP_DROPIN"
if [[ "$SANDBOX" == "yes" ]]; then
  mkdir -p "${UNIT_DIR}/urlopy.service.d" "${UNIT_DIR}/urlopy-backup.service.d"
  render_unit "${RELEASE_DIR}/deploy/user/urlopy.service.sandbox.conf" "$APP_DROPIN"
  render_unit "${RELEASE_DIR}/deploy/user/urlopy-backup.service.sandbox.conf" "$BACKUP_DROPIN"
fi
systemctl --user daemon-reload
ok "systemd user units installed in ${UNIT_DIR}."

# --- Migrate and seed --------------------------------------------------------------------------
info "Migrating database at ${DB_PATH}…"
# Exported into this shell rather than passed as `env VAR=... cmd`: the latter puts ADMIN_PASSWORD
# in a command line, where any user on the box can read it out of `ps` for as long as it runs.
export DATABASE_PATH="$DB_PATH"
export NODE_ENV=production
if [[ -n "$ADMIN_LOGIN" ]]; then
  export ADMIN_LOGIN ADMIN_PASSWORD
fi

if ! "$NODE_BIN" "${RELEASE_DIR}/dist/bootstrap.mjs"; then
  unset ADMIN_PASSWORD
  die "Database bootstrap failed. The release is installed but the service was not started; fix the error above and re-run."
fi
unset ADMIN_PASSWORD

# --- Start -----------------------------------------------------------------------------------
service_is_up() {
  # Give the service a moment to either come up or fall over. Without this the script proceeds
  # while the unit is still 'activating' and a crash-loop looks like a successful install.
  sleep 2
  systemctl --user is-active --quiet urlopy.service
}

systemctl --user enable urlopy.service >/dev/null 2>&1 || true
systemctl --user restart urlopy.service || true

if ! service_is_up && [[ "$SANDBOX" == "yes" ]]; then
  # The failure mode this exists for: the user manager cannot build a mount namespace, so every
  # directive in the drop-in is rejected and the unit never execs. Distinguishable from an
  # application crash by the status code systemd reports — but rather than parse that, just retry
  # without the drop-in and report which mode worked. A less-confined service that runs beats a
  # confined one that does not, on a box where you cannot become root to investigate.
  warn "urlopy.service did not start with the namespace hardening in place. systemd said:"
  # Quote the actual reason rather than guessing at one. The two causes look identical from the
  # exit code (226/NAMESPACE) but need opposite responses: a host that forbids user namespaces is
  # something you live with, whereas "No such file or directory" on a ReadWritePaths= target means
  # a path in the env file is wrong — or is under /tmp, which PrivateTmp= hides from the service.
  journalctl --user -u urlopy.service -n 20 --no-pager 2>/dev/null |
    grep -iE "namespac|Failed at step" | tail -3 | sed 's/^/    /' >&2 || true
  warn "Retrying without the sandbox drop-ins…"
  rm -f "$APP_DROPIN" "$BACKUP_DROPIN"
  systemctl --user daemon-reload
  systemctl --user restart urlopy.service || true
  if service_is_up; then
    SANDBOX="degraded"
    warn "Started without them. The app keeps its seccomp and no-new-privileges confinement but"
    warn "runs with a writable filesystem view. If the reason above names a path, fix it and put"
    warn "the drop-ins back with: ./install-user.sh (they are re-created on every run)."
  fi
fi

if systemctl --user is-active --quiet urlopy.service; then
  ok "urlopy.service is running on ${HOST}:${PORT}."
else
  warn "urlopy.service did not come up. Recent log:"
  journalctl --user -u urlopy.service -n 30 --no-pager >&2 || true
  if [[ -n "$PREVIOUS_RELEASE" ]]; then
    warn "Previous release is still on disk. To roll back:"
    warn "  ln -sfn ${PREVIOUS_RELEASE} ${APP_ROOT}/.current.new && mv -T ${APP_ROOT}/.current.new ${APP_ROOT}/current && systemctl --user restart urlopy"
  fi
  die "Install did not complete cleanly."
fi

systemctl --user enable urlopy-backup.timer >/dev/null 2>&1 || true
systemctl --user start urlopy-backup.timer || warn "Could not start urlopy-backup.timer."

# Take one snapshot now rather than waiting until 03:15 to discover the backup path is wrong.
# It also leaves the operator with a restore to test against on day one.
if systemctl --user start urlopy-backup.service; then
  ok "Backup smoke test passed; snapshots land in ${BACKUP_DIR}."
else
  warn "The backup unit failed its first run. Check: journalctl --user -u urlopy-backup"
fi

# --- Lingering ---------------------------------------------------------------------------------
# Without this the user manager dies with your last session, taking the app and the timer with it.
# enable-linger is usually root-only, but many distributions ship a polkit rule that lets a user
# set it for themselves — so try, and be explicit when it does not work.
LINGER="$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null || echo "unknown")"
if [[ "$LINGER" != "yes" ]]; then
  if loginctl enable-linger "$(id -un)" >/dev/null 2>&1; then
    ok "Lingering enabled — the service now survives logout and starts at boot."
    LINGER="yes"
  else
    LINGER="no"
  fi
else
  ok "Lingering already enabled."
fi

cat <<NEXT

$(ok "Urlopy ${RELEASE_ID} installed (rootless, sandbox: ${SANDBOX}).")

  Service    systemctl --user status urlopy
  Logs       journalctl --user -u urlopy -f
  Restart    systemctl --user restart urlopy
  Backups    ${BACKUP_DIR} (nightly 03:15, keeping ${BACKUP_KEEP}); run one now with
             systemctl --user start urlopy-backup.service
  Rollback   ln -sfn <previous release> ${APP_ROOT}/current && systemctl --user restart urlopy

NEXT

if [[ "$LINGER" != "yes" ]]; then
  cat >&2 <<LINGERNOTE
$(warn "Lingering is OFF and could not be enabled without root.")
  The app and the backup timer stop when your last session ends, and do not start at boot.
  Ask an administrator for exactly one command:

      sudo loginctl enable-linger $(id -un)

  Until then, keep a session open (tmux/screen) for the app to stay up.

LINGERNOTE
fi

cat >&2 <<FIREWALLNOTE
$(info "Two things this script cannot do for you:")

  1. Open the port. Verify from another machine:
         curl -sS -o /dev/null -w '%{http_code}\n' ${PUBLIC_ORIGIN}/
     If that hangs or refuses while it works on the box itself, the firewall is closed. Ask an
     administrator for:
         sudo firewall-cmd --add-port=${PORT}/tcp --permanent && sudo firewall-cmd --reload

  2. Supply the security headers. deploy/nginx/urlopy.conf sets CSP, X-Frame-Options and friends;
     with no proxy in front, nothing does. Acceptable on a closed internal network, worth knowing.

Then open ${PUBLIC_ORIGIN} and sign in.
FIREWALLNOTE
