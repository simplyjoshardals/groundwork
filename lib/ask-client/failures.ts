import {
  StreamIncompleteError,
  StreamInterruptedError,
  StreamProtocolError,
  type AskStreamEvent,
  type StreamErrorCode,
} from "@/lib/ask-stream";
import { AUTH_UNAVAILABLE_MESSAGE } from "@/lib/auth/auth-unavailable";
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
  /**
   * The server's `error` code when it is one the client knows (Task 5.9);
   * otherwise null. Never free text from the server.
   */
  readonly code: KnownHttpErrorCode | null;

  constructor(status: number, code: KnownHttpErrorCode | null = null) {
    super(`/api/ask responded with HTTP ${status}.`);
    this.name = "AskHttpError";
    this.status = status;
    this.code = code;
  }
}

/** Error codes in a non-2xx body that change what the user is told. */
export type KnownHttpErrorCode = "auth_unavailable";

export function isKnownHttpErrorCode(
  value: unknown,
): value is KnownHttpErrorCode {
  return value === "auth_unavailable";
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

/**
 * Task 5.5: the model failed before writing anything, but the passages came
 * through. The note points at them (the source list renders below it).
 */
const LLM_UNAVAILABLE_WITH_SOURCES: AskFailure = {
  message:
    "I can't generate an answer right now. The closest passages I found are listed below.",
  retryable: true,
};

/**
 * Text for an `error` event that arrived inside the stream. `hasSources` is
 * true when retrieved passages are on screen and no answer text is.
 */
export function failureForErrorCode(
  code: StreamErrorCode,
  options: { hasSources?: boolean } = {},
): AskFailure {
  if (code === "llm_unavailable" && options.hasSources === true) {
    return LLM_UNAVAILABLE_WITH_SOURCES;
  }
  return STREAM_ERROR_FAILURES[code];
}

/** Text for a non-2xx response, chosen by status only. */
export function failureForStatus(
  status: number,
  code: KnownHttpErrorCode | null = null,
): AskFailure {
  // Task 5.9: the auth service is unreachable (for example a paused project).
  if (status === 503 && code === "auth_unavailable") {
    return {
      message: AUTH_UNAVAILABLE_MESSAGE,
      retryable: true,
    };
  }
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
  if (error instanceof AskHttpError) {
    return failureForStatus(error.status, error.code);
  }
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
