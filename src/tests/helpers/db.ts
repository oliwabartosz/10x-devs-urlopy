import { createDb } from "@/db/index";

export function getTestDb(): ReturnType<typeof createDb> {
  const url = process.env.DATABASE_URL_DIRECT;
  if (!url) {
    throw new Error("DATABASE_URL_DIRECT not set — cannot run DB integration tests. Add it to .env.");
  }
  return createDb(url);
}
