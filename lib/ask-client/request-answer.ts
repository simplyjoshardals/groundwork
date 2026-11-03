import { readAskStream, StreamProtocolError } from "@/lib/ask-stream";
import type { AskStreamEvent } from "@/types/ask-stream";
import {
  AskHttpError,
  AskIdleTimeoutError,
  AskNetworkError,
  isAbortError,
} from "./failures";

/**
 * Longest silence tolerated, from sending the request until the next event.
 * It covers the server's embedding and search before the first byte, and the
 * gaps between tokens. The route's own `maxDuration` is 60 s.
 */
export const IDLE_TIMEOUT_MS = 30_000;

export interface RequestAnswerOptions {
  /** Aborts the request. An abort the caller started is rethrown unchanged. */
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Asks `/api/ask` and yields the stream's events as they arrive.
 *
 * Throws `AskHttpError` (non-2xx), `AskNetworkError` (no response),
 * `AskIdleTimeoutError` (nothing arrived for `idleTimeoutMs`), the parser's
 * `Stream*Error`s, or the caller's own `AbortError`. A stream that closes
 * early or never closes can therefore never leave the caller waiting forever.
 */
export async function* requestAnswer(
  question: string,
  options: RequestAnswerOptions = {},
): AsyncGenerator<AskStreamEvent> {
  const {
    signal,
    idleTimeoutMs = IDLE_TIMEOUT_MS,
    fetchImpl = fetch,
  } = options;

  // A separate controller for the idle timer, so a timeout can be told apart
  // from an abort the caller started.
  const idle = new AbortController();
  const combined = signal
    ? AbortSignal.any([signal, idle.signal])
    : idle.signal;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      idle.abort();
    }, idleTimeoutMs);
  };

  /** Turns an abort caused by the idle timer into `AskIdleTimeoutError`. */
  const classify = (error: unknown): unknown =>
    isAbortError(error) && timedOut && !signal?.aborted
      ? new AskIdleTimeoutError()
      : error;

  arm();
  try {
    let response: Response;
    try {
      response = await fetchImpl("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: combined,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new AskNetworkError({ cause: error });
    }

    if (!response.ok) {
      // The body is a fixed JSON message the UI never shows; free the socket.
      await response.body?.cancel().catch(() => undefined);
      throw new AskHttpError(response.status);
    }
    if (!response.body) {
      throw new StreamProtocolError("The response has no body.");
    }

    for await (const event of readAskStream(response.body)) {
      arm();
      yield event;
    }
  } catch (error) {
    throw classify(error);
  } finally {
    clearTimeout(timer);
  }
}
