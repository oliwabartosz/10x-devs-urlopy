import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Test stub for Astro's virtual `astro:env/server` module, which does not exist outside
// an Astro build. Aliased in vitest.config.ts so API route handlers can be imported and
// invoked directly in tests.
//
// One throwaway SQLite file per test file. Vitest evaluates this module once per test-file
// module graph, so the name below is drawn once per file and every consumer inside that file —
// the handlers, via `createDb(DATABASE_PATH)`, and the suite itself, via `getTestDb()` — lands
// on the same database. `src/tests/helpers/setup.ts` closes and removes it afterwards.
//
// A name inside a shared directory rather than a directory of its own, because nothing here
// creates the file — `DatabaseSync` does, on the first `createDb`. A test file that opens no
// database (the pure-logic suites, and any suite skipped wholesale) therefore leaves nothing
// behind, which matters because vitest runs no `afterAll` for a file whose every suite is
// skipped.
//
// The path is never read from the environment. It used to be, and the whole apparatus that
// grew around that — the fixture-UUID and date-window double-scoping in `src/tests/api/**`,
// the teardown discipline, the `?max=1&idle_timeout=1` pool bound — existed because a
// mistyped `.env` pointed the suite at a database someone was using. A temp file cannot be
// production, so the hazard is gone rather than mitigated.
const ROOT = join(tmpdir(), "urlopy-vitest");
mkdirSync(ROOT, { recursive: true });

export const DATABASE_PATH = join(ROOT, `${crypto.randomUUID()}.db`);

// Deprecated alias. Every route still imports `DATABASE_URL` and passes it to `createDb`,
// whose parameter is a filesystem path since the SQLite port. Phase 4 renames the variable at
// all 14 import sites along with the `astro.config.mjs` env schema; until then both names must
// resolve to the same path or the handlers open a second, empty database.
export const DATABASE_URL = DATABASE_PATH;

export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";
// Without this, any route test importing a handler that calls `createAdminClient()` gets
// `undefined` here, hence a null client, hence a 503 "Admin client is not configured" that
// reads as a real defect rather than a missing stub export. Phase 4 removes the Supabase
// exports along with the factories that read them.
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
