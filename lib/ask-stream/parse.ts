import type { AskStreamEvent } from "@/types/ask-stream";
import {
  StreamIncompleteError,
  StreamInterruptedError,
  StreamProtocolError,
} from "./errors";
import { isTerminalStreamEvent, parseStreamEvent } from "./events";

/**
 * Client-side reader for the `/api/ask` response stream. No `server-only`
 * import: this runs in the browser.
 */

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Joins the `data:` lines of one SSE frame, or returns null when it has none
 * (a comment frame such as `: keep-alive`). Comment lines and other fields
 * (`event:`, `id:`, `retry:`) are ignored. The input uses LF line endings.
 */
function frameData(frame: string): string | null {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

/** Decodes one frame; null means "nothing for the caller" (comment or unknown). */
function decodeFrame(frame: string): AskStreamEvent | null {
  const data = frameData(frame);
  if (data === null) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch (error) {
    throw new StreamProtocolError("Stream event data is not valid JSON.", {
      cause: error,
    });
  }
  return parseStreamEvent(payload);
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  try {
    return await reader.read();
  } catch (error) {
    // A caller-initiated abort is not a network fault; pass it through as-is.
    if (isAbortError(error)) throw error;
    throw new StreamInterruptedError(error);
  }
}

/**
 * Yields the typed events of an answer stream as the bytes arrive.
 *
 * Reading stops, and the reader is cancelled, right after the first terminal
 * event (`done`, `not_found`, `limit` or `error`); anything after it is never
 * parsed. Throws:
 * - `StreamProtocolError` for invalid JSON or a known event with a bad shape;
 *   unknown event types are skipped.
 * - `StreamIncompleteError` if the stream closes without a terminal event. A
 *   half-received final frame (no blank line after it) is discarded, as the
 *   SSE specification says, so it counts as incomplete too.
 * - `StreamInterruptedError` (original error as `cause`) if a read fails.
 * - the original `AbortError`, unchanged, if the read was aborted.
 */
export async function* readAskStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AskStreamEvent> {
  const reader = body.getReader();
  // `stream: true` keeps a multi-byte character split across chunks intact.
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const result = await readChunk(reader);
      if (result.done) break;

      // Normalizing the whole buffer (not just the new text) also joins a CRLF
      // whose CR and LF arrived in different chunks.
      buffer = (
        buffer + decoder.decode(result.value, { stream: true })
      ).replace(/\r\n/g, "\n");
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const event = decodeFrame(frame);
        if (event === null) continue;
        yield event;
        if (isTerminalStreamEvent(event)) return;
      }
    }
    throw new StreamIncompleteError();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
