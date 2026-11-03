import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Browser client: publishable key only, so every query is subject to RLS.
 * Session cookies are read and written by `@supabase/ssr`; the root
 * `proxy.ts` keeps them fresh. In the browser `createBrowserClient` returns a
 * singleton, so calling this per interaction is cheap.
 */
export function createBrowserSupabase(): SupabaseClient<Database> {
  return createBrowserClient<Database>(supabaseUrl(), supabasePublishableKey());
}
