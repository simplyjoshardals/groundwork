/**
 * Provider-agnostic error types (Task 1.3).
 *
 * Messages are built here from a status and short enum-like codes only. They
 * never contain a raw provider response body, request text, or credentials,
 * so they are safe to log. Callers decide what (if anything) reaches a user.
 */

export type ProviderName = "gemini" | "groq";

const PROVIDER_LABEL: Record<ProviderName, string> = {
  gemini: "Gemini",
  groq: "Groq",
};

export interface ProviderErrorInit {
  provider: ProviderName;
  /** HTTP status, or null when no response was received (network, timeout, bad input). */
  status?: number | null;
  /** The provider's short error status, e.g. `RESOURCE_EXHAUSTED`. */
  providerCode?: string | null;
  /** The provider's machine-readable reason, e.g. `API_KEY_INVALID`. */
  providerReason?: string | null;
  /** How long the provider asked us to wait, if it said. */
  retryAfterMs?: number | null;
}

export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly status: number | null;
  readonly providerCode: string | null;
  readonly providerReason: string | null;
  readonly retryAfterMs: number | null;

  constructor(message: string, init: ProviderErrorInit) {
    super(message);
    this.name = "ProviderError";
    this.provider = init.provider;
    this.status = init.status ?? null;
    this.providerCode = init.providerCode ?? null;
    this.providerReason = init.providerReason ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
  }
}

/** HTTP 429: quota or rate limit exhausted. */
export class RateLimitError extends ProviderError {
  constructor(message: string, init: ProviderErrorInit) {
    super(message, init);
    this.name = "RateLimitError";
  }
}

/** 5xx, network failure, timeout, or a response we cannot trust (malformed). */
export class ProviderUnavailableError extends ProviderError {
  constructor(message: string, init: ProviderErrorInit) {
    super(message, init);
    this.name = "ProviderUnavailableError";
  }
}

/**
 * The request was rejected (4xx other than 429) or failed local validation.
 * Authentication and configuration failures (401/403, invalid API key) are
 * also reported here with `status`, `providerCode` and `providerReason`
 * preserved; use `isAuthError` to tell them apart from ordinary bad requests.
 */
export class BadRequestError extends ProviderError {
  constructor(message: string, init: ProviderErrorInit) {
    super(message, init);
    this.name = "BadRequestError";
  }

  get isAuthError(): boolean {
    return (
      this.status === 401 ||
      this.status === 403 ||
      this.providerReason === "API_KEY_INVALID"
    );
  }
}

/** Maps a non-success HTTP status to one of the three normalized errors. */
export function providerErrorFromStatus(
  init: ProviderErrorInit & { status: number },
): ProviderError {
  const label = PROVIDER_LABEL[init.provider];
  const detail = [`HTTP ${init.status}`, init.providerCode ?? null]
    .filter((part): part is string => part !== null)
    .join(", ");
  const message = `${label} request failed (${detail})`;

  if (init.status === 429) return new RateLimitError(message, init);
  if (init.status === 408 || init.status >= 500 || init.status < 400) {
    return new ProviderUnavailableError(message, init);
  }
  return new BadRequestError(message, init);
}

/** For failures that are our own or the provider's malformed output. */
export function unavailable(
  provider: ProviderName,
  what: string,
  status: number | null = null,
): ProviderUnavailableError {
  return new ProviderUnavailableError(`${PROVIDER_LABEL[provider]}: ${what}`, {
    provider,
    status,
  });
}

/** For input rejected locally, before any network call. */
export function badRequest(
  provider: ProviderName,
  what: string,
): BadRequestError {
  return new BadRequestError(`${PROVIDER_LABEL[provider]}: ${what}`, {
    provider,
    status: null,
  });
}
