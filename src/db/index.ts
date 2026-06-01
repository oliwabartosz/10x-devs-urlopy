import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;
export { schema };
export * from "./schema";

export function createDb(databaseUrl: string) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return drizzle(neon(databaseUrl), { schema });
}
