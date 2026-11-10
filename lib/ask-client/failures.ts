import {
  StreamIncompleteError,
  StreamInterruptedError,
  StreamProtocolError,
  type AskStreamEvent,
  type StreamErrorCode,
} from "@/lib/ask-stream";
import { formatResetTime } from "./usage";

/**
 * Everything that can go wrong on the client side of an ask, and the text the
 * user sees for it. The server's own `message` fields are never displayed: the
 * client chooses the wording (Task 1.8 decision), so these tables are the one
 * place to edit it.
 */

/** What the UI shows for a failure, and whether "Retry" makes sense. */
export interface AskFailure {
  message: string;
  retryable: boolean;
}

/** `/api/ask` answered with a non-2xx status (a plain JSON body, not a stream). */
export class AskHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`/api/ask responded with HTTP ${status}.`);
    this.name = "AskHttpError";
    this.status = status;
  }
}

/** The request never produced a response (offline, DNS, connection reset). */
export class AskNetworkError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The request to /api/ask failed.", options);
    this.name = "AskNetworkError";
  }
}

/** No response bytes or events arrived within the idle limit. */
export class AskIdleTimeoutError extends Error {
  constructor() {
    super("No data arrived from /api/ask within the idle limit.");
    this.name = "AskIdleTimeoutError";
  }
}

const INTERNAL: AskFailure = {
  message: "Something went wrong. Please try again.",
  retryable: true,
};

// `Record` makes the compiler flag this table if a code is added to the type.
const STREAM_ERROR_FAILURES: Record<StreamErrorCode, AskFailure> = {
  search_unavailable: {
    message: "Search is temporarily unavailable. Please try again.",
    retryable: true,
  },
  llm_unavailable: {
    message: "An answer couldn't be generated right now. Please try again.",
    retryable: true,
  },
  interrupted: {
    message: "The answer was interrupted. Retry to get the full answer.",
    retryable: true,
  },
  internal_error: INTERNAL,
};

/** Text for an `error` event that arrived inside the stream. */
export function failureForErrorCode(code: StreamErrorCode): AskFailure {
  return STREAM_ERROR_FAILURES[code];
}

/** Text for a non-2xx response, chosen by status only. */
export function failureForStatus(status: number): AskFailure {
  switch (status) {
    case 400:
      return {
        message: "That question couldn't be processed. Please rephrase it.",
        retryable: false,
      };
    case 401:
      return {
        message:
          "Your demo session has expired. Reload the page to start a new one.",
        retryable: false,
      };
    case 503:
      return STREAM_ERROR_FAILURES.search_unavailable;
    default:
      return INTERNAL;
  }
}

/**
 * Text for a `limit` event (Task 5.3): three distinct messages, chosen by
 * `reason`; a frame without one (older server) falls back to its `scope`. The
 * wording of the global state comes from the failure-mode table.
 */
export function failureForLimit(
  event: Extract<AskStreamEvent, { type: "limit" }>,
  timeZone?: string,
): AskFailure {
  const reason =
    event.reason ?? (event.scope === "user" ? "user_limit" : "global_limit");
  switch (reason) {
    case "user_limit":
      return {
        message: `You've used today's questions. Resets at ${formatResetTime(event.resetsAt, timeZone)}.`,
        retryable: false,
      };
    case "cooldown":
      // The server cannot say when the cooldown ends (Task 5.2), so no time.
      return {
        message: "You're asking too quickly. Wait a few seconds and try again.",
        retryable: true,
      };
    case "global_limit":
      return { message: "Demo is resting; back tomorrow.", retryable: false };
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

/** True for the error `fetch` and streams raise when an `AbortSignal` fires. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Maps anything thrown while asking to UI text. Callers handle an abort they
 * started themselves before calling this (`isAbortError`).
 */
export function describeFailure(error: unknown): AskFailure {
  if (error instanceof AskHttpError) return failureForStatus(error.status);
  if (error instanceof AskIdleTimeoutError) {
    return {
      message: "The connection stalled and no answer arrived. Please retry.",
      retryable: true,
    };
  }
  if (
    error instanceof AskNetworkError ||
    error instanceof StreamInterruptedError
  ) {
    return {
      message: "Connection lost. Check your network and retry.",
      retryable: true,
    };
  }
  if (error instanceof StreamIncompleteError) {
    return {
      message: "The answer ended unexpectedly. Please try again.",
      retryable: true,
    };
  }
  if (error instanceof StreamProtocolError) {
    return {
      message: "The server sent an unexpected response. Please try again.",
      retryable: true,
    };
  }
  return INTERNAL;
}