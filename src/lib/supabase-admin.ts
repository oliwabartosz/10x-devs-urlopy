import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "astro:env/server";

/** Returns a service-role Supabase client that bypasses all RLS.
 * Returns null if SUPABASE_SERVICE_KEY is not set — callers must handle null before using the client. */
export function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return null;
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
