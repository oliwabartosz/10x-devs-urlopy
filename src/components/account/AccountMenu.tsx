import { useState } from "react";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

interface AccountMenuProps {
  email: string;
}

// The smallest possible island: it exists so the top bar's e-mail can be clicked, without
// converting Topbar.astro itself into a React component. `email` is its only prop — no
// user_id, no role (impl-review-phases-2-4.md F2: never ship auth identifiers into a
// client:load island).
//
// The button is styled to be visually identical to the <span> it replaces, apart from the
// hover affordance, which matches the bar's other controls. S-17 locks this bar's layout
// (huge-ui-ux-improvement/plan.md:210-219) — nothing here may change its height or spacing.
export function AccountMenu({ email }: AccountMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        title="Zmień hasło"
        className="hover:text-accent cursor-pointer transition-colors"
      >
        {email}
      </button>
      <ChangePasswordDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
