import type { Employee, Absence, AbsenceType } from "@/types";

interface AbsenceGridProps {
  employees: Employee[];
  absences: Absence[];
  absenceTypes: AbsenceType[];
  currentEmployee: Employee;
  year: number;
  month: number;
  prevMonthUrl: string;
  nextMonthUrl: string;
}

// Phase 3 stub — replaced in Phase 4 with the full grid implementation.
export default function AbsenceGrid({
  employees,
  absences,
  absenceTypes,
  currentEmployee,
  year,
  month,
}: AbsenceGridProps) {
  return (
    <div className="p-6 text-sm text-gray-500">
      <p className="font-medium text-gray-700">
        Siatka nieobecności — {year}-{String(month).padStart(2, "0")}
      </p>
      <p className="mt-1">
        Pracownicy: {employees.length} · Nieobecności: {absences.length} · Typy:{" "}
        {absenceTypes.length}
      </p>
      <p className="mt-1">
        Zalogowany: {currentEmployee.first_name} {currentEmployee.last_name} (
        {currentEmployee.role})
      </p>
      <p className="mt-2 text-xs text-gray-400">[Stub — faza 4 zastąpi ten komponent]</p>
    </div>
  );
}
