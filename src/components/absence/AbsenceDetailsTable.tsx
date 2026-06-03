import { useState, useMemo } from "react";
import type { Absence, Employee, AbsenceType } from "@/types";
import { cn } from "@/lib/utils";

interface AbsenceDetailsTableProps {
  absences: Absence[];
  employees: Employee[];
  absenceTypes: AbsenceType[];
  className?: string;
  emptyLabel?: string;
}

type SortColumn = "date" | "employee" | "type" | "created_at";

function resolveEmployee(id: string | null, employees: Employee[]): Employee | undefined {
  if (!id) return undefined;
  return employees.find((e) => e.id === id);
}

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

function formatHours(absence: Absence): string {
  if (absence.is_full_day) return "Cały dzień";
  return `${absence.hours ?? 0} godz.`;
}

export default function AbsenceDetailsTable({
  absences,
  employees,
  absenceTypes,
  className,
  emptyLabel = "Brak nieobecności",
}: AbsenceDetailsTableProps) {
  const [sort, setSort] = useState<{ column: SortColumn; direction: "asc" | "desc" }>({
    column: "date",
    direction: "asc",
  });

  const absenceTypeMap = useMemo(() => {
    const m = new Map<number, AbsenceType>();
    for (const t of absenceTypes) m.set(t.id, t);
    return m;
  }, [absenceTypes]);

  const sorted = useMemo(() => {
    const copy = [...absences];
    const dir = sort.direction === "asc" ? 1 : -1;

    copy.sort((a, b) => {
      switch (sort.column) {
        case "date":
          return a.date.localeCompare(b.date) * dir;
        case "created_at":
          return (a.created_at.getTime() - b.created_at.getTime()) * dir;
        case "employee": {
          const ea = resolveEmployee(a.employee_id, employees);
          const eb = resolveEmployee(b.employee_id, employees);
          const la = ea ? `${ea.last_name} ${ea.first_name}` : "";
          const lb = eb ? `${eb.last_name} ${eb.first_name}` : "";
          return la.localeCompare(lb, "pl") * dir;
        }
        case "type": {
          const ta = absenceTypeMap.get(a.absence_type_id)?.name ?? "";
          const tb = absenceTypeMap.get(b.absence_type_id)?.name ?? "";
          return ta.localeCompare(tb, "pl") * dir;
        }
      }
    });

    return copy;
  }, [absences, sort, employees, absenceTypeMap]);

  function toggleSort(column: SortColumn) {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );
  }

  function sortIndicator(column: SortColumn) {
    if (sort.column !== column) return " ↕";
    return sort.direction === "asc" ? " ↑" : " ↓";
  }

  const thClass = "border-b px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap";
  const tdClass = "border-b px-3 py-2 text-sm text-gray-700";

  return (
    <div className={cn("overflow-x-auto rounded border", className)}>
      <table className="w-full border-collapse text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className={thClass}>
              <button
                type="button"
                onClick={() => {
                  toggleSort("date");
                }}
                className="hover:text-gray-900"
              >
                Data{sortIndicator("date")}
              </button>
            </th>
            <th className={thClass}>
              <button
                type="button"
                onClick={() => {
                  toggleSort("type");
                }}
                className="hover:text-gray-900"
              >
                Typ{sortIndicator("type")}
              </button>
            </th>
            <th className={thClass}>
              <button
                type="button"
                onClick={() => {
                  toggleSort("employee");
                }}
                className="hover:text-gray-900"
              >
                Pracownik{sortIndicator("employee")}
              </button>
            </th>
            <th className={thClass}>Zastępca</th>
            <th className={thClass}>Godziny</th>
            <th className={thClass}>Komentarz</th>
            <th className={thClass}>
              <button
                type="button"
                onClick={() => {
                  toggleSort("created_at");
                }}
                className="hover:text-gray-900"
              >
                Dodano{sortIndicator("created_at")}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            sorted.map((absence) => {
              const employee = resolveEmployee(absence.employee_id, employees);
              const substitute = resolveEmployee(absence.substitute_employee_id, employees);
              const absenceType = absenceTypeMap.get(absence.absence_type_id);

              return (
                <tr key={absence.id} className="hover:bg-gray-50">
                  <td className={tdClass}>{formatDate(absence.date)}</td>
                  <td className={tdClass}>
                    {absenceType ? (
                      <span className="flex items-center gap-1">
                        <span
                          className="inline-block h-3 w-3 shrink-0 rounded-sm"
                          style={{ backgroundColor: absenceType.color }}
                        />
                        {absenceType.name}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={tdClass}>{employee ? `${employee.first_name} ${employee.last_name}` : "—"}</td>
                  <td className={tdClass}>{substitute ? `${substitute.first_name} ${substitute.last_name}` : "—"}</td>
                  <td className={tdClass}>{formatHours(absence)}</td>
                  <td className={tdClass}>{absence.comment ?? "—"}</td>
                  <td className={tdClass}>{formatDate(absence.created_at.toISOString().slice(0, 10))}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
