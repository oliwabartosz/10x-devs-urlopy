import { employees, absence_types, absences } from "@/db/schema";

export type UserRole = "employee" | "moderator";
export type Employee = typeof employees.$inferSelect;
export type AbsenceType = typeof absence_types.$inferSelect;
export type Absence = typeof absences.$inferSelect;

export type AbsenceInsert = typeof absences.$inferInsert;
export type AbsenceUpdate = Partial<Omit<AbsenceInsert, "employee_id">>;
