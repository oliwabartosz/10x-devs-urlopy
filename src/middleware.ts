import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import * as Sentry from "@sentry/cloudflare";
import { createDb, employees } from "@/db/index";
import { DATABASE_URL } from "astro:env/server";
import { eq, isNull, and } from "drizzle-orm";

const PROTECTED_ROUTES = ["/dashboard"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
    if (user) {
      let userRole: import("@/types").UserRole | null = null;
      try {
        const db = createDb(DATABASE_URL);
        const rows = await db
          .select({ role: employees.role })
          .from(employees)
          .where(and(eq(employees.user_id, user.id), isNull(employees.deleted_at)))
          .limit(1);
        if (rows.length > 0) userRole = rows[0].role;
      } catch {
        /* silent — degrades to ID-only in wrangler dev */
      }
      context.locals.userRole = userRole;
      Sentry.setUser({ id: user.id });
      if (userRole) Sentry.setTag("user_role", userRole);
    } else {
      context.locals.userRole = null;
    }
  } else {
    context.locals.user = null;
    context.locals.userRole = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
