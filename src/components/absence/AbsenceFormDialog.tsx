import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Absence, AbsenceType, Employee } from "@/types";

interface AbsenceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date;
  existingAbsence: Absence | null;
  absenceTypes: AbsenceType[];
  employees: Employee[];
  currentEmployee: Employee;
}

export function AbsenceFormDialog({
  open,
  onOpenChange,
  day,
  existingAbsence,
  absenceTypes,
  employees,
  currentEmployee,
}: AbsenceFormDialogProps) {
  const [absenceTypeId, setAbsenceTypeId] = useState<number | null>(existingAbsence?.absence_type_id ?? null);
  const [isFullDay, setIsFullDay] = useState(existingAbsence?.is_full_day ?? true);
  const [hours, setHours] = useState(existingAbsence?.hours?.toString() ?? "");
  const [comment, setComment] = useState(existingAbsence?.comment ?? "");
  const [substituteEmployeeId, setSubstituteEmployeeId] = useState<string | null>(
    existingAbsence?.substitute_employee_id ?? null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dateStr = day.toLocaleDateString("sv");
  const dateHeading = day.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const saveDisabled = absenceTypeId === null || isSubmitting || (!isFullDay && (!hours || parseFloat(hours) <= 0));

  const otherEmployees = employees.filter((e) => e.id !== currentEmployee.id);

  const handleSave = async () => {
    setIsSubmitting(true);
    const body = {
      absence_type_id: absenceTypeId,
      date: dateStr,
      is_full_day: isFullDay,
      hours: isFullDay ? null : parseFloat(hours),
      comment: comment || null,
      substitute_employee_id: substituteEmployeeId,
    };
    try {
      const res = existingAbsence
        ? await fetch(`/api/absences/${existingAbsence.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/absences", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
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
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="absence-type">Typ nieobecności</Label>
            <Select
              value={absenceTypeId?.toString() ?? ""}
              onValueChange={(val) => {
                setAbsenceTypeId(val ? parseInt(val, 10) : null);
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

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is-full-day"
              checked={isFullDay}
              onChange={(e) => {
                setIsFullDay(e.target.checked);
                if (e.target.checked) setHours("");
              }}
              className="h-4 w-4"
            />
            <Label htmlFor="is-full-day">Cały dzień</Label>
          </div>

          {!isFullDay && (
            <div className="grid gap-1.5">
              <Label htmlFor="hours">Liczba godzin</Label>
              <Input
                id="hours"
                type="number"
                min="0.5"
                step="0.5"
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                }}
                placeholder="np. 4"
                className="w-32"
              />
            </div>
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
