/**
 * Bring the SQLite database at `DATABASE_PATH` to a runnable state: migrate, seed the absence-type
 * catalogue, and create the technical admin. This is what `install.sh` runs on the VPS.
 *
 * It exists as a separate entry from `scripts/seed-admin.ts` because of where it has to run. The
 * VPS is offline and its `node_modules` is pruned with `--omit=dev`, so `tsx` and `drizzle-kit` are
 * both absent — and Node's own type stripping cannot load this file either, since the repo's
 * imports are extensionless and Node's ESM resolver does not add `.ts`. So this module is bundled
 * to `dist/bootstrap.mjs` by `scripts/build-artifact.mjs` and shipped inside `dist/`.
 *
 * Env (from `/etc/urlopy/env` on the VPS, `.env` locally):
 *   DATABASE_PATH   required — the SQLite file, created if absent
 *   ADMIN_LOGIN     optional — skip admin seeding when unset (an upgrade run does not need it)
 *   ADMIN_PASSWORD  optional — required if ADMIN_LOGIN is set
 *
 * Idempotent end to end: the migrator skips recorded migrations, the type seed upserts by name,
 * and `seedAdmin` no-ops once an `is_system` employee exists. `install.sh` re-runs it on upgrades.
 */
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { migrateAndSeed } from "../src/db/migrate";
import { closeDb } from "../src/db/index";
import { seedAdmin } from "./seed-admin";
import { MIN_PASSWORD_LENGTH } from "../src/lib/auth/password";

/**
 * Where the generated migrations live *in the shipped artifact*.
 *
 * `src/db/migrate.ts` resolves its default as `../../drizzle` relative to itself, which is right in
 * the repo and wrong after bundling — this file becomes `dist/bootstrap.mjs`, so that default would
 * point one level above the install root. `scripts/build-artifact.mjs` copies `drizzle/` to
 * `dist/drizzle/`, and this resolves against `import.meta.url` so the path follows the artifact
 * wherever `install.sh` puts it. The env override exists for running this straight from the repo.
 */
function migrationsFolder(): string {
  const fromEnv = process.env.URLOPY_MIGRATIONS;
  if (fromEnv) return fromEnv;
  const beside = fileURLToPath(new URL("./drizzle", import.meta.url));
  if (existsSync(beside)) return beside;
  // Running from the repo (`node --import tsx scripts/bootstrap.ts`) rather than from `dist/`.
  return fileURLToPath(new URL("../drizzle", import.meta.url));
}

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const databasePath = process.env.DATABASE_PATH;
  if (!databasePath) fail("DATABASE_PATH is not set.");

  const folder = migrationsFolder();
  if (!existsSync(folder)) {
    fail(`Migrations folder not found at ${folder}. The artifact is incomplete — rebuild and re-copy it.`);
  }

  // eslint-disable-next-line no-console
  console.log(`• Migrating ${databasePath} from ${folder}`);
  await migrateAndSeed(databasePath, folder);
  // eslint-disable-next-line no-console
  console.log("✔ Schema up to date; absence-type catalogue seeded.");

  const email = process.env.ADMIN_LOGIN;
  const password = process.env.ADMIN_PASSWORD;

  if (!email) {
    // eslint-disable-next-line no-console
    console.log("• ADMIN_LOGIN not set; skipping admin seed (expected on an upgrade run).");
  } else {
    if (!password) fail("ADMIN_LOGIN is set but ADMIN_PASSWORD is not.");
    if (password.length < MIN_PASSWORD_LENGTH) {
      fail(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    // `keepOpen` so the single `closeDb` below owns the handle's lifetime; `seedAdmin` would
    // otherwise close a database this process may still be holding open through `createDb`'s
    // per-path memo, leaving a stale entry that hands out a closed handle.
    await seedAdmin({ email, password, databasePath, keepOpen: true });
  }

  closeDb(databasePath);
  // eslint-disable-next-line no-console
  console.log("✔ Bootstrap complete.");
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("✖ bootstrap failed:", err);
  process.exit(1);
});
