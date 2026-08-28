import { defineMiddleware } from "astro:middleware";
import * as Sentry from "@sentry/astro";
import { readSession } from "@/lib/auth";
import { createDb, employees } from "@/db/index";
import { DATABASE_PATH } from "astro:env/server";
import { eq, isNull, and } from "drizzle-orm";
import { withBase } from "@/lib/base-path";
import { withStyleDirectives } from "@/lib/csp";
import { reportError } from "@/lib/report";

// Compared against `context.url.pathname`, which carries the mount prefix when the app is served
// under one (`/urlopy/dashboard`, not `/dashboard`). Written through withBase so the guard cannot
// silently stop matching — an unprotected /dashboard fails open, which is the one direction this
// list must never fail in.
const PROTECTED_ROUTES = [withBase("/dashboard")];

export const onRequest = defineMiddleware(async (context, next) => {
  let user: { id: string; email: string } | null;
  let userRole: import("@/types").UserRole | null = null;

  // A real error path, replacing the `catch {}` that used to swallow this. That silence existed
  // for exactly one reason — `wrangler dev` could not open a TLS connection to Supabase, so the
  // role lookup always threw locally — and it degraded a signed-in moderator to a plain employee
  // without a trace. A local SQLite file has no such failure mode: if this throws, the database is
  // genuinely unreachable and every page below would be wrong anyway.
  try {
    user = await readSession(context.cookies);
    if (user) {
      const db = createDb(DATABASE_PATH);
      const rows = await db
        .select({ role: employees.role })
        .from(employees)
        .where(and(eq(employees.user_id, user.id), isNull(employees.deleted_at)))
        .limit(1);
      if (rows.length > 0) userRole = rows[0].role;
    }
  } catch (err) {
    reportError(err, { tags: { route: "middleware" } });
    return new Response("Service Unavailable", { status: 503 });
  }

  context.locals.user = user;
  context.locals.userRole = userRole;

  if (user) {
    Sentry.setUser({ id: user.id });
    if (userRole) Sentry.setTag("user_role", userRole);
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect(withBase("/"));
    }
  }

  const response = await next();

  // Astro builds the Content-Security-Policy and hashes its own inline scripts and <style>
  // blocks, but will not emit the `*-attr` / `*-elem` style directives — see src/lib/csp.ts for
  // what needs them and why they cannot live in astro.config.mjs.
  const csp = withStyleDirectives(response.headers.get("content-security-policy"));
  if (csp !== null) {
    response.headers.set("content-security-policy", csp);
  }

  return response;
});
