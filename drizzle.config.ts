import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  // Own directory now: the Supabase CLI's three-legged provisioning ritual is gone, so nothing
  // else writes here. Always manually review a generated diff — the DB-level CHECK constraints
  // and the `COLLATE NOCASE` on users.email are not representable in Drizzle and are hand-added
  // to the migration (SQLite has no ALTER TABLE ADD CONSTRAINT, so they must sit inside CREATE
  // TABLE; a regenerated table definition drops them silently).
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_PATH ?? "./urlopy.db" },
  verbose: true,
  strict: true,
});
