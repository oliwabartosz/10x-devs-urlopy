import { z } from "zod";

export const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "Invalid calendar date");

export const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format HH:MM");
