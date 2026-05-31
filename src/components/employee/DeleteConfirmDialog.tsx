import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Employee } from "@/types";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
}

export function DeleteConfirmDialog({ open, onOpenChange, employee }: DeleteConfirmDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/employees/${employee.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Pracownik dezaktywowany");
        onOpenChange(false);
        window.location.reload();
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Nie udało się dezaktywować.");
        setIsSubmitting(false);
      }
    } catch {
      setError("Nie udało się dezaktywować.");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dezaktywuj pracownika</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-gray-700">
          Czy na pewno chcesz dezaktywować{" "}
          <span className="font-medium">
            {employee.first_name} {employee.last_name}
          </span>
          ? Historyczne wpisy nieobecności zostaną zachowane.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
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
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Dezaktywowanie…" : "Dezaktywuj"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
