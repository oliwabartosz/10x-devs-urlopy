import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb, closeDb, getRawHandle, absence_types } from "@/db/index";
import { migrateAndSeed } from "@/db/migrate";
import { ABSENCE_TYPE_SEED } from "@/db/seed";

// Provisioning used to be a three-legged ritual — Supabase CLI baseline, then `drizzle-kit
// migrate`, then a manual `psql` pass for the hand-authored data migrations that the journal
// deliberately omits. Skipping the last leg was easy and its symptom was cosmetic-but-real
// (three or four glyphs per offsite cell). One runner now covers all three, so the thing worth
// asserting is that a bare path becomes a complete, correctly-seeded database.

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "urlopy-migrate-"));
  path = join(dir, "fresh.db");
});

afterEach(() => {
  closeDb(path);
  rmSync(dir, { recursive: true, force: true });
});

function tableNames(): string[] {
  return getRawHandle(path)
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
    .all()
    .map((r) => (r as { name: string }).name);
}

describe("migrate + seed on a fresh database", () => {
  it("creates the file, every table, and the full catalogue", async () => {
    expect(existsSync(path)).toBe(false);
    await migrateAndSeed(path);
    expect(existsSync(path)).toBe(true);

    expect(tableNames()).toEqual([
      "__drizzle_migrations",
      "absence_types",
      "absences",
      "employees",
      "holiday_balances",
      "sessions",
      "users",
    ]);

    const db = createDb(path);
    const types = await db.select().from(absence_types).orderBy(absence_types.display_order);
    expect(types).toHaveLength(7);
    expect(types.map((t) => t.name)).toEqual(ABSENCE_TYPE_SEED.map((t) => t.name));
    // serial() → integer autoincrement: the catalogue keeps ids 1-7 on a fresh database.
    expect(types.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("gives the offsite-training type a single-codepoint icon", async () => {
    await migrateAndSeed(path);
    const db = createDb(path);
    const [offsite] = await db.select().from(absence_types).orderBy(absence_types.display_order).limit(1).offset(1);

    expect(offsite.name).toBe("szkolenie/wyjście poza miejsce pracy");
    // The grid cell carries no type name, so the icon is the only per-type signal. The value it
    // replaced was an 8-codepoint ZWJ sequence that decomposes into 3-4 glyphs on a font without
    // the ligature — counting codepoints, not `.length`, is what actually catches a regression.
    // Spreading a string is the point here, not a mistake: the rule warns that `...` decomposes a
    // complex emoji into code points, which is precisely the decomposition being asserted against.
    // eslint-disable-next-line @typescript-eslint/no-misused-spread
    expect([...offsite.icon]).toHaveLength(1);
    expect(offsite.icon).toBe("🏃");
  });

  it("enforces foreign keys and the UNIQUE(name) index", async () => {
    await migrateAndSeed(path);
    const db = createDb(path);

    const [fk] = await db.all<[number]>(sql`pragma foreign_keys`);
    expect(fk[0]).toBe(1);

    const indexes = getRawHandle(path)
      .prepare("select name from sqlite_master where type = 'index' and tbl_name = 'absence_types'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(indexes).toContain("absence_types_name_unique");

    // `src/lib/absence-types.ts` gates the partial-day feature on exact name strings, so a
    // duplicate row would silently disable it for whichever id lost the race.
    await expect(db.insert(absence_types).values({ name: "urlop", color: "#000000" })).rejects.toMatchObject({
      cause: { code: "2067" },
    });
  });

  it("is idempotent — a second run adds nothing and applies no migration twice", async () => {
    await migrateAndSeed(path);
    const db = createDb(path);
    const first = await db.select().from(absence_types).orderBy(absence_types.id);
    const applied = getRawHandle(path).prepare("select count(*) as n from __drizzle_migrations").get() as { n: number };

    await migrateAndSeed(path);
    const second = await db.select().from(absence_types).orderBy(absence_types.id);
    const appliedAgain = getRawHandle(path).prepare("select count(*) as n from __drizzle_migrations").get() as {
      n: number;
    };

    expect(second).toEqual(first);
    expect(appliedAgain.n).toBe(applied.n);
  });

  it("reproduces the same schema and seed after the file is deleted", async () => {
    await migrateAndSeed(path);
    const before = {
      tables: tableNames(),
      schema: getRawHandle(path)
        .prepare("select sql from sqlite_master where sql is not null order by name")
        .all()
        .map((r) => (r as { sql: string }).sql),
      types: await createDb(path).select().from(absence_types).orderBy(absence_types.id),
    };

    closeDb(path);
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });

    await migrateAndSeed(path);
    expect(tableNames()).toEqual(before.tables);
    expect(
      getRawHandle(path)
        .prepare("select sql from sqlite_master where sql is not null order by name")
        .all()
        .map((r) => (r as { sql: string }).sql),
    ).toEqual(before.schema);
    expect(await createDb(path).select().from(absence_types).orderBy(absence_types.id)).toEqual(before.types);
  });
});
