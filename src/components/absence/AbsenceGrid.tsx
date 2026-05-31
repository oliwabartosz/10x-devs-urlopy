import { useState } from "react";
import type { Employee, Absence, AbsenceType } from "@/types";
import { AbsenceFormDialog } from "./AbsenceFormDialog";

interface AbsenceGridProps {
  employees: Employee[];
  absences: Absence[];
  absenceTypes: AbsenceType[];
  currentEmployee: Employee;
  year: number;
  month: number;
}

function getDaysInMonth(year: number, month: number): Date[] {
  // month is 1-indexed; new Date(year, month, 0) gives the last day of that month
  const count = new Date(year, month, 0).getDate();
  const days: Date[] = [];
  for (let d = 1; d <= count; d++) {
    days.push(new Date(year, month - 1, d));
  }
  return days;
}

export default function AbsenceGrid({
  employees,
  absences,
  absenceTypes,
  currentEmployee,
  year,
  month,
}: AbsenceGridProps) {
  const isModerator = currentEmployee.role === "moderator";

  const [dialogState, setDialogState] = useState<{
    day: Date;
    absence: Absence | null;
    targetEmployee: Employee;
  } | null>(null);

  const days = getDaysInMonth(year, month);

  const absenceMap = new Map<string, Absence>();
  for (const absence of absences) {
    absenceMap.set(`${absence.employee_id}_${absence.date}`, absence);
  }

  const absenceTypeMap = new Map<number, AbsenceType>();
  for (const type of absenceTypes) {
    absenceTypeMap.set(type.id, type);
  }

  const weekdayFmt = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });

  return (
    <div className="p-4">
      <div className="overflow-x-auto rounded border">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 min-w-[80px] border-r border-b bg-white px-2 py-1 text-left text-xs font-normal text-gray-500">
                Dzień
              </th>
              {employees.map((emp) => {
                const isOwn = emp.id === currentEmployee.id;
                return (
                  <th
                    key={emp.id}
                    className={`max-w-[50px] min-w-[40px] border-r border-b ${isOwn ? "bg-blue-50" : "bg-gray-50"}`}
                  >
                    <span
                      className="block px-1 py-2 text-xs font-medium whitespace-nowrap"
                      style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                    >
                      {emp.first_name} {emp.last_name}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {days.map((date) => {
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              const dateStr = `${date.getFullYear().toString()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

              return (
                <tr key={dateStr} className={isWeekend ? "bg-gray-100" : undefined}>
                  <td
                    className={`sticky left-0 z-10 border-r border-b px-2 py-1 text-xs whitespace-nowrap ${isWeekend ? "bg-gray-100" : "bg-white"}`}
                  >
                    <span className="font-medium text-gray-700">{date.getDate()}</span>
                    <span className="ml-1 text-gray-400">{weekdayFmt.format(date)}</span>
                  </td>
                  {employees.map((emp) => {
                    const isOwn = emp.id === currentEmployee.id;
                    const absence = absenceMap.get(`${emp.id}_${dateStr}`);
                    const absenceType = absence ? absenceTypeMap.get(absence.absence_type_id) : undefined;
                    const clickable = (isOwn || isModerator) && !isWeekend;

                    return (
                      <td
                        key={emp.id}
                        className={`border-r border-b p-0.5 ${clickable ? "cursor-pointer" : "cursor-default"}`}
                        onClick={
                          clickable
                            ? () => {
                                setDialogState({ day: date, absence: absence ?? null, targetEmployee: emp });
                              }
                            : undefined
                        }
                      >
                        {absenceType ? (
                          <div
                            className="h-5 w-full rounded-sm"
                            style={{ backgroundColor: absenceType.color }}
                            title={absenceType.name}
                          />
                        ) : (
                          clickable && (
                            <div className="flex h-5 w-full items-center justify-center text-xs text-gray-300">+</div>
                          )
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {absenceTypes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {absenceTypes.map((type) => (
            <span key={type.id} className="flex items-center gap-1 text-xs text-gray-600">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: type.color }} />
              {type.name}
            </span>
          ))}
        </div>
      )}

      {dialogState && (
        <AbsenceFormDialog
          key={`${dialogState.day.toLocaleDateString("sv")}_${dialogState.absence?.id ?? "new"}`}
          open
          onOpenChange={(open) => {
            if (!open) setDialogState(null);
          }}
          day={dialogState.day}
          existingAbsence={dialogState.absence}
          absenceTypes={absenceTypes}
          employees={employees}
          currentEmployee={currentEmployee}
        />
      )}
    </div>
  );
}
