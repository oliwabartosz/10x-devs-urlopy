import { useState, useEffect, useRef } from "react";
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

export default function AbsenceDetailsSubcards({
  absences,
  employees,
  absenceTypes,
  year,
  month,
  initialSubcard,
}: AbsenceDetailsSubcardsProps) {
  const [activeSubcard, setActiveSubcard] = useState<"today" | "monthly" | "yearly">(initialSubcard);
  const todayFetched = useRef(false);
  const yearlyFetched = useRef(false);

  const [weekAbsences, setWeekAbsences] = useState<Absence[] | null>(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekError, setWeekError] = useState<string | null>(null);

  const [yearlyAbsences, setYearlyAbsences] = useState<Absence[] | null>(null);
  const [yearlyLoading, setYearlyLoading] = useState(false);
  const [yearlyError, setYearlyError] = useState<string | null>(null);

  function handleSetSubcard(sub: "today" | "monthly" | "yearly") {
    setActiveSubcard(sub);
    const params = new URLSearchParams(window.location.search);
    params.set("subcard", sub);
    history.pushState(null, "", "?" + params.toString());
  }

  useEffect(() => {
    if (activeSubcard !== "today" || todayFetched.current) return;
    todayFetched.current = true;
    const controller = new AbortController();
    setWeekLoading(true);
    fetch(`/api/absences?from=${weekRange.from}&to=${weekRange.to}`, { signal: controller.signal })
      .then((r) => {
        if (r.ok) return r.json() as Promise<Absence[]>;
        throw new Error(String(r.status));
      })
      .then((data) => {
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
    yearlyFetched.current = true;
    const controller = new AbortController();
    setYearlyLoading(true);
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
        setYearlyError(err instanceof Error ? err.message : "Błąd ładowania rocznych nieobecności");
      })
      .finally(() => {
        setYearlyLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [activeSubcard, year]);

  const todayAbsences = (weekAbsences ?? []).filter((a) => a.date === weekRange.todayStr);
  const thisWeekAbsences = (weekAbsences ?? []).filter(
    (a) => a.date >= weekRange.thisWeekStart && a.date <= weekRange.thisWeekEnd,
  );
  const nextWeekAbsences = (weekAbsences ?? []).filter(
    (a) => a.date >= weekRange.nextWeekStart && a.date <= weekRange.nextWeekEnd,
  );

  const monthTitle = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1),
  );
  const capitalizedMonth = monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1);

  const btnClass = (sub: "today" | "monthly" | "yearly") =>
    activeSubcard === sub
      ? "px-4 py-2 text-sm font-medium border-b-2 border-blue-600 text-blue-600"
      : "px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900";

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b">
        <button
          type="button"
          className={btnClass("today")}
          onClick={() => {
            handleSetSubcard("today");
          }}
        >
          Dzisiaj
        </button>
        <button
          type="button"
          className={btnClass("monthly")}
          onClick={() => {
            handleSetSubcard("monthly");
          }}
        >
          Miesięcznie
        </button>
        <button
          type="button"
          className={btnClass("yearly")}
          onClick={() => {
            handleSetSubcard("yearly");
          }}
        >
          Rocznie
        </button>
      </div>

      {activeSubcard === "today" && (
        <div className="space-y-6">
          {weekLoading || (weekAbsences === null && !weekError) ? (
            <p className="text-gray-500">Ładowanie…</p>
          ) : weekError ? (
            <p className="text-red-600">{weekError}</p>
          ) : (
            <>
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Dzisiaj</h3>
                <AbsenceDetailsTable
                  absences={todayAbsences}
                  employees={employees}
                  absenceTypes={absenceTypes}
                  className="[&_table]:table-fixed"
                />
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Ten tydzień</h3>
                <AbsenceDetailsTable
                  absences={thisWeekAbsences}
                  employees={employees}
                  absenceTypes={absenceTypes}
                  className="[&_table]:table-fixed"
                />
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Następny tydzień</h3>
                <AbsenceDetailsTable
                  absences={nextWeekAbsences}
                  employees={employees}
                  absenceTypes={absenceTypes}
                  className="[&_table]:table-fixed"
                />
              </section>
            </>
          )}
        </div>
      )}

      {activeSubcard === "monthly" && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">{capitalizedMonth}</h3>
          <AbsenceDetailsTable
            absences={absences}
            employees={employees}
            absenceTypes={absenceTypes}
            emptyLabel="Brak nieobecności w tym miesiącu"
          />
        </div>
      )}

      {activeSubcard === "yearly" && (
        <div>
          {yearlyLoading || (yearlyAbsences === null && !yearlyError) ? (
            <p className="text-gray-500">Ładowanie…</p>
          ) : yearlyError ? (
            <p className="text-red-600">{yearlyError}</p>
          ) : (
            <AbsenceDetailsTable absences={yearlyAbsences ?? []} employees={employees} absenceTypes={absenceTypes} />
          )}
        </div>
      )}
    </div>
  );
}
