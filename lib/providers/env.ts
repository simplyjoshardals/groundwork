import "server-only";

/**
 * Credentials come only from server environment variables and are never
 * logged. Error messages name the variable, never its value. Keys are read
 * on use (not at import) so `next build` works without them.
 */

export class MissingEnvError extends Error {
  constructor(readonly variable: string) {
    super(`Missing required environment variable: ${variable}`);
    this.name = "MissingEnvError";
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new MissingEnvError(name);
  return value;
}

export function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function geminiApiKey(): string {
  return requireEnv("GEMINI_API_KEY");
}
/** Optional: without it the answer LLM runs without a fallback (Task 5.5). */
export function groqApiKeyIfSet(): string | null {
  return optionalEnv("GROQ_API_KEY");
}

export function groqApiKey(): string {
  return requireEnv("GROQ_API_KEY");
}
