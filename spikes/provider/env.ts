/**
 * Credentials come only from environment variables and are never logged.
 * Error messages name the variable, never its value.
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

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
}

const DEFAULT_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** GEMINI_BASE_URL exists only so the code can be tested against a local fake. */
export function geminiConfig(): ProviderConfig {
  return {
    apiKey: requireEnv("GEMINI_API_KEY"),
    baseUrl: stripTrailingSlash(
      process.env.GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL,
    ),
  };
}

/** GROQ_BASE_URL exists only so the code can be tested against a local fake. */
export function groqConfig(): ProviderConfig {
  return {
    apiKey: requireEnv("GROQ_API_KEY"),
    baseUrl: stripTrailingSlash(
      process.env.GROQ_BASE_URL?.trim() || DEFAULT_GROQ_BASE_URL,
    ),
  };
}
