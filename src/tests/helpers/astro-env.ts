// Test stub for Astro's virtual `astro:env/server` module, which does not exist outside
// an Astro build. Aliased in vitest.config.ts so API route handlers can be imported and
// invoked directly in tests.
//
// Routes call `createDb(DATABASE_URL)` internally, so this maps to the same direct
// connection string the DB helpers use (`getTestDb`).
//
// Route handlers build a fresh `postgres()` pool per invocation and never end it — correct
// for the Workers runtime, where the isolate owns the lifetime, but in tests those pools
// accumulate across every request in every file. Supabase's session pooler allows 15 clients,
// so at the postgres-js default of 10 connections per pool a route-level suite exhausts it
// partway through and later requests come back 503 "Database error"
// ((EMAXCONNSESSION) max clients reached in session mode).
//
// postgres-js reads both options off the connection string, so bounding them here fixes it
// for every route test without changing production code: one connection per pool, released
// after a second of idle.
const directUrl = process.env.DATABASE_URL_DIRECT ?? "";
export const DATABASE_URL = directUrl ? `${directUrl}${directUrl.includes("?") ? "&" : "?"}max=1&idle_timeout=1` : "";
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";
// Without this, any route test importing a handler that calls `createAdminClient()` gets
// `undefined` here, hence a null client, hence a 503 "Admin client is not configured" that
// reads as a real defect rather than a missing stub export.
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
