import { afterAll } from "vitest";
import { rmSync } from "node:fs";
import { closeDb } from "@/db/index";
import { DATABASE_PATH } from "./astro-env";

// Registered as a vitest `setupFiles` entry, so this runs once per test file and the hook below
// is that file's `afterAll`. Its only job is to remove the temp database this file opened —
// closing the handle first, because WAL leaves `-wal` and `-shm` siblings that an open
// connection still owns and that would outlive the main file otherwise.
//
// By name, never by directory: test files share one directory and run in parallel, so removing
// the directory would take a sibling's database with it.
afterAll(() => {
  closeDb(DATABASE_PATH);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${DATABASE_PATH}${suffix}`, { force: true });
});
