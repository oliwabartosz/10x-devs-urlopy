import { fileURLToPath } from "node:url";
import { migrate as proxyMigrate } from "drizzle-orm/sqlite-proxy/migrator";
import { createDb, getRawHandle } from "./index";
import { seedAbsenceTypes } from "./seed";

/**
 * The generated-migration folder, resolved relative to this file rather than to `process.cwd()`,
 * so `install.sh` can run the migrator from anywhere on the VPS.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Bring the database at `databasePath` up to date and seed the absence-type catalogue.
 *
 * Idempotent and safe to call on every boot: the migrator skips migrations already recorded in
 * `__drizzle_migrations`, and the seed upserts by name. This is what collapses the old
 * three-legged Supabase provisioning ritual (CLI baseline → `db:migrate` → manual `psql` for the
 * hand-authored data migrations) into a single runner.
 */
export async function migrateAndSeed(databasePath: string, migrationsFolder = MIGRATIONS_FOLDER): Promise<void> {
  const db = createDb(databasePath);
  const handle = getRawHandle(databasePath);

  await proxyMigrate(
    db,
    // The migrator's callback type is async; `node:sqlite` is synchronous, so there is nothing to
    // await and the work is wrapped rather than declared `async`.
    (queries) => {
      if (queries.length === 0) return Promise.resolve();
      // One transaction for the whole batch: a half-applied baseline would leave a database that
      // neither migrates forward (the row is missing) nor works (the tables are partly there).
      handle.exec("BEGIN");
      try {
        for (const query of queries) handle.exec(query);
        handle.exec("COMMIT");
      } catch (err) {
        handle.exec("ROLLBACK");
        throw err;
      }
      return Promise.resolve();
    },
    { migrationsFolder },
  );

  seedAbsenceTypes(handle);
}
