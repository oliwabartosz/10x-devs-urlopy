import { createDb, type Db } from "@/db/index";
import { migrateAndSeed } from "@/db/migrate";
import { DATABASE_PATH } from "./astro-env";

let ready: Promise<Db> | undefined;

/**
 * The database for this test file: a freshly migrated and seeded temp file, shared with the
 * route handlers because they resolve `DATABASE_PATH` through the same stub (`./astro-env`).
 *
 * Async because the migrator is; memoised so the `beforeAll` of every suite in a file pays for
 * it once. No suite self-skips any more: `describe.skipIf(!process.env.DATABASE_URL_DIRECT)` went
 * in Phase 2, and the two employee sub-resource suites it left behind — blocked on Supabase Auth
 * rather than on the database — were un-skipped in Phase 4 when the credential became a local row.
 */
export function getTestDb(): Promise<Db> {
  ready ??= migrateAndSeed(DATABASE_PATH).then(() => createDb(DATABASE_PATH));
  return ready;
}
