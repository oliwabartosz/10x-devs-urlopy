import { z } from "zod";

export const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "Invalid calendar date");

// Narrowed to real clock values. A plain `\d{2}:\d{2}` accepted "24:00" and "99:99", which
// reached Postgres as a 22007 and surfaced as a 500 instead of a 400. Now that the absence
// routes do arithmetic on this value (`@/lib/absence-hours`), a permissive schema is worse
// than a bad status code: "99:99" would clamp to a plausible-looking wrong time and be stored.
export const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time format HH:MM");
