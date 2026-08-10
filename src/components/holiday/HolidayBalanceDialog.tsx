import { useState } from "react";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HolidayBalanceView, UserRole } from "@/types";

interface HolidayBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: HolidayBalanceView;
  employeeId: string;
  year: number;
  currentRole: UserRole;
}

// Trim trailing zeros so 2.5 stays "2,5" and 3.0 shows as "3"; Polish decimal comma.
function formatDays(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("pl-PL", { maximumFractionDigits: 2 });
}

function toIntOr(value: string, fallback: number): number {
  const n = parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function Stepper({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="border-line text-primary hover:bg-primary hover:text-primary-foreground size-9 shrink-0 rounded-lg"
    >
      {label.startsWith("Zmniejsz") ? <Minus className="size-4" /> : <Plus className="size-4" />}
    </Button>
  );
}

export function HolidayBalanceDialog({
  open,
  onOpenChange,
  balance,
  employeeId,
  year,
  currentRole,
}: HolidayBalanceDialogProps) {
  // Pre-fill every field from the current view and send them all on save (full replace) so
  // editing never clobbers the stored adjustment / "Do dnia" date — see Phase 2 review F1.
  const [currentEntitlement, setCurrentEntitlement] = useState(String(balance.current_entitlement_days));
  const [carryover, setCarryover] = useState(String(balance.carryover_days));
  const [usedAdjustment, setUsedAdjustment] = useState(String(balance.used_adjustment_days));
  const [validUntil, setValidUntil] = useState(balance.valid_until ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const busy = isSubmitting || isDeleting;

  // Note: the four initialisers above run once per mount. The caller remounts this dialog
  // on open (see the `key` in HolidayBalanceCard) so that Edytuj → Cancel → Edytuj shows
  // the stored values rather than the abandoned edits — resetting them in an effect here
  // would be a cascading-render anti-pattern the lint config rejects.

  // "Korekta wykorzystania" is moderator-only (S-17, narrowing S-15's ungated write to this
  // one field). The input is hidden, not the value: the pre-filled state is still sent, and
  // the server preserves the stored adjustment for a non-moderator caller.
  const isModerator = currentRole === "moderator";

  // Non-negative integers only; entitlement + carryover are required, adjustment defaults to 0.
  const isNonNegInt = (v: string) => /^\d+$/.test(v.trim());
  const saveDisabled =
    busy ||
    !isNonNegInt(currentEntitlement) ||
    !isNonNegInt(carryover) ||
    (usedAdjustment.trim() !== "" && !isNonNegInt(usedAdjustment));

  // Live "Pozostanie" preview. used_days already folds in the stored adjustment, so back it
  // out to get the computed part, then re-apply whichever adjustment will actually be written.
  const computedUsed = balance.used_days - balance.used_adjustment_days;
  const effectiveAdjustment = isModerator ? toIntOr(usedAdjustment, 0) : balance.used_adjustment_days;
  const previewUsed = computedUsed + effectiveAdjustment;
  const previewLeft = toIntOr(currentEntitlement, 0) + toIntOr(carryover, 0) - previewUsed;

  const step = (value: string, setValue: (v: string) => void, delta: number) => () => {
    setValue(String(Math.max(0, toIntOr(value, 0) + delta)));
  };

  // Only an already-stored record can be deleted; a synthesized view (balance_id null) has nothing to remove.
  const canDelete = balance.balance_id !== null;

  const handleDelete = async () => {
    if (balance.balance_id === null) return;
    if (!window.confirm("Usunąć wprowadzony wymiar urlopu na ten rok?")) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/holiday-balances/${balance.balance_id}`, { method: "DELETE" });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Nie udało się usunąć. Spróbuj ponownie.");
        setIsDeleting(false);
      }
    } catch {
      toast.error("Nie udało się usunąć. Spróbuj ponownie.");
      setIsDeleting(false);
    }
  };

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
          <DialogTitle className="text-primary text-xl">Edytuj wymiar urlopu — {year}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-[#dbe4ee] bg-[#f4f7fa] px-4 py-3.5">
          <div>
            <div className="text-muted-foreground mb-1.5 text-[11px] font-bold tracking-[0.06em] uppercase">
              Pozostanie
            </div>
            <div className={cn("text-2xl font-bold", previewLeft < 0 ? "text-destructive" : "text-primary")}>
              {formatDays(previewLeft)} dni
            </div>
          </div>
          <div className="text-muted-foreground max-w-[230px] text-right text-xs">
            Bieżące {formatDays(toIntOr(currentEntitlement, 0))} + Zaległe {formatDays(toIntOr(carryover, 0))} −
            Wykorzystane {formatDays(previewUsed)}
          </div>
        </div>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="current-entitlement">Bieżące (dni)</Label>
            <div className="flex items-center gap-2">
              <Stepper
                label="Zmniejsz bieżące"
                disabled={busy}
                onClick={step(currentEntitlement, setCurrentEntitlement, -1)}
              />
              <Input
                id="current-entitlement"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                className="text-center"
                value={currentEntitlement}
                onChange={(e) => {
                  setCurrentEntitlement(e.target.value);
                }}
              />
              <Stepper
                label="Zwiększ bieżące"
                disabled={busy}
                onClick={step(currentEntitlement, setCurrentEntitlement, 1)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="carryover">Zaległe (dni)</Label>
            <div className="flex items-center gap-2">
              <Stepper label="Zmniejsz zaległe" disabled={busy} onClick={step(carryover, setCarryover, -1)} />
              <Input
                id="carryover"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                className="text-center"
                value={carryover}
                onChange={(e) => {
                  setCarryover(e.target.value);
                }}
              />
              <Stepper label="Zwiększ zaległe" disabled={busy} onClick={step(carryover, setCarryover, 1)} />
            </div>
          </div>

          {isModerator && (
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
          )}

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

        <DialogFooter className={canDelete ? "sm:justify-between" : undefined}>
          {canDelete && (
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={busy}>
              Usuń
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={busy}
            >
              Anuluj
            </Button>
            <Button type="button" onClick={handleSave} disabled={saveDisabled}>
              Zapisz
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
