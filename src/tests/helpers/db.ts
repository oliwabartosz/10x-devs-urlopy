import { createDb, type Db } from "@/db/index";
import { migrateAndSeed } from "@/db/migrate";
import { DATABASE_PATH } from "./astro-env";

let ready: Promise<Db> | undefined;

/**
 * The database for this test file: a freshly migrated and seeded temp file, shared with the
 * route handlers because they resolve `DATABASE_PATH` through the same stub (`./astro-env`).
 *
 * Async because the migrator is; memoised so the `beforeAll` of every suite in a file pays for
 * it once. Suites no longer self-skip — there is nothing left to configure, so
 * `describe.skipIf(!process.env.DATABASE_URL_DIRECT)` is gone from all but the two employee
 * sub-resource suites, which are blocked on Supabase Auth rather than on the database.
 */
export function getTestDb(): Promise<Db> {
  ready ??= migrateAndSeed(DATABASE_PATH).then(() => createDb(DATABASE_PATH));
  return ready;
}
