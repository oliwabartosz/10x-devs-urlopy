import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_PASSWORD_LENGTH = 8;

// Lives in src/components/account/, not src/components/employee/: this is a self-service
// account action, not employee management.
export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Label copy avoids a bare "Hasło" on purpose: tests/e2e/setup/auth.setup.ts:27 resolves
  // getByLabel("Hasło", { exact: true }) and the CI post-deploy health check greps for that
  // literal on the signin page. Exact-match labels on a different page do not collide, but
  // distinct copy removes the hazard entirely.
  const tooShort = newPassword !== "" && newPassword.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat !== "" && newPassword !== repeat;
  const sameAsCurrent = newPassword !== "" && newPassword === currentPassword;
  const saveDisabled =
    isSubmitting ||
    currentPassword === "" ||
    newPassword.length < MIN_PASSWORD_LENGTH ||
    repeat === "" ||
    newPassword !== repeat ||
    sameAsCurrent;

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (res.ok) {
        // The toast must mention the other-session logout: a worker signed in on their phone
        // would otherwise be signed out with no explanation.
        toast.success("Hasło zostało zmienione. Inne sesje zostały wylogowane.");
        onOpenChange(false);
        // Deliberately no window.location.reload(): nothing rendered on the page depends on
        // the password. The reload convention exists for mutations that change page content.
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
          <DialogTitle className="text-primary text-xl">Zmień hasło</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="account-current-password">Obecne hasło</Label>
            <Input
              id="account-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="account-new-password">Nowe hasło</Label>
            <Input
              id="account-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
              }}
            />
            {tooShort && <p className="text-destructive text-xs">Hasło musi mieć co najmniej 8 znaków.</p>}
            {sameAsCurrent && <p className="text-destructive text-xs">Nowe hasło musi różnić się od obecnego.</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="account-repeat-password">Powtórz nowe hasło</Label>
            <Input
              id="account-repeat-password"
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
            Po zmianie hasła pozostałe sesje (np. na telefonie) zostaną wylogowane. Ta sesja pozostanie aktywna.
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
