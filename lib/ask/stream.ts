import { encodeStreamEvent } from "@/lib/ask-stream/events";
import type {
  LlmMessage,
  LlmProvider,
  LlmStreamEvent,
} from "@/lib/providers/types";
import type { AskStreamEvent, StreamSource } from "@/types/ask-stream";
import { validateCitations } from "./citations";
import { describeError } from "./errors";
import { createSentinelDetector } from "./sentinel";

/** The fields of a `match_chunks` row that the stream needs. */
export interface AskSourceRow {
  chunk_id: number;
  doc_id: string;
  doc_title: string;
  page_number: number;
  content: string;
}

/** Longest snippet sent to the client, in characters (including the ellipsis). */
export const MAX_SNIPPET_LENGTH = 240;

function makeSnippet(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  const chars = Array.from(text); // code points, so no surrogate pair is cut
  if (chars.length <= MAX_SNIPPET_LENGTH) return text;
  return `${chars
    .slice(0, MAX_SNIPPET_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}

/** Maps rows to stream sources. Markers start at 1 and follow row order. */
export function toStreamSources(rows: readonly AskSourceRow[]): StreamSource[] {
  return rows.map((row, index) => ({
    marker: index + 1,
    documentId: row.doc_id,
    chunkId: row.chunk_id,
    documentTitle: row.doc_title,
    page: row.page_number,
    snippet: makeSnippet(row.content),
  }));
}

export interface AskResponseStreamOptions {
  sources: StreamSource[];
  messages: readonly LlmMessage[];
  llm: Pick<LlmProvider, "stream">;
  /** The request's signal. Aborting it cancels the LLM call. */
  signal?: AbortSignal;
  /**
   * Called once when the LLM fails before any answer text reached the client
   * (Task 5.2), so the caller can give the usage unit back. Not called for a
   * refusal, a client disconnect, or a failure after text was sent. Must not
   * throw; it is fire-and-forget from the stream's point of view.
   */
  onRefundable?: () => void;
}

const LLM_UNAVAILABLE_MESSAGE =
  "The answer service is unavailable right now. Please try again.";
const INTERRUPTED_MESSAGE = "The answer was interrupted. Please try again.";

/**
 * Builds the SSE body: `sources`, then one `token` per LLM text chunk, then
 * one terminal event (`done`, or `error` if the LLM fails mid-stream).
 *
 * Refusal gate #2 (Task 2.5): the start of the model output is held back until
 * it is clear whether it is the `NOT_FOUND` sentinel (see `sentinel.ts`). If it
 * is, the whole response is a single `not_found` event carrying the sources as
 * `closest`, like gate #1, and the LLM call is aborted. Otherwise `sources` is
 * sent just before the first text, so an answered response still starts with
 * `sources`. The only cost is that `sources` waits for the first few
 * characters of the answer instead of preceding the LLM call. If the LLM fails
 * before any text was released, the response is the `error` event alone.
 *
 * The LLM is pulled only as fast as the client reads. A client disconnect
 * (request signal or stream cancel) aborts the LLM call and ends the stream
 * quietly, with no error event, since nobody is listening.
 *
 * Citation validation (Task 2.6): the released text is collected, and the
 * terminal `done` event lists the `[n]` markers that exist among the sources
 * (`citations`) and those that do not (`invalidCitations`). Tokens are already
 * with the client by then, so the client removes invalid markers when it
 * renders (Task 2.7). An answer with no valid marker is logged, by count only.
 */
export function createAskResponseStream(
  options: AskResponseStreamOptions,
): ReadableStream<Uint8Array> {
  const { sources, messages, llm, signal, onRefundable } = options;
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onClientAbort = () => abort.abort();

  if (signal?.aborted) abort.abort();
  else signal?.addEventListener("abort", onClientAbort, { once: true });

  const detector = createSentinelDetector();
  let iterator: AsyncIterator<LlmStreamEvent> | undefined;
  let sourcesSent = false;
  let tokensSent = false;
  let closed = false;
  let answer = ""; // every released token, for citation validation at the end

  const stopIterator = () => {
    void Promise.resolve(iterator?.return?.()).catch(() => undefined);
  };
  const emit = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: AskStreamEvent,
  ) => controller.enqueue(encoder.encode(encodeStreamEvent(event)));
  const ensureSources = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    if (sourcesSent) return;
    sourcesSent = true;
    emit(controller, { type: "sources", sources });
  };
  const release = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    text: string,
  ) => {
    ensureSources(controller);
    emit(controller, { type: "token", text });
    tokensSent = true;
    answer += text;
  };
  const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    closed = true;
    signal?.removeEventListener("abort", onClientAbort);
    controller.close();
  };
  const fail = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    error: unknown,
  ) => {
    console.error("[ask] LLM stream failed:", describeError(error));
    // Text held back by the sentinel check was never sent, so it still counts
    // as "before the first token": the user got nothing for their unit.
    if (!tokensSent) {
      try {
        onRefundable?.();
      } catch (hookError) {
        // A broken hook must not stop the error event from reaching the client.
        console.error("[ask] onRefundable failed:", describeError(hookError));
      }
    }
    emit(
      controller,
      tokensSent
        ? { type: "error", code: "interrupted", message: INTERRUPTED_MESSAGE }
        : {
            type: "error",
            code: "llm_unavailable",
            message: LLM_UNAVAILABLE_MESSAGE,
          },
    );
    close(controller);
    abort.abort();
    stopIterator();
  };

  // The model refused: one `not_found` frame, then stop paying for tokens.
  const refuse = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    emit(controller, {
      type: "not_found",
      ...(sources.length > 0 ? { closest: sources } : {}),
    });
    close(controller);
    abort.abort();
    stopIterator();
  };
  // The LLM output ended: release any held-back text, then finish.
  const finish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    const decision = detector.end();
    if (decision.kind === "pass" && decision.text !== "") {
      release(controller, decision.text);
    }
    ensureSources(controller);
    const { citations, invalidCitations, uncited } = validateCitations(
      answer,
      sources.length,
    );
    if (uncited) {
      console.warn(
        `[ask] Answer has no valid citation (${answer.length} characters, ${invalidCitations.length} invalid markers).`,
      );
    }
    emit(controller, { type: "done", citations, invalidCitations });
    close(controller);
  };

  return new ReadableStream<Uint8Array>({
    // Loops until it enqueues something or closes: a pull that returns without
    // enqueueing would leave a waiting reader stuck.
    async pull(controller) {
      while (!closed) {
        if (abort.signal.aborted) {
          close(controller);
          return;
        }
        try {
          iterator ??= llm
            .stream(messages, { signal: abort.signal })
            [Symbol.asyncIterator]();
          const step = await iterator.next();
          if (closed) return;

          if (step.done) {
            finish(controller);
            return;
          }
          const event = step.value;
          if (event.type === "finish") {
            if (event.reason === "blocked") {
              fail(controller, new Error("The LLM blocked its response."));
            } else {
              finish(controller);
            }
            return;
          }
          if (event.text === "") continue;
          const decision = detector.push(event.text);
          if (decision.kind === "pending") continue;
          if (decision.kind === "not_found") {
            refuse(controller);
            return;
          }
          release(controller, decision.text);
          return;
        } catch (error) {
          if (closed) return;
          if (abort.signal.aborted) {
            close(controller);
            return;
          }
          fail(controller, error);
          return;
        }
      }
    },

    cancel() {
      closed = true;
      signal?.removeEventListener("abort", onClientAbort);
      abort.abort();
      stopIterator();
    },
  });
}
