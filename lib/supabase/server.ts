import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Server-as-user client for Server Components, Route Handlers and Server
 * Actions. It carries the caller's session cookies, so RLS applies exactly as
 * it does in the browser. Create one per request; never share or cache it.
 */
export async function createServerSupabase(): Promise<
  SupabaseClient<Database>
> {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. This is expected there:
          // `proxy.ts` refreshes the session before rendering and writes the
          // cookies itself. Route Handlers and Server Actions can write, so
          // they never reach this branch.
        }
      },
    },
  });
}
