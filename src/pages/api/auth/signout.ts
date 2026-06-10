import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  try {
    const supabase = createClient(context.request.headers, context.cookies);
    if (supabase) {
      await supabase.auth.signOut();
    }
    return context.redirect("/");
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/auth/signout" } });
    return new Response("Internal Server Error", { status: 500 });
  }
};
