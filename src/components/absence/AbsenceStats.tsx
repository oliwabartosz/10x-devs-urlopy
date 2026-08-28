import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Absence, EmployeeListItem, AbsenceType } from "@/types";
import { formatDayCount } from "@/lib/hours";
import { buildMatrix, type MatrixData } from "@/lib/absence-stats";
import { medalRanks } from "@/lib/medals";
import { initialsOf } from "@/lib/initials";
import { avatarColor } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { withBase } from "@/lib/base-path";

interface AbsenceStatsProps {
  monthlyAbsences: Absence[];
  employees: EmployeeListItem[];
  /**
   * The yearly matrix only. Kept separate from `employees` because that list is windowed to the
   * browsed month for a moderator, and `buildMatrix` sums only over the employees it is handed —
   * so sharing one list would drop a mid-year hire out of the yearly totals. See dashboard.astro.
   */
  yearlyEmployees: EmployeeListItem[];
  absenceTypes: AbsenceType[];
  /**
   * Role alone decides the view — there is no self/team toggle. A moderator gets the team
   * matrix with medals and totals; everyone else gets a single row, their own.
   *
   * This flag only shapes the presentation. The data behind it is already scoped: the monthly
   * props are narrowed in `dashboard.astro`, and the yearly fetch below is scoped server-side
   * by `GET /api/absences/stats`, which reads the caller's role rather than anything sent.
   */
  isModerator: boolean;
  year: number;
  month: number;
}

function cellText(days: number): string {
  return days > 0 ? formatDayCount(days) : "—";
}

function KpiTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-line rounded-[14px] border bg-white px-5 py-[18px]">
      <div className="text-muted-foreground mb-2.5 text-[11px] font-bold tracking-[0.07em] uppercase">{label}</div>
      <div className="text-primary mb-2 text-[32px] leading-none font-bold">{value}</div>
      <div className="text-muted-foreground text-xs">{note}</div>
    </div>
  );
}

/**
 * Pending/error shell for every region fed by the yearly fetch in the effect below. Two regions
 * read that single fetch — the breakdown card's year side and the yearly matrix — so the copy for
 * "still loading" and "it failed" is defined here once rather than inline at each of them.
 */
function YearlyFetchSlot({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: string | null;
  children: ReactNode;
}) {
  if (loading) return <p className="text-muted-foreground">Ładowanie statystyk rocznych…</p>;
  if (error) return <p className="text-destructive">{error}</p>;
  return <>{children}</>;
}

// Segmented pill control, the same idiom as the dashboard tab bar (dashboard.astro:229-232) one
// size down so it sits inside a card header rather than above the card.
const segBase = "cursor-pointer px-3 py-1 text-xs transition-colors";
const segOn = "bg-primary text-primary-foreground font-bold";
const segOff = "bg-white text-muted-foreground hover:text-primary";

/**
 * One card, two periods, switched in place — not two stacked cards. The type split reads very
 * differently over a year than over a month, and putting both in one frame makes that a toggle
 * rather than a scroll. The year is the default: it is the figure that sets context for the
 * month beside it and for the matrices below.
 *
 * Only the year side is fed by the client fetch, so only its body carries the pending/error
 * shell; the month side is server-rendered and always present.
 */
function TypeBreakdown({
  absenceTypes,
  yearlyData,
  monthlyData,
  yearLabel,
  monthLabel,
  loading,
  error,
}: {
  absenceTypes: AbsenceType[];
  yearlyData: MatrixData;
  monthlyData: MatrixData;
  yearLabel: string;
  monthLabel: string;
  loading: boolean;
  error: string | null;
}) {
  const [period, setPeriod] = useState<"year" | "month">("year");
  const isYear = period === "year";
  const data = isYear ? yearlyData : monthlyData;

  const rows = absenceTypes.map((type, i) => {
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
        <div className="text-muted-foreground text-right text-xs">{`${String(Math.round(share))}%`}</div>
      </div>
    );
  });

  return (
    <div className="border-line overflow-hidden rounded-[14px] border bg-white">
      <div className="border-b-line-strong flex flex-wrap items-center justify-between gap-3 border-b px-[18px] py-[15px]">
        <h3 className="text-primary m-0 text-[15px] font-bold">Podział wg typu nieobecności</h3>
        <div className="flex items-center gap-3">
          {/* The concrete period stays on screen — the buttons say which axis, not which year. */}
          <span className="text-muted-foreground text-xs">{isYear ? yearLabel : monthLabel}</span>
          <div className="border-line flex overflow-hidden rounded-[10px] border">
            <button
              type="button"
              aria-pressed={isYear}
              onClick={() => {
                setPeriod("year");
              }}
              className={cn(segBase, isYear ? segOn : segOff)}
            >
              Rok
            </button>
            <button
              type="button"
              aria-pressed={!isYear}
              onClick={() => {
                setPeriod("month");
              }}
              className={cn("border-line border-l", segBase, isYear ? segOff : segOn)}
            >
              Miesiąc
            </button>
          </div>
        </div>
      </div>
      <div className="px-[18px] pt-2 pb-4">
        {isYear ? (
          <YearlyFetchSlot loading={loading} error={error}>
            {rows}
          </YearlyFetchSlot>
        ) : (
          rows
        )}
      </div>
    </div>
  );
}

interface StatsMatrixCardProps {
  title: string;
  subtitle?: string;
  employees: EmployeeListItem[];
  absenceTypes: AbsenceType[];
  data: MatrixData;
  /** Yearly matrix only — 🥇🥈🥉 per type column and on the Łącznie column. */
  showMedals?: boolean;
  /**
   * Omit the bottom `Łącznie` band. Set in the single-row self view, where that band is a
   * verbatim copy of the one data row above it. The per-row `Łącznie` column stays either way.
   */
  hideTotalsRow?: boolean;
}

function StatsMatrixCard({
  title,
  subtitle,
  employees,
  absenceTypes,
  data,
  showMedals,
  hideTotalsRow,
}: StatsMatrixCardProps) {
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

          {!hideTotalsRow && (
            <div className="grid items-center bg-[#f4f6f8] py-3" style={{ gridTemplateColumns: gridTemplate }}>
              <div className="text-primary px-4 text-xs font-bold tracking-[0.05em] uppercase">Łącznie</div>
              {absenceTypes.map((type, i) => (
                <div
                  key={type.id}
                  className={cn(
                    "text-center text-[13px] font-bold",
                    data.perType[i] > 0 ? "text-primary" : "text-line",
                  )}
                >
                  {cellText(data.perType[i])}
                </div>
              ))}
              <div
                className={cn("px-4 text-right text-[13px] font-bold", data.grand > 0 ? "text-primary" : "text-line")}
              >
                {cellText(data.grand)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AbsenceStats({
  monthlyAbsences,
  employees,
  yearlyEmployees,
  absenceTypes,
  isModerator,
  year,
  month,
}: AbsenceStatsProps) {
  const [yearlyAbsences, setYearlyAbsences] = useState<Absence[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Every yearly figure below — medals, totals, the stacked bars — aggregates over this
  // list. A server-side cap would skew all of them at once, so it has to be visible.
  const [truncated, setTruncated] = useState(false);
  const fetchedYear = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Reset on a *year change* only, in the spirit of AbsenceDetailsSubcards.tsx:168-170 — a stale
    // error would otherwise outlive a successful retry, and the previous year's rows would sit
    // under the new year's heading. On mount the initial state already says exactly this, so the
    // guard keeps the effect from setting state synchronously on first render.
    // Month/year navigation is a full page load today, so the island remounts and this is belt and
    // braces; it stops being belt and braces the moment that navigation goes client-side.
    if (fetchedYear.current !== null && fetchedYear.current !== year) {
      setError(null);
      setLoading(true);
      setTruncated(false);
    }
    fetchedYear.current = year;
    // The scoped counterpart to GET /api/absences, which stays team-wide for the grid and
    // Szczegóły. Both roles call it; the server decides what comes back.
    fetch(withBase(`/api/absences/stats?year=${year}`), { signal: controller.signal })
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
    () => buildMatrix(yearlyAbsences ?? [], yearlyEmployees, absenceTypes),
    [yearlyAbsences, yearlyEmployees, absenceTypes],
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
        {isModerator ? (
          <KpiTile
            label="Pracownicy z nieobecnością"
            // Denominator is the passed employees prop, already visibleEmployeesFilter()-scoped.
            value={`${String(monthlyData.employeesWithAbsence)} / ${String(employees.length)}`}
            note="w tym miesiącu"
          />
        ) : (
          // "N / M" is meaningless at M=1, so the self view spends the tile on year-to-date
          // instead. It reads off the yearly fetch, so unlike the month tile beside it, it has
          // a pending state — a placeholder rather than a 0 that would read as a real figure.
          <KpiTile
            label="Dni nieobecności w tym roku"
            value={loading || error ? "—" : cellText(yearlyData.grand)}
            // The raw error is an HTTP status; it stays in the paragraph below, where it has
            // room. Here it only has to say "this is not a real figure".
            note={error ? "Błąd ładowania" : `Rok ${String(year)}`}
          />
        )}
      </div>

      <TypeBreakdown
        absenceTypes={absenceTypes}
        yearlyData={yearlyData}
        monthlyData={monthlyData}
        yearLabel={`Rok ${String(year)}`}
        monthLabel={capitalizedMonth}
        loading={loading}
        error={error}
      />

      <StatsMatrixCard
        title={
          isModerator
            ? `Statystyki miesięczne – ${capitalizedMonth}`
            : `Moje statystyki miesięczne – ${capitalizedMonth}`
        }
        employees={employees}
        absenceTypes={absenceTypes}
        data={monthlyData}
        hideTotalsRow={!isModerator}
      />

      <YearlyFetchSlot loading={loading} error={error}>
        <StatsMatrixCard
          title={
            isModerator ? `Statystyki roczne – Rok ${String(year)}` : `Moje statystyki roczne – Rok ${String(year)}`
          }
          subtitle={
            isModerator ? "narastająco od stycznia · 🥇🥈🥉 najwięcej dni w kolumnie" : "narastająco od stycznia"
          }
          employees={yearlyEmployees}
          absenceTypes={absenceTypes}
          data={yearlyData}
          showMedals={isModerator}
          hideTotalsRow={!isModerator}
        />
      </YearlyFetchSlot>
    </div>
  );
}
