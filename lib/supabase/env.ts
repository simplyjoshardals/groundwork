/**
 * Public Supabase settings, shared by the browser client, the server client
 * and the proxy. No `server-only` marker on purpose: the browser client needs
 * these.
 *
 * Each variable is read as a literal `process.env.NEXT_PUBLIC_*` property
 * access. Next.js inlines public variables into the browser bundle only when
 * they are written that way; a lookup by name (`process.env[name]`) would be
 * `undefined` in the browser. Do not "simplify" this into a helper that takes
 * the variable name. Errors name the variable, never its value.
 *
 * The secret key is deliberately not here: it lives only in `admin.ts`.
 */

export class MissingSupabaseEnvError extends Error {
  constructor(readonly variable: string) {
    super(`Missing required environment variable: ${variable}`);
    this.name = "MissingSupabaseEnvError";
  }
}

export function supabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) throw new MissingSupabaseEnvError("NEXT_PUBLIC_SUPABASE_URL");
  return value;
}

export function supabasePublishableKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!value) {
    throw new MissingSupabaseEnvError("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  return value;
}
