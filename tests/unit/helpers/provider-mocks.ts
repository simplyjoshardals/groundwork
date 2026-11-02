import { vi } from "vitest";
import type { RetryPolicy } from "@/lib/providers/http";

export const TEST_KEY = "test-key-SECRET-123";

export interface RecordedCall {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (
  call: RecordedCall,
  index: number,
) => Response | Promise<Response>;

/** Replaces global fetch and records every call. Undo with vi.unstubAllGlobals(). */
export function stubFetch(handler: Handler): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body: unknown =
      typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const call: RecordedCall = { url: String(input), init, headers, body };
    calls.push(call);
    return handler(call, calls.length - 1);
  });
  return { calls };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Google-style error body. The message deliberately echoes sensitive text. */
export function googleError(
  code: number,
  status: string,
  extra: { reason?: string; retryDelay?: string } = {},
): unknown {
  const details: unknown[] = [];
  if (extra.reason)
    details.push({
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: extra.reason,
    });
  if (extra.retryDelay)
    details.push({
      "@type": "type.googleapis.com/google.rpc.RetryInfo",
      retryDelay: extra.retryDelay,
    });
  return {
    error: {
      code,
      status,
      message: `ECHOED-REQUEST-TEXT secret document sentence; key ${TEST_KEY}`,
      details,
    },
  };
}

const encoder = new TextEncoder();

/** Streams the given raw string chunks, then closes, or errors if `failWith` is set. */
export function sseResponse(
  chunks: string[],
  options: { failWith?: Error; onCancel?: () => void } = {},
): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else if (options.failWith) {
        controller.error(options.failWith);
      } else {
        controller.close();
      }
    },
    cancel() {
      options.onCancel?.();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

export function sseData(json: unknown): string {
  return `data: ${typeof json === "string" ? json : JSON.stringify(json)}\n\n`;
}

export function geminiChunk(
  text: string,
  extra: { finishReason?: string; thought?: boolean; usage?: boolean } = {},
): unknown {
  return {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ text, ...(extra.thought ? { thought: true } : {}) }],
        },
        ...(extra.finishReason ? { finishReason: extra.finishReason } : {}),
      },
    ],
    ...(extra.usage
      ? {
          usageMetadata: {
            promptTokenCount: 11,
            candidatesTokenCount: 7,
            totalTokenCount: 18,
          },
        }
      : {}),
  };
}

/** Records waits instead of sleeping, so retry tests are instant and exact. */
export function instantPolicy(overrides: Partial<RetryPolicy> = {}): {
  policy: RetryPolicy;
  waits: number[];
} {
  const waits: number[] = [];
  return {
    waits,
    policy: {
      maxRetries: 2,
      maxWaitMs: 15_000,
      sleep: async (ms) => {
        waits.push(ms);
      },
      ...overrides,
    },
  };
}

export function makeVector(length = 768, seed = 0): number[] {
  return Array.from({ length }, (_, i) => (i + seed) / 1000);
}

export function embeddingsBody(count: number, length = 768): unknown {
  return {
    embeddings: Array.from({ length: count }, (_, i) => ({
      values: makeVector(length, i),
    })),
  };
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

export function setTestKey(): void {
  process.env.GEMINI_API_KEY = TEST_KEY;
  delete process.env.GEMINI_LLM_MODEL;
}

export function clearTestEnv(): void {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_LLM_MODEL;
}

/** Everything observable about an error that a log line might include. */
export function everythingOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return `${error.name} ${error.message} ${error.stack ?? ""} ${JSON.stringify(error)}`;
}

export const SENSITIVE_FRAGMENTS = [
  TEST_KEY,
  "ECHOED-REQUEST-TEXT",
  "secret document sentence",
];
