import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  // Generated migrations land here alongside Supabase CLI migrations — always manually review diffs before applying
  out: "./supabase/migrations",
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  dbCredentials: { url: process.env.DATABASE_URL_DIRECT! },
  migrations: { prefix: "supabase" },
  verbose: true,
  strict: true,
});
