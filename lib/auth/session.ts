import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

export type SessionState =
  | { status: "signed_out" }
  | { status: "signed_in"; isAnonymous: boolean; email: string | null };

/**
 * Who is making this request, for Server Components. Uses `getClaims()`
 * (validates the token; `getSession()` would trust the cookie). A failed
 * check is logged by error name only and treated as signed out. This is a
 * UI guard: RLS and each route handler remain the real access control.
 */
export async function getSessionState(): Promise<SessionState> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    console.warn(`[auth] session check failed: ${error.name}`);
  }
  const claims = data?.claims;
  if (!claims) return { status: "signed_out" };
  return {
    status: "signed_in",
    isAnonymous: claims.is_anonymous === true,
    email:
      typeof claims.email === "string" && claims.email ? claims.email : null,
  };
}
