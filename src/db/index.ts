import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

export { schema };
export * from "./schema";

/**
 * A driver error, re-thrown from the proxy callback in a stable shape before Drizzle wraps it
 * in a `DrizzleQueryError`.
 *
 * `node:sqlite` throws with `code: 'ERR_SQLITE_ERROR'` — the same string for every failure — and
 * carries the useful discriminator on `errcode`, SQLite's *extended* result code
 * (`SQLITE_CONSTRAINT_UNIQUE` = 2067, `SQLITE_CONSTRAINT_FOREIGNKEY` = 787,
 * `SQLITE_CONSTRAINT_CHECK` = 275). Normalising here keeps `src/lib/db-errors.ts` a pure mapping
 * and leaves its `err.code ?? err.cause?.code` indirection working unchanged, since Drizzle still
 * wraps whatever we throw.
 */
export class SqliteDriverError extends Error {
  /** Extended result code as a decimal string, e.g. `"2067"` — what `db-errors.ts` branches on. */
  readonly code: string;
  /** Extended result code as a number, for callers that prefer it. */
  readonly errcode: number;
  /**
   * Whatever SQLite named after `constraint failed: `. For a CHECK violation this is the
   * constraint name (`absences_time_check`); for a UNIQUE violation it is a `table.column` list;
   * for a FOREIGN KEY violation SQLite names nothing, so this is `undefined` — which is why
   * Phase 3 resolves unknown references with pre-flight lookups instead.
   */
  readonly constraint_name: string | undefined;

  constructor(cause: Error & { errcode?: number }) {
    super(cause.message, { cause });
    this.name = "SqliteDriverError";
    this.errcode = typeof cause.errcode === "number" ? cause.errcode : 0;
    this.code = String(this.errcode);
    const named = /constraint failed:\s*(.+)$/.exec(cause.message);
    this.constraint_name = named?.[1]?.trim();
  }
}

function toDriverError(err: unknown): unknown {
  if (err instanceof Error && "errcode" in err) return new SqliteDriverError(err as Error & { errcode: number });
  return err;
}

/**
 * `node:sqlite` binds only null / number / bigint / string / Uint8Array. Drizzle's sqlite-core
 * column types already map booleans and Dates for us; a hand-written `sql` fragment can still
 * embed a raw JS boolean, so fold that here rather than surfacing an opaque ERR_INVALID_ARG_TYPE.
 * `undefined` stays an error — it means a value the caller meant to supply went missing, which is
 * exactly what postgres-js used to reject too.
 */
function toBindable(value: unknown, index: number): null | number | bigint | string | Uint8Array {
  if (value === undefined) throw new Error(`Undefined values are not allowed (parameter ${index + 1})`);
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as null | number | bigint | string | Uint8Array;
}

function openHandle(databasePath: string): DatabaseSync {
  const handle = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  // WAL lets a read proceed while the single writer holds the file. Skipped for in-memory
  // databases, where journal_mode is fixed and the pragma is a no-op that returns "memory".
  if (databasePath !== ":memory:") handle.exec("PRAGMA journal_mode = WAL");
  return handle;
}

type ProxyMethod = "run" | "all" | "get" | "values";

/**
 * Run one statement and shape the result the way `drizzle-orm/sqlite-proxy` expects.
 *
 * The proxy wants *positional* rows: an array of arrays for `all` and `values`, one flat array
 * for `get`, and it maps them onto the selected fields by index. `setReturnArrays(true)` gives
 * exactly that. Flattening the default object rows with `Object.values()` would look equivalent
 * but is not — a join selecting two same-named columns (Drizzle emits `"a"."id", "b"."id"`
 * unaliased) collapses to one object key and silently shifts every later column into the wrong
 * field. Nothing throws when this is wrong, which is why `src/tests/db/proxy-rows.test.ts` pins it.
 */
function execute(handle: DatabaseSync, query: string, params: unknown[], method: ProxyMethod): { rows: unknown[] } {
  const bound = params.map(toBindable);
  try {
    const statement = handle.prepare(query);
    if (method === "run") {
      statement.run(...bound);
      return { rows: [] };
    }
    statement.setReturnArrays(true);
    if (method === "get") {
      // `rows` must stay *undefined* when nothing matched. Drizzle's `mapGetResult` only
      // short-circuits to `undefined` on a falsy value; hand it `[]` and it maps an empty row onto
      // the selected fields instead, so `findFirst` returns a truthy object of undefineds for a
      // row that does not exist. The cast goes through `unknown` deliberately: the callback's
      // declared return type has no room for the absent row this must produce.
      const row = statement.get(...bound) as unknown as unknown[] | undefined;
      return { rows: row as unknown as unknown[] };
    }
    // Typed as objects by @types/node, but `setReturnArrays(true)` above makes the runtime shape
    // `unknown[][]` — which is what `all` and `values` both want. No cast: the declared element
    // type is already `unknown`, and asserting the narrower shape here would only be decoration.
    return { rows: statement.all(...bound) };
  } catch (err) {
    throw toDriverError(err);
  }
}

function makeDb(handle: DatabaseSync) {
  // The proxy callback type is async; `node:sqlite` is synchronous, so the work happens inline and
  // only the result is wrapped. There is no I/O here to await.
  return drizzle((query, params, method) => Promise.resolve(execute(handle, query, params, method)), { schema });
}

export type Db = ReturnType<typeof makeDb>;

const handles = new Map<string, DatabaseSync>();
const instances = new Map<string, Db>();

/**
 * Open (or reuse) the SQLite database at `databasePath`.
 *
 * Memoised per path: one process serves the whole VPS, so opening a handle per request would
 * churn file descriptors for no benefit. This deliberately inverts the two Workers-era rules in
 * `AGENTS.md` ("do not call `createDb` at module top level", "one pool per request") — both
 * existed because `astro:env/server` was request-scoped under the Workers adapter and because a
 * Supabase session pooler capped concurrent clients. Neither applies to a local file.
 */
export function createDb(databasePath: string): Db {
  if (!databasePath) throw new Error("DATABASE_PATH is required");
  const existing = instances.get(databasePath);
  if (existing) return existing;
  const handle = openHandle(databasePath);
  const db = makeDb(handle);
  handles.set(databasePath, handle);
  instances.set(databasePath, db);
  return db;
}

/** The raw `node:sqlite` handle behind {@link createDb} — needed by the migrator and by backups. */
export function getRawHandle(databasePath: string): DatabaseSync {
  createDb(databasePath);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return handles.get(databasePath)!;
}

/** Close and forget a database. Tests use this to release a per-run temp file. */
export function closeDb(databasePath: string): void {
  handles.get(databasePath)?.close();
  handles.delete(databasePath);
  instances.delete(databasePath);
}
