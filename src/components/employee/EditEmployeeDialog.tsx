import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Employee, HolidayBalanceView, UserRole } from "@/types";

interface EditEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
  year: number;
  currentRole: UserRole;
}

// Three distinct states, because "could not read the balance" is not the same as "balance is
// zero". The save is a full replace, so writing a balance the dialog never managed to read
// would clobber the stored values with defaults — hence `failed` hides the section entirely
// and suppresses the balance request, leaving identity editing fully usable.
type BalanceStatus = "loading" | "loaded" | "failed";

// Non-negative integers only, matching HolidayBalanceDialog.tsx:71.
const isNonNegInt = (v: string) => /^\d+$/.test(v.trim());

export function EditEmployeeDialog({ open, onOpenChange, employee, year, currentRole }: EditEmployeeDialogProps) {
  const [firstName, setFirstName] = useState(employee.first_name);
  const [lastName, setLastName] = useState(employee.last_name);
  const [role, setRole] = useState(employee.role);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>("loading");
  const [currentEntitlement, setCurrentEntitlement] = useState("0");
  const [carryover, setCarryover] = useState("0");
  const [usedAdjustment, setUsedAdjustment] = useState("0");

  // The caller remounts this dialog per target (see the `key` in EmployeeManagementSheet), so
  // mounting and opening coincide and this runs exactly once per edited employee. Reset-on-close
  // is that remount, never a resetting effect — the lint config rejects the latter.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/holiday-balances?employee_id=${employee.id}&year=${String(year)}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<HolidayBalanceView>;
      })
      .then((view) => {
        setCurrentEntitlement(String(view.current_entitlement_days));
        setCarryover(String(view.carryover_days));
        setUsedAdjustment(String(view.used_adjustment_days));
        setBalanceStatus("loaded");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setBalanceStatus("failed");
      });
    return () => {
      controller.abort();
    };
  }, [employee.id, year]);

  // "Korekta wykorzystania" is moderator-only (S-17). The input is hidden, not the value: the
  // pre-filled state is still submitted and the server preserves the stored adjustment for a
  // non-moderator caller. See HolidayBalanceDialog.tsx:65-68.
  const isModerator = currentRole === "moderator";

  const balanceValid =
    isNonNegInt(currentEntitlement) &&
    isNonNegInt(carryover) &&
    (usedAdjustment.trim() === "" || isNonNegInt(usedAdjustment));

  const saveDisabled =
    isSubmitting ||
    !firstName ||
    !lastName ||
    balanceStatus === "loading" ||
    (balanceStatus === "loaded" && !balanceValid);

  // One Zapisz, two requests, two tables, no transaction between them.
  //
  // Identity goes first on purpose: PATCH is the request that can fail on a business rule the
  // moderator can act on (last-moderator demotion, deactivated target), so failing it first
  // leaves nothing to unwind and the balance request is never sent. If the balance write fails
  // afterwards, both outcomes are reported and neither is rolled back — there is no transaction
  // across the two, and a compensating PATCH can itself fail into a worse, unnameable state.
  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const identityRes = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first_name: firstName, last_name: lastName, role }),
      });
      if (!identityRes.ok) {
        const data = (await identityRes.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Nie udało się zaktualizować.");
        setIsSubmitting(false);
        return;
      }

      // A balance the dialog could not read must not be written. Identity already landed.
      if (balanceStatus !== "loaded") {
        toast.success("Zaktualizowano");
        onOpenChange(false);
        window.location.reload();
        return;
      }

      // Full replace of all three fields, matching the dialog contract that protects Korekta.
      // Deliberately not skipped when nothing in the section changed — those semantics are what
      // keep a non-moderator's save from zeroing the stored adjustment.
      const balanceRes = await fetch("/api/holiday-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employee.id,
          year,
          current_entitlement_days: parseInt(currentEntitlement, 10),
          carryover_days: parseInt(carryover, 10),
          used_adjustment_days: usedAdjustment.trim() === "" ? 0 : parseInt(usedAdjustment, 10),
        }),
      });
      if (!balanceRes.ok) {
        const data = (await balanceRes.json().catch(() => ({}))) as { error?: string };
        setError(
          `Zapisano dane pracownika, ale nie udało się zapisać wymiaru urlopu: ${data.error ?? "błąd serwera"}. Popraw wartości i zapisz ponownie.`,
        );
        setIsSubmitting(false);
        return;
      }

      toast.success("Zaktualizowano");
      onOpenChange(false);
      window.location.reload();
    } catch {
      setError("Nie udało się zaktualizować.");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-primary text-xl">Edytuj pracownika</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-first-name">Imię</Label>
            <Input
              id="edit-first-name"
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-last-name">Nazwisko</Label>
            <Input
              id="edit-last-name"
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-role">Rola</Label>
            <Select
              value={role}
              onValueChange={(v) => {
                setRole(v as "employee" | "moderator");
              }}
            >
              <SelectTrigger id="edit-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Pracownik</SelectItem>
                <SelectItem value="moderator">Moderator</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="border-line border-t pt-4">
            <h4 className="text-muted-foreground mb-3 text-[11px] font-bold tracking-[0.06em] uppercase">
              Wymiar urlopu — {year}
            </h4>

            {balanceStatus === "loading" && (
              <p className="text-muted-foreground text-sm">Wczytywanie wymiaru urlopu…</p>
            )}

            {balanceStatus === "failed" && (
              <p className="text-muted-foreground text-sm">
                Nie udało się wczytać wymiaru urlopu. Pozostałe dane możesz zapisać.
              </p>
            )}

            {balanceStatus === "loaded" && (
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-current-entitlement">Bieżące (dni)</Label>
                  <Input
                    id="edit-current-entitlement"
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
                  <Label htmlFor="edit-carryover">Zaległe (dni)</Label>
                  <Input
                    id="edit-carryover"
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
                {isModerator && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="edit-used-adjustment">Korekta wykorzystania (dni, opcjonalnie)</Label>
                    <Input
                      id="edit-used-adjustment"
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
              </div>
            )}
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
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
          <Button type="button" onClick={handleSubmit} disabled={saveDisabled}>
            {isSubmitting ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
