import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { EmployeeListItem } from "@/types";
import { withBase } from "@/lib/base-path";

interface ChangeEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeListItem;
}

// The Auth write is kept in its own dialog so a single Zapisz never spans two storage rails —
// the merged edit dialog writes the `employees` row, this one writes the `users` row behind it.
export function ChangeEmailDialog({ open, onOpenChange, employee }: ChangeEmailDialogProps) {
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The address is fetched one at a time, on open — never listed, never shipped into a
  // client:load prop. See the plan's rejection of admin.listUsers().
  //
  // The caller remounts this dialog per target (`key` in EmployeeManagementSheet), so this
  // runs once per employee and reset-on-close is that remount, not an effect.
  useEffect(() => {
    const controller = new AbortController();
    fetch(withBase(`/api/employees/${employee.id}/email`), { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ email: string }>;
      })
      .then((data) => {
        setCurrentEmail(data.email);
        setEmail(data.email);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setLoadFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, [employee.id]);

  const isLoading = currentEmail === null && !loadFailed;
  // Client-side validation is a basic non-empty check; the server's z.email() is the real gate.
  const saveDisabled = isSubmitting || isLoading || loadFailed || email.trim() === "" || email === currentEmail;

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(withBase(`/api/employees/${employee.id}/email`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        toast.success("Adres e-mail został zmieniony.");
        onOpenChange(false);
        window.location.reload();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Nie udało się zmienić adresu e-mail.");
        setIsSubmitting(false);
      }
    } catch {
      setError("Nie udało się zmienić adresu e-mail.");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-primary text-xl">
            Zmień e-mail — {employee.first_name} {employee.last_name}
          </DialogTitle>
          <DialogDescription>Nowy adres zacznie obowiązywać od razu, bez potwierdzania mailem.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {isLoading && <p className="text-muted-foreground text-sm">Wczytywanie adresu…</p>}

          {loadFailed && (
            <p className="text-destructive text-sm">Nie udało się wczytać obecnego adresu e-mail. Spróbuj ponownie.</p>
          )}

          {currentEmail !== null && (
            <>
              <div className="rounded-xl border border-[#dbe4ee] bg-[#f4f7fa] px-4 py-3">
                <div className="text-muted-foreground mb-1 text-[11px] font-bold tracking-[0.06em] uppercase">
                  Obecny adres
                </div>
                <div className="text-primary text-sm font-medium break-all">{currentEmail}</div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="change-email-input">Nowy adres e-mail</Label>
                <Input
                  id="change-email-input"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  Zmiana działa natychmiast. Pracownik nie dostanie wiadomości z potwierdzeniem, a jego bieżąca sesja
                  pozostanie aktywna.
                </p>
              </div>
            </>
          )}

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
