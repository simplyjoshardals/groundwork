import { encodeStreamEvent } from "@/lib/ask-stream/events";
import type {
  LlmMessage,
  LlmProvider,
  LlmStreamEvent,
} from "@/lib/providers/types";
import type { AskStreamEvent, StreamSource } from "@/types/ask-stream";
import { describeError } from "./errors";

/** The fields of a `match_chunks` row that the stream needs. */
export interface AskSourceRow {
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
}

const LLM_UNAVAILABLE_MESSAGE =
  "The answer service is unavailable right now. Please try again.";
const INTERRUPTED_MESSAGE = "The answer was interrupted. Please try again.";

/**
 * Builds the SSE body: `sources`, then one `token` per LLM text chunk, then
 * one terminal event (`done`, or `error` if the LLM fails mid-stream).
 *
 * The LLM is pulled only as fast as the client reads. A client disconnect
 * (request signal or stream cancel) aborts the LLM call and ends the stream
 * quietly, with no error event, since nobody is listening.
 *
 * `citations` and `invalidCitations` are empty until citation validation
 * exists (a later task).
 */
export function createAskResponseStream(
  options: AskResponseStreamOptions,
): ReadableStream<Uint8Array> {
  const { sources, messages, llm, signal } = options;
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onClientAbort = () => abort.abort();

  if (signal?.aborted) abort.abort();
  else signal?.addEventListener("abort", onClientAbort, { once: true });

  let iterator: AsyncIterator<LlmStreamEvent> | undefined;
  let tokensSent = false;
  let closed = false;

  const stopIterator = () => {
    void Promise.resolve(iterator?.return?.()).catch(() => undefined);
  };
  const emit = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: AskStreamEvent,
  ) => controller.enqueue(encoder.encode(encodeStreamEvent(event)));
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

  return new ReadableStream<Uint8Array>({
    start(controller) {
      emit(controller, { type: "sources", sources });
    },

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
            emit(controller, { type: "done", citations: [], invalidCitations: [] });
            close(controller);
            return;
          }
          const event = step.value;
          if (event.type === "finish") {
            if (event.reason === "blocked") {
              fail(controller, new Error("The LLM blocked its response."));
            } else {
              emit(controller, {
                type: "done",
                citations: [],
                invalidCitations: [],
              });
              close(controller);
            }
            return;
          }
          if (event.text === "") continue;
          emit(controller, { type: "token", text: event.text });
          tokensSent = true;
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
