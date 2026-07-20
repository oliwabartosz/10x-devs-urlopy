import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { typeAllowsPartialDay } from "@/lib/absence-types";
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
          <DialogTitle>{existingAbsence ? "Edytuj nieobecność" : "Dodaj nieobecność"}</DialogTitle>
          <p className="text-muted-foreground text-sm capitalize">{dateHeading}</p>
          {targetEmployee.id !== currentEmployee.id && (
            <p className="text-sm font-medium text-blue-600">
              {targetEmployee.first_name} {targetEmployee.last_name}
            </p>
          )}
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="absence-type">Typ nieobecności</Label>
            <Select
              value={absenceTypeId?.toString() ?? ""}
              onValueChange={(val) => {
                const nextTypeId = val ? parseInt(val, 10) : null;
                setAbsenceTypeId(nextTypeId);
                // Only onsite training may be partial-day; any other type reverts to full-day
                // and drops whatever range was entered.
                const nextType = absenceTypes.find((t) => t.id === nextTypeId);
                if (!typeAllowsPartialDay(nextType?.name)) {
                  setIsFullDay(true);
                  setStartTime("");
                  setEndTime("");
                }
              }}
            >
              <SelectTrigger id="absence-type" className="w-full">
                <SelectValue placeholder="Wybierz typ..." />
              </SelectTrigger>
              <SelectContent>
                {absenceTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id.toString()}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              <Label htmlFor="substitute">Zastępstwo (opcjonalnie)</Label>
              <Select
                value={substituteEmployeeId ?? "none"}
                onValueChange={(val) => {
                  setSubstituteEmployeeId(val === "none" ? null : val);
                }}
              >
                <SelectTrigger id="substitute" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brak zastępstwa</SelectItem>
                  {otherEmployees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
