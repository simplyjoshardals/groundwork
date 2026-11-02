import "server-only";

/** Minimal Server-Sent-Events reader, carried over from the Task 0.5 spike. */

export interface SseSplit {
  events: string[];
  rest: string;
}

/** Splits a buffer into complete SSE event blocks plus the unfinished tail. */
export function splitSseEvents(buffer: string): SseSplit {
  const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = parts.pop() ?? "";
  return { events: parts, rest };
}

/** Joins the `data:` lines of one SSE event block; null if it has none. */
export function sseDataOf(eventBlock: string): string | null {
  const dataLines: string[] = [];
  for (const line of eventBlock.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

/**
 * Yields the data payload of every SSE event as the bytes arrive. The reader
 * is cancelled if the consumer stops early or the stream errors.
 */
export async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = splitSseEvents(buffer);
      buffer = rest;
      for (const event of events) {
        const data = sseDataOf(event);
        if (data !== null) yield data;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() !== "") {
      const data = sseDataOf(buffer.replace(/\r\n/g, "\n"));
      if (data !== null) yield data;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
