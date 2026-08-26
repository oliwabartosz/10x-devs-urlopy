import { eq } from "drizzle-orm";
import { createDb, employees } from "@/db/index";
import { DATABASE_PATH } from "astro:env/server";

/**
 * The startup banner. It used to report "Supabase nie jest skonfigurowany", which is no longer a
 * thing that can be true; what can be true on this deployment is that `install.sh` has not
 * finished — the database path is unset, or the technical admin was never seeded and there is
 * therefore no account anyone can sign in with.
 */

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

/**
 * Memoised once the admin exists. Seeding is one-way — `scripts/seed-admin.ts` no-ops forever
 * after the first run — so a `true` can never become false, and this keeps the banner off the
 * per-request query path for the entire life of a healthy process. A `false` is re-checked,
 * because that is the state the operator is actively fixing.
 */
let adminSeeded = false;

async function isAdminSeeded(): Promise<boolean> {
  if (adminSeeded) return true;
  const rows = await createDb(DATABASE_PATH)
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.is_system, true))
    .limit(1);
  adminSeeded = rows.length > 0;
  return adminSeeded;
}

export async function getMissingConfigs(): Promise<ConfigStatus[]> {
  if (!DATABASE_PATH) {
    return [
      {
        name: "Database",
        configured: false,
        message: "DATABASE_PATH nie jest ustawiony — aplikacja nie ma dostępu do bazy danych.",
      },
    ];
  }

  try {
    if (await isAdminSeeded()) return [];
  } catch {
    // The path is set but the file is unreadable or unmigrated. Same operator action either way,
    // and the banner must not be the thing that throws on the page that reports the problem.
    return [
      {
        name: "Database",
        configured: false,
        message: "Nie można odczytać bazy danych — sprawdź DATABASE_PATH i uruchom migracje.",
      },
    ];
  }

  return [
    {
      name: "Admin",
      configured: false,
      message: "Konto administratora nie zostało utworzone — uruchom `npm run seed:admin`.",
    },
  ];
}
