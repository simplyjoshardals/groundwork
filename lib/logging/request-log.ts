import { createHash, randomUUID } from "node:crypto";

/**
 * Task 5.10. One structured log line per `/api/ask` and `/api/ingest` request.
 *
 * What is on the line is decided here and nowhere else. Every field is listed in
 * `ALLOWED_FIELDS`, and `set()` drops anything that is not, so a question,
 * a passage, an answer, a document title, a file name or a storage path cannot be
 * logged by accident. Error messages are never on the line either: only the
 * error's class name and the short codes a provider or extractor attaches
 * (`safeErrorInfo`). The free-text detail lines elsewhere keep the message, but
 * through `describeError`, which redacts and caps it.
 *
 * Not `server-only`, so tests can import it. It uses `node:crypto`, which is
 * fine because both routes run on the Node.js runtime.
 */

export type RequestEvent = "ask" | "ingest";
export type LogLevel = "info" | "warn" | "error";

/** Where an `/api/ask` refusal happened. */
export type RefusalPath =
  | "gate1_no_passages"
  | "gate1_below_threshold"
  | "gate2_sentinel";

/** Phases that can carry a duration in `ms`. `total` is added when the line is written. */
export type PhaseName =
  | "auth"
  | "usage"
  | "retrieve"
  | "run"
  | "firstToken"
  | "stream";

/** The short, message-free description of an error. */
export interface ErrorInfo {
  name: string;
  provider?: string;
  status?: number;
  providerCode?: string;
  providerReason?: string;
  code?: string;
}

export interface LogFields {
  /** `hashUserId` of the caller. Never the id. */
  user?: string;
  /** Ingest only: the document id (a validated UUID, not content). */
  documentId?: string;
  /** Ask only: whether the question was limited to one document. */
  documentScoped?: boolean;
  /** Embedding model id. */
  embedding?: string;
  /** Answer model id that was used (the fallback's, after a failover). */
  llm?: string;
  failover?: boolean;
  /** The primary model, when a failover happened. */
  failoverFrom?: string;
  /** Whether the usage unit was given back. */
  refunded?: boolean;
  /** A limit reason, an ingest failure reason, or why an ingest was a no-op. */
  reason?: string;
  refusalPath?: RefusalPath;
  /** Best retrieval similarity, rounded to 3 decimals. */
  bestSimilarity?: number | null;
  passages?: number;
  citations?: number;
  invalidCitations?: number;
  uncited?: boolean;
  /** Length of the answer text in characters. The text itself is never logged. */
  answerChars?: number;
  pages?: number;
  chunks?: number;
  error?: ErrorInfo;
}

/** A `Record` over every key, so adding a field without listing it fails to compile. */
const ALLOWED_FIELDS: Record<keyof LogFields, true> = {
  user: true,
  documentId: true,
  documentScoped: true,
  embedding: true,
  llm: true,
  failover: true,
  failoverFrom: true,
  refunded: true,
  reason: true,
  refusalPath: true,
  bestSimilarity: true,
  passages: true,
  citations: true,
  invalidCitations: true,
  uncited: true,
  answerChars: true,
  pages: true,
  chunks: true,
  error: true,
};

/** First 12 hex characters of SHA-256 of the user id: stable, not reversible, not the id. */
export function hashUserId(userId: string): string {
  return createHash("sha256").update(userId, "utf8").digest("hex").slice(0, 12);
}

const TOKEN_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const VERCEL_ID_PATTERN = /^[A-Za-z0-9:_.-]{1,100}$/;

const token = (value: unknown): string | undefined =>
  typeof value === "string" && TOKEN_PATTERN.test(value) ? value : undefined;

function prop(error: object, key: string): unknown {
  return (error as Record<string, unknown>)[key];
}

/**
 * The parts of an error that are safe to log: its class name and the short
 * codes provider and extraction errors carry. Never `message`. A value that is
 * not a short token (letters, digits, `_`, `.`, `-`) is left out.
 */
export function safeErrorInfo(error: unknown): ErrorInfo {
  if (typeof error !== "object" || error === null) {
    return { name: "NonError" };
  }
  const status = prop(error, "status");
  const info: ErrorInfo = {
    name: token(prop(error, "name")) ?? "UnknownError",
  };
  const provider = token(prop(error, "provider"));
  if (provider !== undefined) info.provider = provider;
  if (typeof status === "number" && Number.isInteger(status)) {
    info.status = status;
  }
  const providerCode = token(prop(error, "providerCode"));
  if (providerCode !== undefined) info.providerCode = providerCode;
  const providerReason = token(prop(error, "providerReason"));
  if (providerReason !== undefined) info.providerReason = providerReason;
  const code = token(prop(error, "code"));
  if (code !== undefined) info.code = code;
  return info;
}

function defaultLevel(status: number): LogLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

/** Replaceable in tests. */
export interface RequestLogDeps {
  /** Milliseconds, monotonic. Default `performance.now`. */
  now?: () => number;
  newId?: () => string;
}

export interface RequestLog {
  readonly requestId: string;
  /** Adds fields. Keys outside the allow-list are dropped. */
  set(fields: LogFields): void;
  setError(error: unknown): void;
  /** Records the time since the previous `phase` call (or since the start). */
  phase(name: PhaseName): void;
  /** Records a duration measured elsewhere, such as inside the stream. */
  setMs(name: PhaseName, ms: number | null): void;
  /**
   * Writes the line. Only the first call does anything, so every exit path can
   * call it. Never throws: a logging fault must not break a request.
   */
  end(outcome: string, status: number, level?: LogLevel): void;
}

export function createRequestLog(
  event: RequestEvent,
  request: Request,
  deps: RequestLogDeps = {},
): RequestLog {
  const now = deps.now ?? (() => performance.now());
  const requestId = (deps.newId ?? randomUUID)();
  const startedAt = now();
  const vercelHeader = request.headers.get("x-vercel-id");
  const vercelId =
    vercelHeader !== null && VERCEL_ID_PATTERN.test(vercelHeader)
      ? vercelHeader
      : undefined;

  const fields: Record<string, unknown> = {};
  const ms: Partial<Record<PhaseName | "total", number>> = {};
  let lastMark = startedAt;
  let ended = false;

  const round = (value: number) => Math.round(value);

  return {
    requestId,
    set(next) {
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined) continue;
        if (!Object.prototype.hasOwnProperty.call(ALLOWED_FIELDS, key)) {
          continue;
        }
        fields[key] =
          key === "bestSimilarity" && typeof value === "number"
            ? Number.isFinite(value)
              ? Math.round(value * 1000) / 1000
              : null
            : value;
      }
    },
    setError(error) {
      fields.error = safeErrorInfo(error);
    },
    phase(name) {
      const at = now();
      ms[name] = round(at - lastMark);
      lastMark = at;
    },
    setMs(name, value) {
      if (value !== null && Number.isFinite(value)) ms[name] = round(value);
    },
    end(outcome, status, level = defaultLevel(status)) {
      if (ended) return;
      ended = true;
      try {
        ms.total = round(now() - startedAt);
        const line = JSON.stringify({
          event,
          requestId,
          vercelId,
          outcome,
          status,
          ...fields,
          ms,
        });
        console[level](line);
      } catch {
        // Never let logging fail the request.
        try {
          console.error(
            JSON.stringify({ event, requestId, outcome, logFailed: true }),
          );
        } catch {
          // Nothing more can be done.
        }
      }
    },
  };
}
