import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Employee } from "@/types";

interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
}

const MIN_PASSWORD_LENGTH = 8;

// Moderator sets a worker's password, for the forgotten-password case. Nothing is read first —
// a password is never readable — so unlike ChangeEmailDialog there is no fetch on open.
export function ResetPasswordDialog({ open, onOpenChange, employee }: ResetPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Labels never use a bare "Hasło": tests/e2e/setup/auth.setup.ts:27 resolves
  // getByLabel("Hasło", { exact: true }) and the CI post-deploy health check greps for that
  // literal on the signin page. Exact-match labels on a different page do not collide, but the
  // distinct copy removes the hazard entirely.
  const tooShort = password !== "" && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat !== "" && password !== repeat;
  const saveDisabled = isSubmitting || password.length < MIN_PASSWORD_LENGTH || repeat === "" || password !== repeat;

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/employees/${employee.id}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        toast.success("Hasło zostało zmienione. Przekaż je pracownikowi.");
        onOpenChange(false);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Nie udało się zmienić hasła.");
        setIsSubmitting(false);
      }
    } catch {
      setError("Nie udało się zmienić hasła.");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-primary text-xl">
            Zmień hasło — {employee.first_name} {employee.last_name}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="reset-password-new">Nowe hasło</Label>
            <Input
              id="reset-password-new"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
            {tooShort && <p className="text-destructive text-xs">Hasło musi mieć co najmniej 8 znaków.</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="reset-password-repeat">Powtórz nowe hasło</Label>
            <Input
              id="reset-password-repeat"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => {
                setRepeat(e.target.value);
              }}
            />
            {mismatch && <p className="text-destructive text-xs">Hasła nie są takie same.</p>}
          </div>

          <p className="text-muted-foreground text-xs">
            Pracownik nie dostanie powiadomienia — przekaż mu nowe hasło osobiście. Jego bieżąca sesja pozostanie
            aktywna.
          </p>

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
