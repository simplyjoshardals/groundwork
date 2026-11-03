import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { MissingSupabaseEnvError, supabaseUrl } from "./env";

/**
 * Service-role client. It BYPASSES RLS, so use it only in `features/` server
 * code and `scripts/` (ARCHITECTURE: lib/supabase), never to return data to a
 * user directly. `server-only` makes a client-side import fail the build, and
 * an ESLint rule restricts where it may be imported (eslint.config.mjs).
 *
 * The secret key is read when the client is created, not at import, so
 * `next build` works without it. A fresh client is returned each call; it
 * holds no session and never refreshes tokens.
 */
export function createAdminSupabase(): SupabaseClient<Database> {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) throw new MissingSupabaseEnvError("SUPABASE_SECRET_KEY");

  return createClient<Database>(supabaseUrl(), secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
