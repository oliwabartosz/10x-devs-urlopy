import type { APIRoute } from "astro";
import * as Sentry from "@sentry/astro";
import { clearSessionCookie, destroySession, readSessionId } from "@/lib/auth";
import { withBase } from "@/lib/base-path";

export const POST: APIRoute = async (context) => {
  try {
    const sessionId = readSessionId(context.cookies);
    // Delete the row before the cookie: a browser that keeps a stale cookie is harmless once the
    // session it names is gone, whereas the reverse order would leave a live session nobody holds
    // a handle to if the delete then failed.
    if (sessionId) await destroySession(sessionId);
    clearSessionCookie(context.cookies);
    return context.redirect(withBase("/"));
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/auth/signout" } });
    return new Response("Internal Server Error", { status: 500 });
  }
};
