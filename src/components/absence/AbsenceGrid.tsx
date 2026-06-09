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

interface AbsenceGridProps {
  employees: Employee[];
  absences: Absence[];
  absenceTypes: AbsenceType[];
  currentEmployee: Pick<Employee, "id" | "first_name" | "last_name" | "role">;
  year: number;
  month: number;
}

function textColorForBg(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  if (hex.length !== 6) return "text-white";
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? "text-gray-800" : "text-white";
}

function formatTime(t: string | null | undefined): string {
  return t?.slice(0, 5) ?? "";
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

  return (
    <th
      ref={setNodeRef}
      className={`max-w-[50px] min-w-[40px] border-r border-b ${isInactive ? "bg-gray-100" : "bg-gray-50"}`}
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      {isModerator && (
        <div className="flex cursor-grab justify-center pt-1" {...attributes} {...listeners}>
          <GripVertical className="h-3 w-3 text-gray-400" />
        </div>
      )}
      <span
        className="block px-1 py-2 text-xs font-medium whitespace-nowrap"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        {emp.first_name} {emp.last_name}
        {isInactive ? " (nakt.)" : ""}
      </span>
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

  const weekdayFmt = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });

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
      <div className="p-4">
        <div className="overflow-x-auto rounded border">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 min-w-[80px] border-r border-b bg-white px-2 py-1 text-left text-xs font-normal text-gray-500">
                  Dzień
                </th>
                {self && (
                  <th className="max-w-[50px] min-w-[40px] border-r border-b bg-blue-50">
                    <span
                      className="block px-1 py-2 text-xs font-medium whitespace-nowrap"
                      style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                    >
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
                  <tr key={dateStr} className={isWeekend ? "bg-gray-100" : undefined}>
                    <td
                      className={`sticky left-0 z-10 border-r border-b px-2 py-1 text-xs whitespace-nowrap ${isWeekend ? "bg-gray-100" : "bg-white"}`}
                    >
                      <span className="font-medium text-gray-700">{date.getDate()}</span>
                      <span className="ml-1 text-gray-400">{weekdayFmt.format(date)}</span>
                    </td>
                    {orderedEmployees.map((emp) => {
                      const isOwn = emp.id === currentEmployee.id;
                      const isInactive = !!emp.deleted_at;
                      const absence = absenceMap.get(`${emp.id}_${dateStr}`);
                      const absenceType = absence ? absenceTypeMap.get(absence.absence_type_id) : undefined;
                      const clickable = (isOwn || isModerator) && !isWeekend && !isInactive;

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
                          {absenceType && absence ? (
                            <div
                              className="flex h-5 w-full items-center justify-center overflow-hidden rounded-sm"
                              style={{ backgroundColor: absenceType.color }}
                              title={absenceType.name}
                            >
                              {!absence.is_full_day && absence.start_time && absence.end_time && (
                                <span
                                  className={`truncate px-0.5 text-[10px] leading-none font-medium ${textColorForBg(absenceType.color)}`}
                                >
                                  {formatTime(absence.start_time)}–{formatTime(absence.end_time)}
                                </span>
                              )}
                            </div>
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

        <DragOverlay>
          {overlayEmployee ? (
            <div className="rounded border bg-white px-2 py-1 text-xs font-medium shadow-lg">
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
