/**
 * Task 5.9. Tells "the auth service could not be reached or is failing" apart
 * from "there is no valid session". `supabase.auth.getClaims()` reports both
 * as an `error`, but only the second means the user must sign in again.
 *
 * supabase-js marks a network failure or a 5xx/gateway answer as an
 * `AuthRetryableFetchError` (status 0 for a failed fetch). The check is by
 * name and status on purpose, so it needs no import and is safe in any
 * runtime. A missing or invalid session (4xx, or no error with no claims) is
 * never "unavailable".
 */
export function isAuthUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, status } = error as { name?: unknown; status?: unknown };
  if (name === "AuthRetryableFetchError") return true;
  return typeof status === "number" && (status === 0 || status >= 500);
}

/** What the user sees when the auth service cannot be reached (Task 5.9). */
export const AUTH_UNAVAILABLE_MESSAGE =
  "Demo is waking up. Retry in a minute.";
