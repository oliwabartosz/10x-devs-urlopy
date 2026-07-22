// Test stub for Astro's virtual `astro:env/server` module, which does not exist outside
// an Astro build. Aliased in vitest.config.ts so API route handlers can be imported and
// invoked directly in tests.
//
// Routes call `createDb(DATABASE_URL)` internally, so this maps to the same direct
// connection string the DB helpers use (`getTestDb`).
export const DATABASE_URL = process.env.DATABASE_URL_DIRECT ?? "";
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";
