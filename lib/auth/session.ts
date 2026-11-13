import "server-only";
import { isAuthUnavailable } from "@/lib/auth/auth-unavailable";
import { createServerSupabase } from "@/lib/supabase/server";

export type SessionState =
  | { status: "signed_out" }
  | { status: "signed_in"; isAnonymous: boolean; email: string | null };

/**
 * `SessionState` plus "the auth service could not be reached" (Task 5.9), so
 * a page can say the demo is waking up instead of sending a signed-in user to
 * the sign-in page.
 */
export type SessionCheck = SessionState | { status: "unavailable" };

/**
 * Who is making this request, for Server Components. Uses `getClaims()`
 * (validates the token; `getSession()` would trust the cookie). A failed
 * check is logged by error name only. An unreachable auth service is reported
 * as `unavailable`; any other failure is treated as signed out. This is a UI
 * guard: RLS and each route handler remain the real access control.
 */
export async function getSessionCheck(): Promise<SessionCheck> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    const unavailable = isAuthUnavailable(error);
    console.warn(
      `[auth] session check failed: ${error.name}${unavailable ? " (auth service unavailable)" : ""}`,
    );
    if (unavailable) return { status: "unavailable" };
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

/**
 * Same as `getSessionCheck`, for callers that only need signed in or out: an
 * unreachable auth service counts as signed out here, as it did before
 * Task 5.9.
 */
export async function getSessionState(): Promise<SessionState> {
  const check = await getSessionCheck();
  return check.status === "unavailable" ? { status: "signed_out" } : check;
}
