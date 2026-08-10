import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { typeAllowsPartialDay } from "@/lib/absence-types";
import { initialsOf } from "@/lib/initials";
import { avatarColor } from "@/lib/avatar";
import { useRovingRadioGroup } from "@/components/hooks/useRovingRadioGroup";
import { cn } from "@/lib/utils";
import type { Absence, AbsenceType, Employee } from "@/types";

interface AbsenceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date;
  existingAbsence: Absence | null;
  absenceTypes: AbsenceType[];
  employees: Employee[];
  currentEmployee: Pick<Employee, "id" | "first_name" | "last_name" | "role">;
  targetEmployee: Employee;
}

export function AbsenceFormDialog({
  open,
  onOpenChange,
  day,
  existingAbsence,
  absenceTypes,
  employees,
  currentEmployee,
  targetEmployee,
}: AbsenceFormDialogProps) {
  // Defensive: an existing entry whose type is not partial-day eligible opens as full-day,
  // so the form can never resubmit a combination the API rejects. No such data is expected.
  const existingAllowsPartialDay = typeAllowsPartialDay(
    absenceTypes.find((t) => t.id === existingAbsence?.absence_type_id)?.name,
  );

  const [absenceTypeId, setAbsenceTypeId] = useState<number | null>(existingAbsence?.absence_type_id ?? null);
  const [isFullDay, setIsFullDay] = useState(existingAllowsPartialDay ? (existingAbsence?.is_full_day ?? true) : true);
  const [startTime, setStartTime] = useState(
    existingAllowsPartialDay ? (existingAbsence?.start_time?.slice(0, 5) ?? "") : "",
  );
  const [endTime, setEndTime] = useState(
    existingAllowsPartialDay ? (existingAbsence?.end_time?.slice(0, 5) ?? "") : "",
  );
  const [comment, setComment] = useState(existingAbsence?.comment ?? "");
  const [substituteEmployeeId, setSubstituteEmployeeId] = useState<string | null>(
    existingAbsence?.substitute_employee_id ?? null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dateStr = `${day.getFullYear().toString()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const dateHeading = day.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const selectedType = absenceTypes.find((t) => t.id === absenceTypeId);
  const canBePartialDay = typeAllowsPartialDay(selectedType?.name);

  const saveDisabled = absenceTypeId === null || isSubmitting || (!isFullDay && (!startTime || !endTime));

  const otherEmployees = employees.filter((e) => e.id !== targetEmployee.id);

  // Shared by the click and the keyboard path so arrow-key selection cannot bypass the
  // partial-day reset below. Only the training types (PARTIAL_DAY_TYPE_NAMES) may be
  // partial-day; any other type reverts to full-day and drops the entered range.
  const selectType = (index: number) => {
    const type = absenceTypes[index];
    setAbsenceTypeId(type.id);
    if (!typeAllowsPartialDay(type.name)) {
      setIsFullDay(true);
      setStartTime("");
      setEndTime("");
    }
  };

  const typeGroup = useRovingRadioGroup(
    absenceTypes.length,
    absenceTypes.findIndex((t) => t.id === absenceTypeId),
    selectType,
  );

  // Index 0 is the "brak zastępstwa" option, so employee i sits at i + 1.
  const selectSubstitute = (index: number) => {
    setSubstituteEmployeeId(index === 0 ? null : otherEmployees[index - 1].id);
  };

  const substituteGroup = useRovingRadioGroup(
    otherEmployees.length + 1,
    substituteEmployeeId === null ? 0 : otherEmployees.findIndex((e) => e.id === substituteEmployeeId) + 1,
    selectSubstitute,
  );

  const handleSave = async () => {
    setIsSubmitting(true);
    const sharedFields = {
      absence_type_id: absenceTypeId,
      date: dateStr,
      is_full_day: isFullDay,
      start_time: isFullDay ? null : startTime,
      end_time: isFullDay ? null : endTime,
      comment: comment || null,
      substitute_employee_id: substituteEmployeeId,
    };
    try {
      const res = existingAbsence
        ? await fetch(`/api/absences/${existingAbsence.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sharedFields),
          })
        : await fetch("/api/absences", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee_id: targetEmployee.id, ...sharedFields }),
          });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Nie udało się zapisać. Spróbuj ponownie.");
        setIsSubmitting(false);
      }
    } catch {
      toast.error("Nie udało się zapisać. Spróbuj ponownie.");
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!existingAbsence) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/absences/${existingAbsence.id}`, { method: "DELETE" });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Nie udało się usunąć. Spróbuj ponownie.");
        setIsSubmitting(false);
      }
    } catch {
      toast.error("Nie udało się usunąć. Spróbuj ponownie.");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-primary text-xl">
            {existingAbsence ? "Edytuj nieobecność" : "Dodaj nieobecność"}
          </DialogTitle>
          <p className="text-muted-foreground text-[13px] capitalize">{dateHeading}</p>
          {targetEmployee.id !== currentEmployee.id && (
            <p className="text-primary text-[13px] font-bold">
              {targetEmployee.first_name} {targetEmployee.last_name}
            </p>
          )}
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label id="absence-type-label">Typ nieobecności</Label>
            <div
              className="grid grid-cols-2 gap-2"
              role="radiogroup"
              aria-labelledby="absence-type-label"
              onKeyDown={typeGroup.onKeyDown}
            >
              {absenceTypes.map((type, index) => {
                const selected = type.id === absenceTypeId;
                return (
                  <button
                    key={type.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={typeGroup.tabIndexFor(index)}
                    onClick={() => {
                      selectType(index);
                    }}
                    className={cn(
                      "hover:border-primary flex w-full items-center gap-2.5 rounded-[10px] text-left text-[13px] leading-tight text-black transition-colors",
                      selected
                        ? "border-primary ring-primary bg-[#f4f7fa] px-[11px] py-[9px] font-bold ring-1"
                        : "border-[#dcdcdc] px-3 py-2.5",
                      "border",
                    )}
                  >
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-[9px] text-sm leading-none"
                      style={{ backgroundColor: type.color, color: type.text_color }}
                    >
                      {type.icon}
                    </span>
                    <span className="min-w-0 flex-1">{type.name}</span>
                    <span className={cn("text-[13px] font-bold", selected ? "text-primary" : "text-transparent")}>
                      ✓
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {canBePartialDay && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is-full-day"
                  checked={isFullDay}
                  onChange={(e) => {
                    setIsFullDay(e.target.checked);
                    if (e.target.checked) {
                      setStartTime("");
                      setEndTime("");
                    }
                  }}
                  className="h-4 w-4"
                />
                <Label htmlFor="is-full-day">Cały dzień</Label>
              </div>

              {!isFullDay && (
                <div className="grid gap-1.5">
                  <Label>Godziny</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="start-time"
                      aria-label="Czas od"
                      type="time"
                      lang="pl-PL"
                      value={startTime}
                      onChange={(e) => {
                        setStartTime(e.target.value);
                      }}
                      className="w-32"
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      id="end-time"
                      aria-label="Czas do"
                      type="time"
                      lang="pl-PL"
                      value={endTime}
                      onChange={(e) => {
                        setEndTime(e.target.value);
                      }}
                      className="w-32"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="comment">Komentarz (opcjonalnie)</Label>
            <Input
              id="comment"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
              }}
              placeholder="Notatka..."
            />
          </div>

          {otherEmployees.length > 0 && (
            <div className="grid gap-1.5">
              <Label id="substitute-label">Zastępstwo (opcjonalnie)</Label>
              {/* otherEmployees excludes the *target* employee, not the editor
                  (context/changes/moderator-absence-management/plan.md:32), and the
                  employees prop is already visibleEmployeesFilter()-scoped, so the
                  is_system admin never appears here. */}
              <div
                className="flex flex-wrap items-center gap-2"
                role="radiogroup"
                aria-labelledby="substitute-label"
                onKeyDown={substituteGroup.onKeyDown}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={substituteEmployeeId === null}
                  aria-label="Brak zastępstwa"
                  title="Brak zastępstwa"
                  tabIndex={substituteGroup.tabIndexFor(0)}
                  onClick={() => {
                    selectSubstitute(0);
                  }}
                  className={cn(
                    "text-muted-foreground hover:border-accent flex size-[38px] shrink-0 items-center justify-center rounded-full border-2 bg-[#eeeeee] text-[13px] font-bold",
                    substituteEmployeeId === null ? "border-primary" : "border-transparent",
                  )}
                >
                  —
                </button>
                {otherEmployees.map((emp, index) => {
                  const selected = substituteEmployeeId === emp.id;
                  const fullName = `${emp.first_name} ${emp.last_name}`;
                  return (
                    <button
                      key={emp.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      // The visible label is two initials, which names the control "AN" to a
                      // screen reader. Carry the full name explicitly.
                      aria-label={fullName}
                      title={fullName}
                      tabIndex={substituteGroup.tabIndexFor(index + 1)}
                      onClick={() => {
                        selectSubstitute(index + 1);
                      }}
                      className={cn(
                        "hover:border-accent flex size-[38px] shrink-0 items-center justify-center rounded-full border-2 text-[13px] font-bold text-white",
                        selected ? "border-primary" : "border-transparent",
                      )}
                      style={{ backgroundColor: avatarColor(employees.indexOf(emp)) }}
                    >
                      {initialsOf(fullName)}
                    </button>
                  );
                })}
              </div>
              <p className="text-muted-foreground min-h-4 text-xs">
                {substituteEmployeeId === null
                  ? "Brak zastępstwa"
                  : (() => {
                      const sub = otherEmployees.find((e) => e.id === substituteEmployeeId);
                      return sub ? `${sub.first_name} ${sub.last_name}` : "";
                    })()}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {existingAbsence && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isSubmitting}
              className="mr-auto"
            >
              Usuń
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isSubmitting}
          >
            Anuluj
          </Button>
          <Button type="button" onClick={handleSave} disabled={saveDisabled}>
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
