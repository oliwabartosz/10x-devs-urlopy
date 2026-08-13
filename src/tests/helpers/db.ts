import { createDb } from "@/db/index";

export function getTestDb(): ReturnType<typeof createDb> {
  const url = process.env.DATABASE_URL_DIRECT;
  if (!url) {
    throw new Error("DATABASE_URL_DIRECT not set — cannot run DB integration tests. Add it to .env.");
  }
  // Bound the pool for the same reason `src/tests/helpers/astro-env.ts` bounds the route-handler
  // pools: Supabase's session pooler allows 15 clients, and vitest runs suite files in parallel.
  // At postgres-js's default of 10 connections per pool, a handful of suites exhausts it and
  // requests come back as 503 "Database error" ((EMAXCONNSESSION) max clients reached), which
  // reads as a route defect. Every suite issues its queries sequentially, so one is enough.
  return createDb(`${url}${url.includes("?") ? "&" : "?"}max=1&idle_timeout=1`);
}
