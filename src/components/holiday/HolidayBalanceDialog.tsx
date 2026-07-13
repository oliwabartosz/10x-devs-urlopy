import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { HolidayBalanceView } from "@/types";

interface HolidayBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: HolidayBalanceView;
  employeeId: string;
  year: number;
}

export function HolidayBalanceDialog({ open, onOpenChange, balance, employeeId, year }: HolidayBalanceDialogProps) {
  // Pre-fill every field from the current view and send them all on save (full replace) so
  // editing never clobbers the stored adjustment / "Do dnia" date — see Phase 2 review F1.
  const [currentEntitlement, setCurrentEntitlement] = useState(String(balance.current_entitlement_days));
  const [carryover, setCarryover] = useState(String(balance.carryover_days));
  const [usedAdjustment, setUsedAdjustment] = useState(String(balance.used_adjustment_days));
  const [validUntil, setValidUntil] = useState(balance.valid_until ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Non-negative integers only; entitlement + carryover are required, adjustment defaults to 0.
  const isNonNegInt = (v: string) => /^\d+$/.test(v.trim());
  const saveDisabled =
    isSubmitting ||
    !isNonNegInt(currentEntitlement) ||
    !isNonNegInt(carryover) ||
    (usedAdjustment.trim() !== "" && !isNonNegInt(usedAdjustment));

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/holiday-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          year,
          current_entitlement_days: parseInt(currentEntitlement, 10),
          carryover_days: parseInt(carryover, 10),
          used_adjustment_days: usedAdjustment.trim() === "" ? 0 : parseInt(usedAdjustment, 10),
          valid_until: validUntil.trim() === "" ? null : validUntil,
        }),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edytuj wymiar urlopu — {year}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="current-entitlement">Bieżące (dni)</Label>
            <Input
              id="current-entitlement"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={currentEntitlement}
              onChange={(e) => {
                setCurrentEntitlement(e.target.value);
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="carryover">Zaległe (dni)</Label>
            <Input
              id="carryover"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={carryover}
              onChange={(e) => {
                setCarryover(e.target.value);
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="used-adjustment">Korekta wykorzystania (dni, opcjonalnie)</Label>
            <Input
              id="used-adjustment"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={usedAdjustment}
              onChange={(e) => {
                setUsedAdjustment(e.target.value);
              }}
            />
            <p className="text-muted-foreground text-xs">
              Dni urlopu wykorzystane przed wdrożeniem aplikacji (dolicza się do „Wykorzystane”).
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="valid-until">Do dnia (opcjonalnie)</Label>
            <Input
              id="valid-until"
              type="date"
              value={validUntil}
              onChange={(e) => {
                setValidUntil(e.target.value);
              }}
            />
          </div>
        </div>

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
          <Button type="button" onClick={handleSave} disabled={saveDisabled}>
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
