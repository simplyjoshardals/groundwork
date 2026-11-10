/**
 * Public Turnstile site key. Same rule as `lib/supabase/env.ts`: it is read as
 * a literal `process.env.NEXT_PUBLIC_*` access so Next.js inlines it into the
 * browser bundle. Do not turn this into a lookup by name.
 *
 * Only the site key is here. The Turnstile secret key lives in Supabase Auth
 * (dashboard for the hosted project), which verifies the token itself, so the
 * app never holds it. Errors name the variable, never its value.
 */
export class MissingTurnstileEnvError extends Error {
  constructor(readonly variable: string) {
    super(`Missing required environment variable: ${variable}`);
    this.name = "MissingTurnstileEnvError";
  }
}

export function turnstileSiteKey(): string {
  const value = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (!value) {
    throw new MissingTurnstileEnvError("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  }
  return value;
}
