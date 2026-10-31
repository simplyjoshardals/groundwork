/**
 * Small, dependency-free helpers shared by the provider spike (Task 0.5).
 * Everything here is pure so it can be unit-tested without network access.
 */

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function l2Norm(vector: readonly number[]): number {
  let sum = 0;
  for (const x of vector) sum += x * x;
  return Math.sqrt(sum);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i++) dot += a[i] * b[i];
  const denominator = l2Norm(a) * l2Norm(b);
  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * Only these response headers are ever logged or written to disk. Anything
 * else (authorization echoes, cookies, request ids that could identify the
 * account, ...) is dropped on purpose.
 */
const SAFE_HEADER_NAMES = new Set([
  "retry-after",
  "content-type",
  "x-vercel-id",
]);

export function pickSafeHeaders(headers: Headers): Record<string, string> {
  const safe: Record<string, string> = {};
  headers.forEach((value, rawName) => {
    const name = rawName.toLowerCase();
    if (SAFE_HEADER_NAMES.has(name) || name.startsWith("x-ratelimit-")) {
      safe[name] = truncate(value, 200);
    }
  });
  return safe;
}

/** Parses Google-style durations such as "12s" or "0.5s" into milliseconds. */
export function parseRetryDelayMs(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

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

/** Yields the data payload of every SSE event as the bytes arrive. */
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
