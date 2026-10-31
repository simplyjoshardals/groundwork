import {
  getArray,
  getNumber,
  getString,
  isRecord,
  parseRetryDelayMs,
  pickSafeHeaders,
  sleep,
  truncate,
} from "./util";

export interface RetryPolicy {
  /** Extra attempts after the first one (only for 429 and 5xx). */
  maxRetries: number;
  /** If the provider asks us to wait longer than this, give up instead. */
  maxWaitMs: number;
}

/** Local runs can afford to wait out a per-minute window. */
export const LOCAL_POLICY: RetryPolicy = { maxRetries: 2, maxWaitMs: 65_000 };
/** The deployed route has a hard function-duration limit, so it waits less. */
export const SERVER_POLICY: RetryPolicy = { maxRetries: 2, maxWaitMs: 15_000 };

export interface HttpAttempt {
  status: number;
  latencyMs: number;
  retryAfter: string | null;
  errorStatus: string | null;
  errorMessage: string | null;
}

export type HttpSuccess = {
  ok: true;
  response: Response;
  attempts: HttpAttempt[];
  headers: Record<string, string>;
};

export type HttpFailure = {
  ok: false;
  status: number;
  error: string;
  attempts: HttpAttempt[];
  gaveUpReason: string | null;
};

export type HttpResult = HttpSuccess | HttpFailure;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

interface ParsedError {
  errorStatus: string | null;
  message: string;
  retryDelayMs: number | null;
}

/** Handles both Google-style and OpenAI-style (Groq) error bodies. */
function parseErrorBody(text: string): ParsedError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      errorStatus: null,
      message: truncate(text, 300),
      retryDelayMs: null,
    };
  }
  const error =
    isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
  if (!error) {
    return {
      errorStatus: null,
      message: truncate(text, 300),
      retryDelayMs: null,
    };
  }
  let retryDelayMs: number | null = null;
  for (const detail of getArray(error.details)) {
    if (isRecord(detail)) {
      const delay = getString(detail.retryDelay);
      if (delay) retryDelayMs = parseRetryDelayMs(delay) ?? retryDelayMs;
    }
  }
  const errorStatus =
    getString(error.status) ?? getString(error.type) ?? getString(error.code);
  const numericCode = getNumber(error.code);
  return {
    errorStatus:
      errorStatus ?? (numericCode !== null ? String(numericCode) : null),
    message: truncate(getString(error.message) ?? text, 300),
    retryDelayMs,
  };
}

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown network error";
  const cause: unknown = error.cause;
  const code = isRecord(cause) ? getString(cause.code) : null;
  return truncate(
    `${error.name}: ${error.message}${code ? ` (${code})` : ""}`,
    300,
  );
}

function waitMsFor(
  attempt: number,
  retryAfterHeader: string | null,
  parsed: ParsedError,
): number {
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.round(retryAfterSeconds * 1000) + 250;
  }
  if (parsed.retryDelayMs !== null) return parsed.retryDelayMs + 250;
  return (
    Math.min(2 ** attempt * 1000, 30_000) + Math.round(Math.random() * 500)
  );
}

/**
 * fetch() with bounded, logged retries. On success the body is NOT consumed,
 * so callers can stream it. On failure the body is read and summarised.
 * Every attempt is recorded so rate-limit behaviour is evidence, not memory.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  policy: RetryPolicy,
): Promise<HttpResult> {
  const attempts: HttpAttempt[] = [];

  for (let attempt = 0; ; attempt++) {
    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      const message = describeNetworkError(error);
      attempts.push({
        status: 0,
        latencyMs: Math.round(performance.now() - started),
        retryAfter: null,
        errorStatus: "NETWORK_ERROR",
        errorMessage: message,
      });
      return {
        ok: false,
        status: 0,
        error: message,
        attempts,
        gaveUpReason: null,
      };
    }

    const latencyMs = Math.round(performance.now() - started);
    if (response.ok) {
      attempts.push({
        status: response.status,
        latencyMs,
        retryAfter: null,
        errorStatus: null,
        errorMessage: null,
      });
      return {
        ok: true,
        response,
        attempts,
        headers: pickSafeHeaders(response.headers),
      };
    }

    const bodyText = await response.text().catch(() => "");
    const parsed = parseErrorBody(bodyText);
    const retryAfter = response.headers.get("retry-after");
    attempts.push({
      status: response.status,
      latencyMs,
      retryAfter,
      errorStatus: parsed.errorStatus,
      errorMessage: parsed.message,
    });

    const failure: HttpFailure = {
      ok: false,
      status: response.status,
      error: parsed.message,
      attempts,
      gaveUpReason: null,
    };

    if (
      !RETRYABLE_STATUSES.has(response.status) ||
      attempt >= policy.maxRetries
    ) {
      return failure;
    }
    const waitMs = waitMsFor(attempt, retryAfter, parsed);
    if (waitMs > policy.maxWaitMs) {
      return {
        ...failure,
        gaveUpReason: `provider asked to wait ~${waitMs} ms, above the ${policy.maxWaitMs} ms limit`,
      };
    }
    await sleep(waitMs);
  }
}
