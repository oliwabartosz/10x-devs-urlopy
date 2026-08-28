/**
 * Take one consistent snapshot of the SQLite database and prune old ones.
 *
 * Run by `urlopy-backup.service`, fired by `urlopy-backup.timer`. Plain `.mjs` and zero imports
 * beyond `node:*`, so it runs on the VPS with nothing installed — no `sqlite3` CLI, no npm
 * dependency, not even the app's `node_modules`.
 *
 * Why the `node:sqlite` `backup()` API and not `cp`: the database runs in WAL mode, so the `.db`
 * file on its own is not a complete database — recent commits live in the `-wal` sidecar until a
 * checkpoint. Copying the three files with `cp` races the running writer and can produce a
 * snapshot that opens but is missing the last transactions. `backup()` goes through SQLite's
 * online-backup API, which takes the same locks the writer does and yields a single self-contained
 * file with the WAL already folded in.
 *
 * Env:
 *   DATABASE_PATH        required — the live database
 *   URLOPY_BACKUP_DIR    required — where snapshots land
 *   URLOPY_BACKUP_KEEP   optional — how many to retain (default 14)
 */
import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const PREFIX = "urlopy-";
const SUFFIX = ".db";

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const databasePath = process.env.DATABASE_PATH;
const backupDir = process.env.URLOPY_BACKUP_DIR;
if (!databasePath) fail("DATABASE_PATH is not set.");
if (!backupDir) fail("URLOPY_BACKUP_DIR is not set.");

// A non-numeric or absent value falls back to 14 rather than to NaN — `Number("")` is 0, which
// would silently mean "keep nothing" and delete the snapshot taken seconds earlier.
const parsedKeep = Number.parseInt(process.env.URLOPY_BACKUP_KEEP ?? "", 10);
const keep = Number.isInteger(parsedKeep) && parsedKeep > 0 ? parsedKeep : 14;

mkdirSync(backupDir, { recursive: true });

// Colons are legal in filenames but awkward on every other tool that touches them, so the ISO
// timestamp is stripped down to digits: urlopy-20260826T142530Z.db. Sorts lexicographically in
// chronological order, which is what the pruning below relies on.
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const target = join(backupDir, `${PREFIX}${stamp}${SUFFIX}`);

// Opened read-write on purpose. `readOnly: true` cannot attach to a WAL database when the `-shm`
// file is absent (an idle install that has been restarted), and it would fail at exactly the
// moment a backup matters most. The service user owns the database directory anyway.
const source = new DatabaseSync(databasePath);
let pages;
try {
  pages = await backup(source, target);
} finally {
  source.close();
}

// Verify before pruning, never after: a corrupt snapshot that still counted toward `keep` would
// push a good one out of the retention window, and the failure would only surface on the day
// someone tries to restore.
//
// Read-write, and `journal_mode = DELETE` first, because `backup()` copies the source's WAL mode
// onto the snapshot — so merely *opening* it to check spawns `-wal` and `-shm` siblings that
// outlive the close. Those siblings do not end in `.db`, so the prune below would never collect
// them and the backup directory would grow two orphans per run forever. Switching the snapshot to
// a rollback journal folds the WAL in and leaves one self-contained file, which is also the
// friendlier thing to hand someone doing a restore.
const verify = new DatabaseSync(target);
try {
  verify.exec("PRAGMA journal_mode = DELETE");
  const result = verify.prepare("PRAGMA integrity_check").get();
  const verdict = Object.values(result)[0];
  if (verdict !== "ok") fail(`Backup ${target} failed integrity_check: ${String(verdict)}`);
} finally {
  verify.close();
}

const snapshots = readdirSync(backupDir)
  .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
  .sort();

const stale = snapshots.slice(0, Math.max(0, snapshots.length - keep));
for (const name of stale) {
  unlinkSync(join(backupDir, name));
  // Belt and braces: the verify step above leaves none behind any more, but a snapshot taken by
  // an older version of this script — or restored in place by hand and reopened — can still have
  // them. `force` because their absence is the normal case, not an error.
  rmSync(join(backupDir, `${name}-wal`), { force: true });
  rmSync(join(backupDir, `${name}-shm`), { force: true });
}

const size = statSync(target).size;
console.log(
  `✔ ${target} (${pages} pages, ${Math.round(size / 1024)} KiB); ` +
    `kept ${Math.min(snapshots.length, keep)} of ${snapshots.length}, pruned ${stale.length}.`,
);
