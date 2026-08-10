import { useEffect, useMemo, useState } from "react";
import type { Absence, Employee, AbsenceType } from "@/types";
import { FULL_DAY_HOURS, hoursToDays, formatDayCount } from "@/lib/hours";
import { medalRanks } from "@/lib/medals";
import { initialsOf } from "@/lib/initials";
import { avatarColor } from "@/lib/avatar";
import { cn } from "@/lib/utils";

interface AbsenceStatsProps {
  monthlyAbsences: Absence[];
  employees: Employee[];
  absenceTypes: AbsenceType[];
  year: number;
  month: number;
}

function getAbsenceHours(a: Absence): number {
  if (a.is_full_day) return FULL_DAY_HOURS;
  const [sh, sm] = (a.start_time ?? "00:00").slice(0, 5).split(":").map(Number);
  const [eh, em] = (a.end_time ?? "00:00").slice(0, 5).split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

interface MatrixData {
  /** `${employeeId}_${typeId}` → day count (partial days folded in as fractions). */
  cells: Map<string, number>;
  /** Parallel to `employees`. */
  perEmployee: number[];
  /** Parallel to `absenceTypes`. */
  perType: number[];
  grand: number;
  maxEmployeeTotal: number;
  employeesWithAbsence: number;
}

// The split between whole days and partial hours is still needed to convert correctly —
// only the *display* collapses to one figure (reverses S-02's separate-units decision,
// context/archive/2026-05-30-details-and-stats/plan-brief.md:24).
function buildMatrix(absences: Absence[], employees: Employee[], absenceTypes: AbsenceType[]): MatrixData {
  const raw = new Map<string, { days: number; hours: number }>();
  for (const absence of absences) {
    const key = `${absence.employee_id}_${absence.absence_type_id}`;
    const current = raw.get(key) ?? { days: 0, hours: 0 };
    if (absence.is_full_day) current.days += 1;
    else current.hours += getAbsenceHours(absence);
    raw.set(key, current);
  }

  const cells = new Map<string, number>();
  for (const [key, { days, hours }] of raw) {
    cells.set(key, days + hoursToDays(hours));
  }

  const perEmployee = employees.map((emp) =>
    absenceTypes.reduce((sum, type) => sum + (cells.get(`${emp.id}_${type.id}`) ?? 0), 0),
  );
  const perType = absenceTypes.map((type) =>
    employees.reduce((sum, emp) => sum + (cells.get(`${emp.id}_${type.id}`) ?? 0), 0),
  );

  return {
    cells,
    perEmployee,
    perType,
    grand: perType.reduce((a, b) => a + b, 0),
    maxEmployeeTotal: Math.max(1, ...perEmployee),
    employeesWithAbsence: perEmployee.filter((t) => t > 0).length,
  };
}

function cellText(days: number): string {
  return days > 0 ? formatDayCount(days) : "—";
}

function KpiTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-line rounded-[14px] border bg-white px-5 py-[18px]">
      <div className="text-muted-foreground mb-2.5 text-[11px] font-bold tracking-[0.07em] uppercase">{label}</div>
      <div className="text-primary mb-2 text-[32px] leading-none font-bold">{value}</div>
      <div className="text-xs text-[#9a9a9a]">{note}</div>
    </div>
  );
}

function TypeBreakdown({
  absenceTypes,
  data,
  period,
}: {
  absenceTypes: AbsenceType[];
  data: MatrixData;
  period: string;
}) {
  return (
    <div className="border-line overflow-hidden rounded-[14px] border bg-white">
      <div className="border-b-line-strong flex items-baseline justify-between gap-3 border-b px-[18px] py-[15px]">
        <h3 className="text-primary m-0 text-[15px] font-bold">Podział wg typu nieobecności</h3>
        <span className="text-muted-foreground text-xs">{period}</span>
      </div>
      <div className="px-[18px] pt-2 pb-4">
        {absenceTypes.map((type, i) => {
          const days = data.perType[i];
          const share = data.grand > 0 ? (days / data.grand) * 100 : 0;
          return (
            <div
              key={type.id}
              className="grid items-center gap-[14px] py-[9px]"
              style={{ gridTemplateColumns: "280px 1fr 90px 60px" }}
            >
              <div className="flex items-center gap-2 text-[13px] text-black">
                <span className="text-sm leading-none">{type.icon}</span>
                <span className="truncate">{type.name}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-[#f2f2f2]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${String(Math.round(share))}%`, backgroundColor: type.color }}
                />
              </div>
              <div className="text-primary text-[13px] font-bold">{cellText(days)}</div>
              <div className="text-right text-xs text-[#9a9a9a]">{`${String(Math.round(share))}%`}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface StatsMatrixCardProps {
  title: string;
  subtitle?: string;
  employees: Employee[];
  absenceTypes: AbsenceType[];
  data: MatrixData;
  /** Yearly matrix only — 🥇🥈🥉 per type column and on the Łącznie column. */
  showMedals?: boolean;
}

function StatsMatrixCard({ title, subtitle, employees, absenceTypes, data, showMedals }: StatsMatrixCardProps) {
  const gridTemplate = `240px repeat(${String(absenceTypes.length)},1fr) 150px`;

  const medalsByType = useMemo(() => {
    if (!showMedals) return null;
    return absenceTypes.map((type) => medalRanks(employees.map((emp) => data.cells.get(`${emp.id}_${type.id}`) ?? 0)));
  }, [showMedals, absenceTypes, employees, data]);

  const medalsTotal = useMemo(() => (showMedals ? medalRanks(data.perEmployee) : null), [showMedals, data.perEmployee]);

  return (
    <div className="border-line overflow-hidden rounded-[14px] border bg-white">
      <div className="border-b-line-strong flex items-baseline justify-between gap-3 border-b px-[18px] py-[15px]">
        <h3 className="text-primary m-0 text-[15px] font-bold">{title}</h3>
        {subtitle && <span className="text-muted-foreground text-xs">{subtitle}</span>}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1120px]">
          <div
            className="border-b-line-strong grid border-b bg-[#f4f6f8]"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div className="text-muted-foreground px-4 py-3 text-[11px] font-bold tracking-[0.06em] uppercase">
              Pracownik
            </div>
            {absenceTypes.map((type) => (
              <div key={type.id} title={type.name} className="px-2 py-2.5 text-center">
                <span
                  className="mx-auto mb-[5px] block size-[9px] rounded-full"
                  style={{ backgroundColor: type.color }}
                />
                <span className="text-[15px] leading-none">{type.icon}</span>
              </div>
            ))}
            <div className="text-muted-foreground px-4 py-3 text-right text-[11px] font-bold tracking-[0.06em] uppercase">
              Łącznie
            </div>
          </div>

          {employees.map((employee, empIndex) => {
            const total = data.perEmployee[empIndex];
            const totalMedal = medalsTotal?.get(empIndex);
            return (
              <div
                key={employee.id}
                className="grid items-center border-b border-[#f2f2f2] py-2.5 hover:bg-[#f7fafc]"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div className="flex min-w-0 items-center gap-2.5 px-4">
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: avatarColor(empIndex) }}
                  >
                    {initialsOf(`${employee.first_name} ${employee.last_name}`)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-black">
                      {employee.first_name} {employee.last_name}
                    </div>
                    {/* Scaled to the busiest employee's total so rows are comparable. */}
                    <div
                      className="mt-1 flex h-2 overflow-hidden rounded-full bg-[#f0f0f0]"
                      style={{
                        width: `${String(Math.round((total / data.maxEmployeeTotal) * 100))}%`,
                        minWidth: total > 0 ? "6px" : "0",
                      }}
                    >
                      {absenceTypes.map((type, i) => {
                        const days = data.cells.get(`${employee.id}_${type.id}`) ?? 0;
                        if (days <= 0) return null;
                        return (
                          <div
                            key={type.id}
                            title={`${type.name}: ${formatDayCount(days)}`}
                            style={{ flex: `${String(days)} 0 0`, backgroundColor: absenceTypes[i].color }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>

                {absenceTypes.map((type, typeIndex) => {
                  const days = data.cells.get(`${employee.id}_${type.id}`) ?? 0;
                  const medal = medalsByType?.[typeIndex].get(empIndex);
                  return (
                    <div
                      key={type.id}
                      className={cn("text-center text-[13px]", days > 0 ? "font-bold text-black" : "text-line")}
                    >
                      {medal ? `${medal} ` : ""}
                      {cellText(days)}
                    </div>
                  );
                })}

                <div className={cn("px-4 text-right text-[13px] font-bold", total > 0 ? "text-primary" : "text-line")}>
                  {totalMedal ? `${totalMedal} ` : ""}
                  {cellText(total)}
                </div>
              </div>
            );
          })}

          <div className="grid items-center bg-[#f4f6f8] py-3" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="text-primary px-4 text-xs font-bold tracking-[0.05em] uppercase">Łącznie</div>
            {absenceTypes.map((type, i) => (
              <div
                key={type.id}
                className={cn("text-center text-[13px] font-bold", data.perType[i] > 0 ? "text-primary" : "text-line")}
              >
                {cellText(data.perType[i])}
              </div>
            ))}
            <div className={cn("px-4 text-right text-[13px] font-bold", data.grand > 0 ? "text-primary" : "text-line")}>
              {cellText(data.grand)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AbsenceStats({ monthlyAbsences, employees, absenceTypes, year, month }: AbsenceStatsProps) {
  const [yearlyAbsences, setYearlyAbsences] = useState<Absence[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Every yearly figure below — medals, totals, the stacked bars — aggregates over this
  // list. A server-side cap would skew all of them at once, so it has to be visible.
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/absences?year=${year}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        setTruncated(r.headers.get("X-Result-Truncated") === "1");
        return r.json() as Promise<Absence[]>;
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

  // Aggregations are memoised because this phase roughly doubled how many of them run
  // over a list capped at 5000 rows; the functions themselves are unchanged and pure.
  const monthlyData = useMemo(
    () => buildMatrix(monthlyAbsences, employees, absenceTypes),
    [monthlyAbsences, employees, absenceTypes],
  );
  const yearlyData = useMemo(
    () => buildMatrix(yearlyAbsences ?? [], employees, absenceTypes),
    [yearlyAbsences, employees, absenceTypes],
  );

  const monthlyTitle = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1),
  );
  const capitalizedMonth = monthlyTitle.charAt(0).toUpperCase() + monthlyTitle.slice(1);

  return (
    <div className="flex flex-col gap-5">
      {truncated && (
        <p className="border-destructive text-destructive rounded-[14px] border bg-white px-[18px] py-3.5 text-sm">
          Lista roczna została przycięta przez serwer — statystyki roczne są niepełne.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4">
        <KpiTile label="Dni nieobecności" value={cellText(monthlyData.grand)} note={capitalizedMonth} />
        <KpiTile
          label="Pracownicy z nieobecnością"
          // Denominator is the passed employees prop, already visibleEmployeesFilter()-scoped.
          value={`${String(monthlyData.employeesWithAbsence)} / ${String(employees.length)}`}
          note="w tym miesiącu"
        />
      </div>

      <TypeBreakdown absenceTypes={absenceTypes} data={monthlyData} period={capitalizedMonth} />

      <StatsMatrixCard
        title={`Statystyki miesięczne – ${capitalizedMonth}`}
        employees={employees}
        absenceTypes={absenceTypes}
        data={monthlyData}
      />

      {loading ? (
        <p className="text-muted-foreground">Ładowanie statystyk rocznych…</p>
      ) : error ? (
        <p className="text-destructive">{error}</p>
      ) : (
        <StatsMatrixCard
          title={`Statystyki roczne – Rok ${String(year)}`}
          subtitle="narastająco od stycznia · 🥇🥈🥉 najwięcej dni w kolumnie"
          employees={employees}
          absenceTypes={absenceTypes}
          data={yearlyData}
          showMedals
        />
      )}
    </div>
  );
}
