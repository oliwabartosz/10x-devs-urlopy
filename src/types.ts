import { employees, absence_types, absences } from "@/db/schema";

export type UserRole = "employee" | "moderator";
export type Employee = typeof employees.$inferSelect;
export type AbsenceType = typeof absence_types.$inferSelect;
// Omit hours from $inferSelect (string|null for numeric) and re-add as number|null — all queries cast hours::float.
export type Absence = Omit<typeof absences.$inferSelect, "hours"> & { hours: number | null };

export type AbsenceInsert = typeof absences.$inferInsert;
export type AbsenceUpdate = Partial<Omit<AbsenceInsert, "employee_id">>;
