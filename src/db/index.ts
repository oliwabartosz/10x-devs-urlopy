import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;
export { schema };
export * from "./schema";

export function createDb(databaseUrl: string) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  // prepare: false required for PgBouncer Transaction Mode (port 6543)
  return drizzle(postgres(databaseUrl, { ssl: false, prepare: false }), { schema });
}
