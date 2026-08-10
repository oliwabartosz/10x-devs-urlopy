import { useState, useMemo } from "react";
import type { Absence, Employee, AbsenceType } from "@/types";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/initials";
import { avatarColor } from "@/lib/avatar";

interface AbsenceDetailsTableProps {
  absences: Absence[];
  employees: Employee[];
  absenceTypes: AbsenceType[];
  className?: string;
  emptyLabel?: string;
  /** Called for rows the caller may edit; omit to make every row inert. */
  onRowClick?: (absence: Absence, employee: Employee) => void;
  /** True when the caller may edit this absence. Defaults to "nobody". */
  canEdit?: (absence: Absence, employee: Employee | undefined) => boolean;
}

type SortColumn = "date" | "type" | "employee" | "substitute" | "time" | "created_at";

// Six columns: FR-006 requires the creation date, so `Dodano` stays and this diverges
// from the prototype's five-column grid on purpose (prd.md:82).
const GRID_TEMPLATE = "112px minmax(200px,1fr) 190px 170px 120px 110px";

const SORT_COLUMNS: { id: SortColumn; label: string; align: "left" | "right" }[] = [
  { id: "date", label: "Data", align: "left" },
  { id: "type", label: "Typ", align: "left" },
  { id: "employee", label: "Pracownik", align: "left" },
  { id: "substitute", label: "Zastępstwo", align: "left" },
  { id: "time", label: "Czas", align: "right" },
  { id: "created_at", label: "Dodano", align: "right" },
];

function resolveEmployee(id: string | null, employees: Employee[]): Employee | undefined {
  if (!id) return undefined;
  return employees.find((e) => e.id === id);
}

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

// `created_at` is a timestamptz. `toISOString()` shifts it to UTC before the date is
// sliced off, so anything created between local midnight and the UTC offset renders as
// the previous day (01:30 in Warsaw reads as yesterday). Build from local components so
// `Dodano` agrees with every other date in this table, which are all local.
function localIsoDate(timestamp: Date | string): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIsoDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatAbsenceTime(absence: Absence): string {
  if (absence.is_full_day) return "Cały dzień";
  return `${absence.start_time?.slice(0, 5) ?? "?"}–${absence.end_time?.slice(0, 5) ?? "?"}`;
}

function fullName(e: Employee | undefined): string {
  return e ? `${e.first_name} ${e.last_name}` : "";
}

export default function AbsenceDetailsTable({
  absences,
  employees,
  absenceTypes,
  className,
  emptyLabel = "Brak nieobecności",
  onRowClick,
  canEdit,
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

  const weekdayFmt = useMemo(() => new Intl.DateTimeFormat("pl-PL", { weekday: "short" }), []);

  const sorted = useMemo(() => {
    const copy = [...absences];
    const dir = sort.direction === "asc" ? 1 : -1;

    copy.sort((a, b) => {
      switch (sort.column) {
        case "date":
          return a.date.localeCompare(b.date) * dir;
        case "created_at":
          return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
        case "employee": {
          const ea = resolveEmployee(a.employee_id, employees);
          const eb = resolveEmployee(b.employee_id, employees);
          const la = ea ? `${ea.last_name} ${ea.first_name}` : "";
          const lb = eb ? `${eb.last_name} ${eb.first_name}` : "";
          return la.localeCompare(lb, "pl") * dir;
        }
        case "substitute": {
          // Rows without a substitute sort last in both directions' natural reading:
          // the sentinel keeps them together rather than interleaving with real names.
          const sa = resolveEmployee(a.substitute_employee_id, employees);
          const sb = resolveEmployee(b.substitute_employee_id, employees);
          const la = sa ? `${sa.last_name} ${sa.first_name}` : "￿";
          const lb = sb ? `${sb.last_name} ${sb.first_name}` : "￿";
          return la.localeCompare(lb, "pl") * dir;
        }
        case "time": {
          // Full-day entries have no start_time; park them after every timed entry.
          const ta = a.is_full_day ? "99:99" : (a.start_time ?? "99:99");
          const tb = b.is_full_day ? "99:99" : (b.start_time ?? "99:99");
          return ta.localeCompare(tb) * dir;
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
    if (sort.column !== column) return "↕";
    return sort.direction === "asc" ? "↑" : "↓";
  }

  if (sorted.length === 0) {
    return <div className="px-[18px] py-[34px] text-center text-[13px] text-[#9a9a9a]">{emptyLabel}</div>;
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <div className="min-w-[940px]">
        <div
          className="border-b-line-strong grid items-center gap-[14px] border-b bg-[#f4f6f8] px-[18px] py-2.5"
          style={{ gridTemplateColumns: GRID_TEMPLATE }}
        >
          {SORT_COLUMNS.map((col) => (
            <button
              key={col.id}
              type="button"
              onClick={() => {
                toggleSort(col.id);
              }}
              className={cn(
                "text-muted-foreground hover:text-primary flex items-center gap-1.5 text-[11px] font-bold tracking-[0.06em] uppercase",
                col.align === "right" ? "justify-end" : "justify-start",
                sort.column === col.id && "text-primary",
              )}
            >
              <span>{col.label}</span>
              <span className={sort.column === col.id ? "opacity-100" : "opacity-40"}>{sortIndicator(col.id)}</span>
            </button>
          ))}
        </div>

        {sorted.map((absence) => {
          const employeeIndex = employees.findIndex((e) => e.id === absence.employee_id);
          const employee = employeeIndex >= 0 ? employees[employeeIndex] : undefined;
          const substitute = resolveEmployee(absence.substitute_employee_id, employees);
          const absenceType = absenceTypeMap.get(absence.absence_type_id);
          const editable = !!onRowClick && !!employee && !!canEdit?.(absence, employee);
          const date = parseIsoDate(absence.date);

          return (
            <div
              key={absence.id}
              // Rows the caller may not edit stay inert and gain no hover cue — the same
              // rule the grid cell applies (AbsenceGrid.tsx clickability).
              className={cn(
                "grid items-center gap-[14px] border-b border-[#f2f2f2] px-[18px] py-3",
                editable ? "cursor-pointer hover:bg-[#f7fafc]" : "cursor-default",
              )}
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
              onClick={
                editable
                  ? () => {
                      onRowClick(absence, employee);
                    }
                  : undefined
              }
            >
              <div>
                <div className="text-sm font-bold text-black">{formatDate(absence.date)}</div>
                <div className="text-muted-foreground text-xs">{weekdayFmt.format(date)}</div>
              </div>

              <div className="flex flex-col items-start gap-[5px]">
                {absenceType ? (
                  <span
                    className="inline-flex items-center gap-[7px] rounded-full px-[11px] py-[5px] text-xs font-bold whitespace-nowrap"
                    style={{ backgroundColor: absenceType.color, color: absenceType.text_color }}
                  >
                    {absenceType.icon && <span className="text-[13px] leading-none">{absenceType.icon}</span>}
                    <span>{absenceType.name}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
                {absence.comment && <span className="text-muted-foreground text-xs">„{absence.comment}”</span>}
              </div>

              <div className="flex items-center gap-[9px]">
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: avatarColor(employeeIndex) }}
                >
                  {initialsOf(fullName(employee))}
                </span>
                <span className="truncate text-[13px] text-black">{fullName(employee) || "—"}</span>
              </div>

              <div className="text-muted-foreground truncate text-[13px]">{fullName(substitute) || "—"}</div>

              <div className="text-right">
                <span
                  className={cn(
                    "inline-block rounded-full px-[9px] py-1 text-xs font-bold",
                    absence.is_full_day
                      ? "text-muted-foreground border border-transparent"
                      : "text-primary border border-[#d7e2ee] bg-[#eef3f8]",
                  )}
                >
                  {formatAbsenceTime(absence)}
                </span>
              </div>

              <div className="text-muted-foreground text-right text-[13px]">
                {formatDate(localIsoDate(absence.created_at))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
