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
      {/* Conditionally rendered so closing unmounts it, which is how every dialog in this app
          resets — EmployeeManagementSheet.tsx:215-245 does the same with a `key` remount. It
          matters more here than elsewhere: this is the one dialog that deliberately skips
          window.location.reload(), so without the unmount all three plaintext passwords would
          survive in state and in the controlled inputs for the rest of the page's life. */}
      {open && <ChangePasswordDialog open onOpenChange={setOpen} />}
    </>
  );
}
