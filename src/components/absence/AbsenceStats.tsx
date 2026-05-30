import { useEffect, useState } from "react";
import type { Absence, Employee, AbsenceType } from "@/types";

interface AbsenceStatsProps {
  monthlyAbsences: Absence[];
  employees: Employee[];
  absenceTypes: AbsenceType[];
  year: number;
  month: number;
}

type StatsMatrix = Map<string, { days: number; hours: number }>; // key: `${employeeId}_${typeId}`

function buildMatrix(absences: Absence[]): StatsMatrix {
  const matrix: StatsMatrix = new Map();
  for (const absence of absences) {
    const key = `${absence.employee_id}_${absence.absence_type_id}`;
    const current = matrix.get(key) ?? { days: 0, hours: 0 };
    if (absence.is_full_day) {
      current.days += 1;
    } else {
      current.hours += absence.hours ?? 0;
    }
    matrix.set(key, current);
  }
  return matrix;
}

function cellText(entry: { days: number; hours: number } | undefined): string {
  if (!entry || (entry.days === 0 && entry.hours === 0)) return "—";
  const parts: string[] = [];
  if (entry.days > 0) parts.push(`${entry.days} dni`);
  if (entry.hours > 0) parts.push(`${entry.hours} godz.`);
  return parts.join(" / ");
}

interface StatsTableProps {
  absences: Absence[];
  employees: Employee[];
  absenceTypes: AbsenceType[];
}

function StatsTable({ absences, employees, absenceTypes }: StatsTableProps) {
  const matrix = buildMatrix(absences);

  const thClass =
    "border border-gray-200 px-3 py-2 text-xs font-medium text-gray-500 bg-gray-50 text-left whitespace-nowrap";
  const tdClass = "border border-gray-200 px-3 py-2 text-sm text-gray-700";
  const tdTotalClass = "border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 bg-gray-50";

  function employeeTotal(employee: Employee): { days: number; hours: number } {
    return absenceTypes.reduce(
      (acc, type) => {
        const entry = matrix.get(`${employee.id}_${type.id}`);
        return { days: acc.days + (entry?.days ?? 0), hours: acc.hours + (entry?.hours ?? 0) };
      },
      { days: 0, hours: 0 },
    );
  }

  function typeTotal(type: AbsenceType): { days: number; hours: number } {
    return employees.reduce(
      (acc, emp) => {
        const entry = matrix.get(`${emp.id}_${type.id}`);
        return { days: acc.days + (entry?.days ?? 0), hours: acc.hours + (entry?.hours ?? 0) };
      },
      { days: 0, hours: 0 },
    );
  }

  const grandTotal = absenceTypes.reduce(
    (acc, type) => {
      const t = typeTotal(type);
      return { days: acc.days + t.days, hours: acc.hours + t.hours };
    },
    { days: 0, hours: 0 },
  );

  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={thClass}>Pracownik</th>
            {absenceTypes.map((type) => (
              <th key={type.id} className={thClass}>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: type.color }} />
                  {type.name}
                </span>
              </th>
            ))}
            <th className={thClass}>Łącznie</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => {
            const total = employeeTotal(employee);
            return (
              <tr key={employee.id} className="hover:bg-gray-50">
                <td className={tdClass}>
                  {employee.first_name} {employee.last_name}
                </td>
                {absenceTypes.map((type) => (
                  <td key={type.id} className={tdClass}>
                    {cellText(matrix.get(`${employee.id}_${type.id}`))}
                  </td>
                ))}
                <td className={tdTotalClass}>{cellText(total)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className={tdTotalClass}>Łącznie</td>
            {absenceTypes.map((type) => (
              <td key={type.id} className={tdTotalClass}>
                {cellText(typeTotal(type))}
              </td>
            ))}
            <td className={tdTotalClass}>{cellText(grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function AbsenceStats({ monthlyAbsences, employees, absenceTypes, year, month }: AbsenceStatsProps) {
  const [yearlyAbsences, setYearlyAbsences] = useState<Absence[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/absences?year=${year}`, { signal: controller.signal })
      .then((r) => {
        if (r.ok) return r.json() as Promise<Absence[]>;
        throw new Error(String(r.status));
      })
      .then((data) => {
        setYearlyAbsences(data);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Błąd ładowania statystyk rocznych");
      })
      .finally(() => {
        setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [year]);

  const monthlyTitle = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1),
  );
  const capitalizedMonth = monthlyTitle.charAt(0).toUpperCase() + monthlyTitle.slice(1);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-800">Statystyki miesięczne — {capitalizedMonth}</h2>
        <StatsTable absences={monthlyAbsences} employees={employees} absenceTypes={absenceTypes} />
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-800">Statystyki roczne — {year}</h2>
        {loading ? (
          <p className="text-gray-500">Ładowanie statystyk rocznych…</p>
        ) : error ? (
          <p className="text-red-600">{error}</p>
        ) : (
          <StatsTable absences={yearlyAbsences ?? []} employees={employees} absenceTypes={absenceTypes} />
        )}
      </section>
    </div>
  );
}
