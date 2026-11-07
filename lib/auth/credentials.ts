import { z } from "zod";

/**
 * Client-side checks for the sign-in and sign-up forms, and the mapping from
 * Supabase Auth errors to user-facing text. These checks are for fast
 * feedback only: Supabase Auth is the authority on what is accepted.
 * `MIN_PASSWORD_LENGTH` must match `minimum_password_length` in
 * `supabase/config.toml` (and the hosted project's Auth settings).
 */

export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt, which Supabase Auth uses, ignores bytes beyond 72. */
export const MAX_PASSWORD_LENGTH = 72;
const MAX_EMAIL_LENGTH = 254;

export type AuthMode = "sign-in" | "sign-up";

export type FieldErrors = { email?: string; password?: string };

export type CredentialsResult =
  | { ok: true; value: { email: string; password: string } }
  | { ok: false; fieldErrors: FieldErrors };

const emailSchema = z
  .string()
  .max(MAX_EMAIL_LENGTH, { error: "Enter a valid email address." })
  .pipe(z.email({ error: "Enter a valid email address." }));

const signUpPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, {
    error: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  })
  .max(MAX_PASSWORD_LENGTH, {
    error: `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
  });

// Existing accounts may predate the current length rule, so sign-in only
// requires something to be typed.
const signInPasswordSchema = z
  .string()
  .min(1, { error: "Enter your password." })
  .max(MAX_PASSWORD_LENGTH, { error: "Incorrect email or password." });

export function parseCredentials(
  input: { email: unknown; password: unknown },
  mode: AuthMode,
): CredentialsResult {
  const rawEmail = typeof input.email === "string" ? input.email.trim() : "";
  const rawPassword = typeof input.password === "string" ? input.password : "";

  const email = emailSchema.safeParse(rawEmail);
  const password = (
    mode === "sign-up" ? signUpPasswordSchema : signInPasswordSchema
  ).safeParse(rawPassword);

  if (email.success && password.success) {
    return { ok: true, value: { email: email.data, password: password.data } };
  }
  const fieldErrors: FieldErrors = {};
  if (!email.success) {
    fieldErrors.email =
      email.error.issues[0]?.message ?? "Enter a valid email address.";
  }
  if (!password.success) {
    fieldErrors.password =
      password.error.issues[0]?.message ?? "Check your password.";
  }
  return { ok: false, fieldErrors };
}

/** The parts of a Supabase `AuthError` this module reads. */
export type AuthErrorLike = {
  code?: string | undefined;
  name?: string | undefined;
  status?: number | undefined;
};

const GENERIC = "Something went wrong. Please try again.";
const RATE_LIMITED =
  "Too many attempts. Please wait a few minutes and try again.";

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  user_already_exists:
    "An account with this email already exists. Try signing in instead.",
  email_exists:
    "An account with this email already exists. Try signing in instead.",
  weak_password: `That password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  over_request_rate_limit: RATE_LIMITED,
  over_email_send_rate_limit:
    "Too many emails have been sent. Please try again later.",
  email_not_confirmed:
    "Confirm your email address first (check your inbox), then sign in.",
  signup_disabled: "New sign-ups are turned off right now.",
  email_provider_disabled: "Email sign-in is turned off right now.",
  validation_failed: "Check the email address and password, then try again.",
};

/**
 * Fixed, safe text for any Auth failure. The provider's own message is never
 * shown: it can be technical, and for some errors it distinguishes cases an
 * attacker should not be able to tell apart.
 */
export function describeAuthError(error: AuthErrorLike | null): string {
  if (!error) return GENERIC;
  if (error.code) {
    const known = MESSAGES[error.code];
    if (known) return known;
  }
  if (error.name === "AuthRetryableFetchError") {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (error.status === 429) return RATE_LIMITED;
  return GENERIC;
}
