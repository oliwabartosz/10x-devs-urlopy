import type { Absence, Employee, AbsenceType } from "@/types";
import AbsenceDetailsTable from "@/components/absence/AbsenceDetailsTable";

interface AbsenceDetailsSubcardsProps {
  absences: Absence[];
  employees: Employee[];
  absenceTypes: AbsenceType[];
  year: number;
  month: number;
  initialSubcard: "today" | "monthly" | "yearly";
}

// Stub — full implementation in Phase 3
export default function AbsenceDetailsSubcards({ absences, employees, absenceTypes }: AbsenceDetailsSubcardsProps) {
  return <AbsenceDetailsTable absences={absences} employees={employees} absenceTypes={absenceTypes} />;
}
