import { useState, useEffect, useRef } from "react";
import type { Absence, Employee, AbsenceType } from "@/types";
import AbsenceDetailsTable from "@/components/absence/AbsenceDetailsTable";
import { AbsenceFormDialog } from "@/components/absence/AbsenceFormDialog";
import { entryCountLabel } from "@/lib/plural";
import { cn } from "@/lib/utils";
import {
  toggleHidden,
  clearHidden,
  hideAll,
  filterToggleAction,
  isFilterActive,
  visibleByType,
} from "@/lib/type-filter";

interface AbsenceDetailsSubcardsProps {
  absences: Absence[];
  employees: Employee[];
  absenceTypes: AbsenceType[];
  currentEmployee: Pick<Employee, "id" | "first_name" | "last_name" | "role">;
  year: number;
  month: number;
  initialSubcard: "today" | "monthly" | "yearly";
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeekRange() {
  const today = new Date();
  const daysFromMonday = (today.getDay() + 6) % 7;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - daysFromMonday);
  const thisFriday = new Date(thisMonday);
  thisFriday.setDate(thisMonday.getDate() + 4);
  const nextMonday = new Date(thisMonday);
  nextMonday.setDate(thisMonday.getDate() + 7);
  const nextFriday = new Date(thisMonday);
  nextFriday.setDate(thisMonday.getDate() + 11);
  return {
    from: isoDate(thisMonday),
    to: isoDate(nextFriday),
    todayStr: isoDate(today),
    thisWeekStart: isoDate(thisMonday),
    thisWeekEnd: isoDate(thisFriday),
    nextWeekStart: isoDate(nextMonday),
    nextWeekEnd: isoDate(nextFriday),
  };
}

const weekRange = getWeekRange();

function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

interface GroupCardProps {
  title: string;
  rows: Absence[];
  employees: Employee[];
  absenceTypes: AbsenceType[];
  emptyLabel?: string;
  onRowClick: (absence: Absence, employee: Employee) => void;
  canEdit: (absence: Absence, employee: Employee | undefined) => boolean;
}

// Module scope on purpose: declared inside the parent's render, every re-render would
// produce a new component type and reset each table's sort state.
function GroupCard({ title, rows, employees, absenceTypes, emptyLabel, onRowClick, canEdit }: GroupCardProps) {
  return (
    <div className="border-line overflow-hidden rounded-[14px] border bg-white">
      <div className="border-b-line-strong flex items-center justify-between gap-3 border-b px-[18px] py-[15px]">
        <h3 className="text-primary m-0 text-[15px] font-bold">{title}</h3>
        <span className="text-muted-foreground text-xs">{entryCountLabel(rows.length)}</span>
      </div>
      <AbsenceDetailsTable
        absences={rows}
        employees={employees}
        absenceTypes={absenceTypes}
        emptyLabel={emptyLabel}
        onRowClick={onRowClick}
        canEdit={canEdit}
      />
    </div>
  );
}

export default function AbsenceDetailsSubcards({
  absences,
  employees,
  absenceTypes,
  currentEmployee,
  year,
  month,
  initialSubcard,
}: AbsenceDetailsSubcardsProps) {
  const isModerator = currentEmployee.role === "moderator";

  const [activeSubcard, setActiveSubcard] = useState<"today" | "monthly" | "yearly">(initialSubcard);
  const todayFetched = useRef(false);
  const yearlyFetched = useRef(false);

  // Set of *hidden* type ids. Clearing empties it, restoring everything — the prototype's
  // clearFilters (`10xUrlopy.dc.html:1321`) does the opposite and hides every type.
  const [hiddenTypeIds, setHiddenTypeIds] = useState<ReadonlySet<number>>(() => new Set());

  const [dialogState, setDialogState] = useState<{ day: Date; absence: Absence; targetEmployee: Employee } | null>(
    null,
  );

  const [weekAbsences, setWeekAbsences] = useState<Absence[] | null>(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekError, setWeekError] = useState<string | null>(null);

  const [yearlyAbsences, setYearlyAbsences] = useState<Absence[] | null>(null);
  const [yearlyLoading, setYearlyLoading] = useState(false);
  const [yearlyError, setYearlyError] = useState<string | null>(null);
  // The API caps a list response; the group counts below aggregate over the whole year, so
  // a partial list has to say so rather than quietly reporting a smaller number.
  const [yearlyTruncated, setYearlyTruncated] = useState(false);

  function handleSetSubcard(sub: "today" | "monthly" | "yearly") {
    setActiveSubcard(sub);
    const params = new URLSearchParams(window.location.search);
    params.set("subcard", sub);
    history.pushState(null, "", "?" + params.toString());
  }

  function toggleType(id: number) {
    setHiddenTypeIds((prev) => toggleHidden(prev, id));
  }

  useEffect(() => {
    if (activeSubcard !== "today" || todayFetched.current) return;
    const controller = new AbortController();
    setWeekLoading(true);
    fetch(`/api/absences?from=${weekRange.from}&to=${weekRange.to}`, { signal: controller.signal })
      .then((r) => {
        if (r.ok) return r.json() as Promise<Absence[]>;
        throw new Error(String(r.status));
      })
      .then((data) => {
        // Mark fetched only once the data has landed. Setting it before the request
        // resolves strands the panel on "Ładowanie…" forever when the cleanup below
        // aborts a switch-away and the guard then blocks the refetch on switch-back.
        todayFetched.current = true;
        setWeekAbsences(data);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setWeekError(err instanceof Error ? err.message : "Błąd ładowania");
      })
      .finally(() => {
        setWeekLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [activeSubcard]);

  useEffect(() => {
    if (activeSubcard !== "yearly" || yearlyFetched.current) return;
    const controller = new AbortController();
    setYearlyLoading(true);
    fetch(`/api/absences?year=${year}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        setYearlyTruncated(r.headers.get("X-Result-Truncated") === "1");
        return r.json() as Promise<Absence[]>;
      })
      .then((data) => {
        // See the today effect: the flag lands with the data, not before it.
        yearlyFetched.current = true;
        setYearlyAbsences(data);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setYearlyError(err instanceof Error ? err.message : "Błąd ładowania rocznych nieobecności");
      })
      .finally(() => {
        setYearlyLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [activeSubcard, year]);

  const visible = (list: Absence[]) => visibleByType(list, hiddenTypeIds);

  const todayAbsences = visible((weekAbsences ?? []).filter((a) => a.date === weekRange.todayStr));
  const thisWeekAbsences = visible(
    (weekAbsences ?? []).filter((a) => a.date >= weekRange.thisWeekStart && a.date <= weekRange.thisWeekEnd),
  );
  const nextWeekAbsences = visible(
    (weekAbsences ?? []).filter((a) => a.date >= weekRange.nextWeekStart && a.date <= weekRange.nextWeekEnd),
  );

  const monthTitle = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1),
  );
  const capitalizedMonth = monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1);

  // Same permission rule as the grid cell: own absence, or moderator; never on a
  // deactivated employee's row.
  function canEdit(_absence: Absence, employee: Employee | undefined): boolean {
    if (!employee || employee.deleted_at) return false;
    return employee.id === currentEmployee.id || isModerator;
  }

  function openRow(absence: Absence, employee: Employee) {
    setDialogState({ day: parseIsoDate(absence.date), absence, targetEmployee: employee });
  }

  const segButton = (sub: "today" | "monthly" | "yearly") =>
    cn(
      "rounded-full border px-4 py-2 text-[13px] transition-colors",
      activeSubcard === sub
        ? "border-primary bg-primary text-primary-foreground font-bold"
        : "border-line text-primary bg-white hover:border-primary",
    );

  const groupProps = { employees, absenceTypes, onRowClick: openRow, canEdit };

  const hasHidden = isFilterActive(hiddenTypeIds);
  // Two-state control: hide everything when nothing is hidden, restore everything otherwise.
  const toggleAction = filterToggleAction(hiddenTypeIds);

  return (
    <div className="flex flex-col gap-5">
      <div className="border-line flex flex-wrap items-center justify-between gap-4 rounded-[14px] border bg-white px-[18px] py-3.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={segButton("today")}
            onClick={() => {
              handleSetSubcard("today");
            }}
          >
            Dzisiaj
          </button>
          <button
            type="button"
            className={segButton("monthly")}
            onClick={() => {
              handleSetSubcard("monthly");
            }}
          >
            Miesięcznie
          </button>
          <button
            type="button"
            className={segButton("yearly")}
            onClick={() => {
              handleSetSubcard("yearly");
            }}
          >
            Rocznie
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {absenceTypes.map((type) => {
            const off = hiddenTypeIds.has(type.id);
            return (
              <button
                key={type.id}
                type="button"
                title={type.name}
                aria-pressed={!off}
                onClick={() => {
                  toggleType(type.id);
                }}
                className={cn(
                  "flex items-center gap-[7px] rounded-full border px-3 py-1.5 text-xs transition-colors",
                  off ? "border-line-strong bg-[#fafafa] text-[#9a9a9a]" : "border-line bg-white text-black",
                )}
              >
                <span
                  className="block size-2.5 rounded-full"
                  style={{ backgroundColor: off ? "var(--line)" : type.color }}
                />
                <span className="text-[13px] leading-none">{type.icon}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setHiddenTypeIds(toggleAction === "hide-all" ? hideAll(absenceTypes.map((t) => t.id)) : clearHidden());
            }}
            className={cn(
              "hover:border-accent hover:bg-accent hover:text-accent-foreground flex cursor-pointer items-center gap-[7px] rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
              hasHidden ? "border-primary bg-primary text-white" : "border-line text-primary bg-white",
            )}
          >
            <span>{toggleAction === "hide-all" ? "✕" : "✓"}</span>
            <span>{toggleAction === "hide-all" ? "Wyczyść filtry" : "Zaznacz wszystkie"}</span>
          </button>
        </div>
      </div>

      {activeSubcard === "today" &&
        (weekLoading || (weekAbsences === null && !weekError) ? (
          <p className="text-muted-foreground">Ładowanie…</p>
        ) : weekError ? (
          <p className="text-destructive">{weekError}</p>
        ) : (
          <>
            <GroupCard {...groupProps} title="Dzisiaj" rows={todayAbsences} />
            <GroupCard {...groupProps} title="Ten tydzień" rows={thisWeekAbsences} />
            <GroupCard {...groupProps} title="Następny tydzień" rows={nextWeekAbsences} />
          </>
        ))}

      {activeSubcard === "monthly" && (
        <GroupCard
          {...groupProps}
          title={capitalizedMonth}
          rows={visible(absences)}
          emptyLabel="Brak nieobecności w tym miesiącu"
        />
      )}

      {activeSubcard === "yearly" &&
        (yearlyLoading || (yearlyAbsences === null && !yearlyError) ? (
          <p className="text-muted-foreground">Ładowanie…</p>
        ) : yearlyError ? (
          <p className="text-destructive">{yearlyError}</p>
        ) : (
          <>
            {yearlyTruncated && (
              <p className="border-destructive text-destructive rounded-[14px] border bg-white px-[18px] py-3.5 text-sm">
                Lista została przycięta przez serwer — poniższe zestawienie jest niepełne.
              </p>
            )}
            <GroupCard {...groupProps} title={`Rok ${year}`} rows={visible(yearlyAbsences ?? [])} />
          </>
        ))}

      {dialogState && (
        <AbsenceFormDialog
          key={dialogState.absence.id}
          open
          onOpenChange={(open) => {
            if (!open) setDialogState(null);
          }}
          day={dialogState.day}
          existingAbsence={dialogState.absence}
          absenceTypes={absenceTypes}
          employees={employees}
          currentEmployee={currentEmployee}
          targetEmployee={dialogState.targetEmployee}
        />
      )}
    </div>
  );
}
