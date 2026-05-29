export type UserRole = "employee" | "moderator";

export interface Employee {
  id: string;
  user_id: string;
  role: UserRole;
  first_name: string;
  last_name: string;
  deleted_at: string | null;
  created_at: string;
}

export interface AbsenceType {
  id: number;
  name: string;
  color: string;
}

export interface Absence {
  id: string;
  employee_id: string;
  absence_type_id: number;
  date: string;
  is_full_day: boolean;
  hours: number | null;
  comment: string | null;
  substitute_employee_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AbsenceInsert {
  employee_id: string;
  absence_type_id: number;
  date: string;
  is_full_day: boolean;
  hours: number | null;
  comment: string | null;
  substitute_employee_id: string | null;
}

export type AbsenceUpdate = Partial<Omit<AbsenceInsert, "employee_id">>;
