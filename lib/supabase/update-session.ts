import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Session refresh for `proxy.ts`. Calls `getClaims()`, which validates the
 * access token and refreshes it when it has expired, then makes sure the
 * refreshed cookies reach both the rest of this request (Server Components
 * read `request.cookies`) and the browser (`Set-Cookie` on the response).
 *
 * It never redirects or blocks: deciding who may see what is the job of RLS
 * and of each route (`/api/ask` returns 401 itself). A failed check is logged
 * and the request continues without a session.
 */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    supabaseUrl(),
    supabasePublishableKey(),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Cache headers from the library: a response carrying auth cookies
          // must never be cached by a CDN, or one user's session could be
          // served to another.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  const { error } = await supabase.auth.getClaims();
  if (error) {
    // No session yields `{ data: null, error: null }`, so this is a real
    // failure (bad or expired token that could not be refreshed, auth server
    // unreachable). Log the name and message only, never tokens or cookies.
    console.warn(
      `[proxy] session check failed: ${error.name}: ${error.message}`,
    );
  }

  return response;
}
