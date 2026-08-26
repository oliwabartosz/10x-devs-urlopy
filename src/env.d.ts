declare namespace App {
  interface Locals {
    // The whole codebase follows from this line. It used to be Supabase's `User`, of which only
    // `id` (15 sites) and `email` (`Topbar.astro:17`) were ever read — so the local session store
    // supplies exactly those two and nothing else. `userRole` is this app's own query and is
    // unaffected.
    user: { id: string; email: string } | null;
    userRole: import("@/types").UserRole | null;
  }
}
