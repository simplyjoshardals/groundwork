import "server-only";
import {
  providerErrorFromStatus,
  unavailable,
  type ProviderName,
} from "./errors";
import { getArray, getString, isRecord } from "./guards";

export interface RetryPolicy {
  /** Extra attempts after the first one (429, 5xx and network failures only). */
  maxRetries: number;
  /** If waiting would take longer than this, stop retrying and throw. */
  maxWaitMs: number;
  /** Test seam; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/** The deployed route has a hard function-duration limit, so it waits little. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  maxWaitMs: 15_000,
};

export interface ProviderRequest {
  provider: ProviderName;
  url: string;
  headers: Record<string, string>;
  body: string;
  /** Applied to each attempt, including reading the response body. */
  timeoutMs: number;
  policy: RetryPolicy;
  /** Caller cancellation. An abort is rethrown unchanged, never retried or wrapped. */
  signal?: AbortSignal;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const WAIT_PADDING_MS = 250;
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Provider strings are kept only if they look like short enum values. */
function safeCode(value: unknown): string | null {
  const text = getString(value);
  return text !== null && SAFE_CODE.test(text) ? text : null;
}

/** Parses Google-style durations such as "12s" or "0.5s" into milliseconds. */
export function parseRetryDelayMs(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

interface ParsedFailure {
  providerCode: string | null;
  providerReason: string | null;
  retryDelayMs: number | null;
}

/**
 * Extracts only short, enum-like fields from an error body. The provider's
 * free-text `message` is deliberately dropped: it can echo request content.
 */
function parseFailureBody(text: string): ParsedFailure {
  const empty: ParsedFailure = {
    providerCode: null,
    providerReason: null,
    retryDelayMs: null,
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return empty;
  }
  const error =
    isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
  if (!error) return empty;

  let providerReason: string | null = null;
  let retryDelayMs: number | null = null;
  for (const detail of getArray(error.details)) {
    if (!isRecord(detail)) continue;
    providerReason = safeCode(detail.reason) ?? providerReason;
    const delay = getString(detail.retryDelay);
    if (delay) retryDelayMs = parseRetryDelayMs(delay) ?? retryDelayMs;
  }
  return { providerCode: safeCode(error.status), providerReason, retryDelayMs };
}

/** Never includes the error's message: it can carry hostnames or request data. */
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown network error";
  if (error.name === "TimeoutError") return "request timed out";
  const cause: unknown = error.cause;
  const code = isRecord(cause) ? safeCode(cause.code) : null;
  return `network error (${safeCode(error.name) ?? "Error"}${code ? `, ${code}` : ""})`;
}

function backoffMs(attempt: number): number {
  return (
    Math.min(2 ** attempt * 1000, 30_000) + Math.round(Math.random() * 500)
  );
}

/** The wait the provider asked for, in ms, or null if it did not say. */
function hintedWaitMs(
  retryAfterHeader: string | null,
  retryDelayMs: number | null,
): number | null {
  const seconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.round(seconds * 1000);
  return retryDelayMs;
}

/**
 * POSTs with bounded retries and returns the successful Response with its
 * body unread, so callers can stream it. Every failure is thrown as one of the
 * normalized provider errors, except a caller abort, which is rethrown as-is.
 * Retries happen only here, before any response body is consumed.
 */
export async function postWithRetry(req: ProviderRequest): Promise<Response> {
  const wait = req.policy.sleep ?? sleep;
  const failureBase = { provider: req.provider };

  for (let attempt = 0; ; attempt++) {
    req.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(req.timeoutMs);
    const signal = req.signal
      ? AbortSignal.any([req.signal, timeout])
      : timeout;

    let response: Response;
    try {
      response = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
        signal,
      });
    } catch (error) {
      if (req.signal?.aborted) throw error;
      if (attempt >= req.policy.maxRetries) {
        throw unavailable(
          req.provider,
          `request failed: ${describeNetworkError(error)}`,
        );
      }
      await wait(backoffMs(attempt));
      continue;
    }

    if (response.ok) return response;

    const bodyText = await response.text().catch(() => "");
    const failure = parseFailureBody(bodyText);
    const hinted = hintedWaitMs(
      response.headers.get("retry-after"),
      failure.retryDelayMs,
    );
    const error = providerErrorFromStatus({
      ...failureBase,
      status: response.status,
      providerCode: failure.providerCode,
      providerReason: failure.providerReason,
      retryAfterMs: hinted,
    });

    if (
      !RETRYABLE_STATUSES.has(response.status) ||
      attempt >= req.policy.maxRetries
    ) {
      throw error;
    }
    const waitMs =
      hinted !== null ? hinted + WAIT_PADDING_MS : backoffMs(attempt);
    if (waitMs > req.policy.maxWaitMs) throw error;
    await wait(waitMs);
  }
}
