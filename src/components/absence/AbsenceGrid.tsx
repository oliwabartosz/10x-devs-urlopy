import { useState, useRef, useEffect } from "react";
import type { Employee, Absence, AbsenceType } from "@/types";
import { AbsenceFormDialog } from "./AbsenceFormDialog";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, horizontalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { initialsOf } from "@/lib/initials";
import { rawTimeRange, cellTimeRange } from "@/lib/absence-grid-cell";
import { cn } from "@/lib/utils";

interface AbsenceGridProps {
  employees: Employee[];
  absences: Absence[];
  absenceTypes: AbsenceType[];
  currentEmployee: Pick<Employee, "id" | "first_name" | "last_name" | "role">;
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

function selfFirst(emps: Employee[], currentId: string): Employee[] {
  const me = emps.find((e) => e.id === currentId);
  const others = emps.filter((e) => e.id !== currentId);
  return me ? [me, ...others] : others;
}

function SortableEmployeeHeader({ emp, isModerator }: { emp: Employee; isModerator: boolean }) {
  const { setNodeRef, attributes, listeners, isDragging } = useSortable({ id: emp.id });
  const isInactive = !!emp.deleted_at;
  const fullName = `${emp.first_name} ${emp.last_name}${isInactive ? " (nieakt.)" : ""}`;

  return (
    // No CSS transform on the <th> and listeners on the handle only — a table layout
    // detaches a transformed header cell (see context/changes/employee-grid-order/plan.md).
    <th
      ref={setNodeRef}
      className={cn(
        "border-line w-[120px] border-r border-b-2 px-2.5 py-3.5 text-center align-middle text-[13px] font-bold",
        isInactive ? "text-muted-foreground bg-[#dcdcdc]" : "bg-line-strong text-black",
      )}
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      <div className="flex items-center justify-center gap-1">
        {isModerator && (
          <span className="text-muted-foreground shrink-0 cursor-grab" {...attributes} {...listeners}>
            <GripVertical className="size-3.5" />
          </span>
        )}
        {/* The column is capped at 120px now, so a long name clips — `title` is what makes
            the full value, including the ` (nieakt.)` suffix, recoverable on hover. */}
        <span className="truncate" title={fullName}>
          {fullName}
        </span>
      </div>
    </th>
  );
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

  const [orderedEmployees, setOrderedEmployees] = useState<Employee[]>(() => selfFirst(employees, currentEmployee.id));
  const [activeId, setActiveId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const [dialogState, setDialogState] = useState<{
    day: Date;
    absence: Absence | null;
    targetEmployee: Employee;
  } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const days = getDaysInMonth(year, month);

  const absenceMap = new Map<string, Absence>();
  for (const absence of absences) {
    absenceMap.set(`${absence.employee_id}_${absence.date}`, absence);
  }

  const absenceTypeMap = new Map<number, AbsenceType>();
  for (const type of absenceTypes) {
    absenceTypeMap.set(type.id, type);
  }

  // Substitute names come off the already-filtered employees prop, never a fresh query,
  // so the is_system admin stays invisible (context/changes/admin-bootstrap/plan.md).
  const employeeNameMap = new Map<string, string>();
  for (const emp of employees) {
    employeeNameMap.set(emp.id, `${emp.first_name} ${emp.last_name}`);
  }

  const weekdayFmt = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });
  const dateFmt = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric" });

  function buildTooltip(emp: Employee, date: Date, type: AbsenceType, absence: Absence): string {
    const substituteName = absence.substitute_employee_id
      ? employeeNameMap.get(absence.substitute_employee_id)
      : undefined;
    // Deliberately NOT cellTimeRange: the tooltip is ungated where the cell is not. A legacy
    // row carrying hours on a type the product forbids partial days on renders as a full-day
    // chip, while this line still reports the hours actually stored. The cell obeys the
    // product rule; the tooltip stays the one surface where such a row is visible to a
    // moderator rather than silently hidden.
    const range = rawTimeRange(absence);
    const lines = [
      `Pracownik: ${emp.first_name} ${emp.last_name}`,
      `Data: ${dateFmt.format(date)} (${weekdayFmt.format(date)})`,
      `Typ: ${type.name}`,
      `Godziny: ${range || "cały dzień"}`,
    ];
    if (absence.comment) lines.push(`Komentarz: ${absence.comment}`);
    if (substituteName) lines.push(`Zastępstwo: ${substituteName}`);
    return lines.join("\n");
  }

  const self = orderedEmployees.find((e) => e.id === currentEmployee.id);
  const draggableActive = orderedEmployees.filter((e) => !e.deleted_at && e.id !== currentEmployee.id);
  const draggableInactive = orderedEmployees.filter((e) => !!e.deleted_at);
  const overlayEmployee = activeId ? orderedEmployees.find((e) => e.id === activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

    const isActiveInActiveGroup = draggableActive.some((e) => e.id === activeIdStr);
    const isOverInActiveGroup = draggableActive.some((e) => e.id === overIdStr);
    const isActiveInInactiveGroup = draggableInactive.some((e) => e.id === activeIdStr);
    const isOverInInactiveGroup = draggableInactive.some((e) => e.id === overIdStr);

    if (isActiveInActiveGroup && !isOverInActiveGroup) return;
    if (isActiveInInactiveGroup && !isOverInInactiveGroup) return;

    const prevOrder = orderedEmployees;
    let next: Employee[];

    if (isActiveInActiveGroup) {
      const fromIdx = draggableActive.findIndex((e) => e.id === activeIdStr);
      const toIdx = draggableActive.findIndex((e) => e.id === overIdStr);
      const newActive = arrayMove(draggableActive, fromIdx, toIdx);
      next = self ? [self, ...newActive, ...draggableInactive] : [...newActive, ...draggableInactive];
    } else {
      const fromIdx = draggableInactive.findIndex((e) => e.id === activeIdStr);
      const toIdx = draggableInactive.findIndex((e) => e.id === overIdStr);
      const newInactive = arrayMove(draggableInactive, fromIdx, toIdx);
      next = self ? [self, ...draggableActive, ...newInactive] : [...draggableActive, ...newInactive];
    }

    setOrderedEmployees(next);

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    fetch("/api/employees/order", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((e, i) => ({ id: e.id, display_order: i })) }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        toast.error("Nie udało się zapisać kolejności");
        setOrderedEmployees(prevOrder);
      });
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="border-line overflow-hidden rounded-[14px] border bg-white">
        {absenceTypes.length > 0 && (
          <div className="border-line flex flex-wrap items-center justify-between gap-4 border-b px-[18px] py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground mr-1 text-[11px] font-bold tracking-[0.06em] uppercase">
                Typy nieobecności
              </span>
              {absenceTypes.map((type) => (
                <span
                  key={type.id}
                  className="border-line-strong flex items-center gap-[7px] rounded-full border bg-white px-3 py-1.5 text-xs text-black"
                >
                  <span className="block size-2.5 rounded-full" style={{ backgroundColor: type.color }} />
                  {type.icon && <span className="text-[13px] leading-none">{type.icon}</span>}
                  <span>{type.name}</span>
                </span>
              ))}
            </div>
            <span className="text-muted-foreground text-xs">Kliknij komórkę, aby dodać.</span>
          </div>
        )}

        <div className="overflow-x-auto">
          {/* `table-fixed` so column widths come from the header `width`s rather than from the
              widest content anywhere in the month — the prototype's `flex: 1 1 0; min-width: 120px`
              has no direct table equivalent. The floor is computed, not a literal, because a
              fixed-layout table whose declared widths exceed `width: 100%` has no dependable
              behaviour: without it ten columns would silently compress below 120px instead of
              overflowing into the wrapper's scroll. `w-full` on top restores the stretch-to-fill
              when the team is small. */}
          <table
            className="w-full table-fixed border-collapse text-sm"
            style={{ minWidth: `${(132 + orderedEmployees.length * 120).toString()}px` }}
          >
            <thead>
              <tr>
                <th className="border-line bg-line-strong sticky left-0 z-20 w-[132px] min-w-[132px] border-r border-b-2 px-3 py-3.5 text-left text-xs font-bold tracking-[0.06em] text-black uppercase">
                  Dzień
                </th>
                {self && (
                  <th className="border-line bg-line-strong w-[120px] border-r border-b-2 px-2.5 py-3.5 text-center align-middle text-[13px] font-bold text-black">
                    <span className="block truncate" title={`${self.first_name} ${self.last_name}`}>
                      {self.first_name} {self.last_name}
                    </span>
                  </th>
                )}
                <SortableContext items={draggableActive.map((e) => e.id)} strategy={horizontalListSortingStrategy}>
                  {draggableActive.map((emp) => (
                    <SortableEmployeeHeader key={emp.id} emp={emp} isModerator={isModerator} />
                  ))}
                </SortableContext>
                <SortableContext items={draggableInactive.map((e) => e.id)} strategy={horizontalListSortingStrategy}>
                  {draggableInactive.map((emp) => (
                    <SortableEmployeeHeader key={emp.id} emp={emp} isModerator={isModerator} />
                  ))}
                </SortableContext>
              </tr>
            </thead>
            <tbody>
              {days.map((date) => {
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                const dateStr = `${date.getFullYear().toString()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

                return (
                  <tr key={dateStr} className={isWeekend ? "bg-surface" : "bg-white"}>
                    {/* Sticky so the date stays readable once the employee columns overflow
                        1480px. Needs its own background — the row's would scroll under it. */}
                    <td
                      className={cn(
                        "border-r-line border-b-line-strong sticky left-0 z-10 w-[132px] border-r border-b px-3 py-0 text-[13px]",
                        isWeekend ? "bg-surface" : "bg-white",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-[22px] text-right font-bold text-black">{date.getDate()}</span>
                        <span className={cn("text-xs", isWeekend ? "text-muted-foreground" : "text-muted-foreground")}>
                          {weekdayFmt.format(date)}
                        </span>
                      </div>
                    </td>
                    {orderedEmployees.map((emp) => {
                      const isOwn = emp.id === currentEmployee.id;
                      const isInactive = !!emp.deleted_at;
                      const absence = absenceMap.get(`${emp.id}_${dateStr}`);
                      const absenceType = absence ? absenceTypeMap.get(absence.absence_type_id) : undefined;
                      const clickable = (isOwn || isModerator) && !isWeekend && !isInactive;
                      const range = absence ? cellTimeRange(absence, absenceType?.name) : "";
                      const substituteInitials =
                        absence?.substitute_employee_id != null
                          ? initialsOf(employeeNameMap.get(absence.substitute_employee_id) ?? "")
                          : "";
                      // The chip is `role="img"`, which makes its children presentational — the
                      // substitute badge and the comment marker below are invisible to assistive
                      // technology, so both have to be named here instead. The substitute reads as
                      // a full name rather than the initials the badge shows.
                      const chipLabel =
                        absenceType && absence
                          ? [
                              absenceType.name,
                              range,
                              absence.substitute_employee_id != null
                                ? `zastępstwo: ${employeeNameMap.get(absence.substitute_employee_id) ?? ""}`
                                : "",
                              absence.comment ? "komentarz" : "",
                            ]
                              .filter(Boolean)
                              .join(", ")
                          : "";

                      return (
                        <td
                          key={emp.id}
                          // Hover only where a click does something — weekends are excluded by
                          // `clickable`, so they never gain an affordance they cannot honour.
                          className={cn(
                            "border-line-strong h-[34px] border-r border-b p-[3px]",
                            clickable ? "cursor-pointer hover:bg-[#eef3f8]" : "cursor-default",
                          )}
                          onClick={
                            clickable
                              ? () => {
                                  setDialogState({ day: date, absence: absence ?? null, targetEmployee: emp });
                                }
                              : undefined
                          }
                        >
                          {absenceType && absence ? (
                            // The chip carries no text but the range, so the type name has to reach
                            // assistive technology some other way — same reasoning as the icon-only
                            // filter chips (AbsenceDetailsSubcards.tsx). `role="img"` is required
                            // here where it was not there: this is a `div`, not a `button`, and
                            // `aria-label` on a generic element with no role is ignored by several
                            // screen readers. It also stops the emoji being announced separately.
                            <div
                              role="img"
                              aria-label={chipLabel}
                              className="relative flex h-full w-full items-center justify-center gap-[5px] overflow-hidden rounded-[7px] px-1.5 text-[11px] font-bold whitespace-nowrap"
                              style={{ backgroundColor: absenceType.color, color: absenceType.text_color }}
                              title={buildTooltip(emp, date, absenceType, absence)}
                            >
                              {absenceType.icon && (
                                <span className="shrink-0 text-[12px] leading-none">{absenceType.icon}</span>
                              )}
                              {range && <span className="truncate">{range}</span>}
                              {substituteInitials && (
                                <span className="text-primary absolute top-1/2 left-1 flex -translate-y-1/2 items-center gap-[2px] rounded-full bg-white/75 px-[5px] py-px text-[9px] leading-[1.4] font-bold">
                                  <span className="text-[8px] leading-none">🔁</span>
                                  <span>{substituteInitials}</span>
                                </span>
                              )}
                              {absence.comment && (
                                <span className="absolute top-1/2 right-1 -translate-y-1/2 text-[10px] leading-none opacity-85">
                                  💬
                                </span>
                              )}
                            </div>
                          ) : (
                            clickable && (
                              <div className="flex h-[28px] w-full items-center justify-center text-sm text-[#dcdcdc]">
                                +
                              </div>
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

        <DragOverlay>
          {overlayEmployee ? (
            <div className="border-line rounded-lg border bg-white px-2.5 py-1.5 text-[13px] font-bold shadow-lg">
              {overlayEmployee.first_name} {overlayEmployee.last_name}
            </div>
          ) : null}
        </DragOverlay>

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
            targetEmployee={dialogState.targetEmployee}
          />
        )}
      </div>
    </DndContext>
  );
}
