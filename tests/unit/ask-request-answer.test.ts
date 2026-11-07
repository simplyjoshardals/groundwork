import { describe, expect, it } from "vitest";
import {
  AskHttpError,
  AskIdleTimeoutError,
  AskNetworkError,
  describeFailure,
  requestAnswer,
  type RequestAnswerOptions,
} from "@/lib/ask-client";
import {
  StreamIncompleteError,
  StreamInterruptedError,
  StreamProtocolError,
  encodeStreamEvent,
  type AskStreamEvent,
} from "@/lib/ask-stream";

const encoder = new TextEncoder();

const SOURCES: AskStreamEvent = {
  type: "sources",
  sources: [
    {
      marker: 1,
      documentId: "11111111-1111-4111-8111-111111111111",
      chunkId: 1,
      documentTitle: "Handbook",
      page: 3,
      snippet: "Remote work is allowed.",
    },
  ],
};
const TOKEN: AskStreamEvent = { type: "token", text: "Two days." };
const DONE: AskStreamEvent = {
  type: "done",
  citations: [],
  invalidCitations: [],
};

function frames(events: AskStreamEvent[]): Uint8Array {
  return encoder.encode(events.map(encodeStreamEvent).join(""));
}

function sseResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** A stream that delivers the given chunks, then closes. */
function closedStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** Errors when `signal` aborts, as a real `fetch` body does. */
function abortAware(
  signal: AbortSignal | null | undefined,
  start: (c: ReadableStreamDefaultController<Uint8Array>) => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      signal?.addEventListener("abort", () => {
        try {
          controller.error(new DOMException("Aborted", "AbortError"));
        } catch {
          // already closed
        }
      });
      start(controller);
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drain(
  generator: AsyncGenerator<AskStreamEvent>,
): Promise<{ events: AskStreamEvent[]; error: unknown }> {
  const events: AskStreamEvent[] = [];
  try {
    for await (const event of generator) events.push(event);
  } catch (error) {
    return { events, error };
  }
  return { events, error: undefined };
}

function ask(fetchImpl: typeof fetch, options: RequestAnswerOptions = {}) {
  return requestAnswer("How many days?", { fetchImpl, ...options });
}

describe("requestAnswer", () => {
  it("posts the question and yields the stream's events in order", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return sseResponse(closedStream([frames([SOURCES, TOKEN, DONE])]));
    }) as typeof fetch;

    const { events, error } = await drain(ask(fetchImpl));

    expect(error).toBeUndefined();
    expect(events).toEqual([SOURCES, TOKEN, DONE]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/ask");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      question: "How many days?",
    });
  });

  it("yields an in-stream error event instead of throwing", async () => {
    const errorEvent: AskStreamEvent = {
      type: "error",
      code: "llm_unavailable",
      message: "x",
    };
    const fetchImpl = (async () =>
      sseResponse(
        closedStream([frames([SOURCES, errorEvent])]),
      )) as typeof fetch;

    const { events, error } = await drain(ask(fetchImpl));
    expect(error).toBeUndefined();
    expect(events).toEqual([SOURCES, errorEvent]);
  });

  it.each([
    [400, false],
    [401, false],
    [503, true],
    [500, true],
  ])(
    "a %i response throws AskHttpError (retryable: %s)",
    async (status, retryable) => {
      const fetchImpl = (async () =>
        Response.json(
          { error: "x", message: "server text" },
          { status },
        )) as typeof fetch;

      const { events, error } = await drain(ask(fetchImpl));
      expect(events).toEqual([]);
      expect(error).toBeInstanceOf(AskHttpError);
      expect((error as AskHttpError).status).toBe(status);
      const failure = describeFailure(error);
      expect(failure.retryable).toBe(retryable);
      expect(failure.message).not.toContain("server text");
    },
  );

  it("a rejected fetch becomes AskNetworkError", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    const { error } = await drain(ask(fetchImpl));
    expect(error).toBeInstanceOf(AskNetworkError);
    expect(describeFailure(error).retryable).toBe(true);
  });

  it("a connection that drops mid-stream surfaces after the events so far", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(frames([SOURCES, TOKEN]));
        else controller.error(new TypeError("network error"));
      },
    });
    const fetchImpl = (async () => sseResponse(body)) as typeof fetch;

    const { events, error } = await drain(ask(fetchImpl));
    expect(events).toEqual([SOURCES, TOKEN]);
    expect(error).toBeInstanceOf(StreamInterruptedError);
    expect(describeFailure(error).message).toContain("Connection lost");
  });

  it("a stream that closes without a terminal event is an error", async () => {
    const fetchImpl = (async () =>
      sseResponse(closedStream([frames([SOURCES, TOKEN])]))) as typeof fetch;

    const { events, error } = await drain(ask(fetchImpl));
    expect(events).toEqual([SOURCES, TOKEN]);
    expect(error).toBeInstanceOf(StreamIncompleteError);
    expect(describeFailure(error).retryable).toBe(true);
  });

  it("a 200 response with no body is a protocol error", async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 200 })) as typeof fetch;

    const { error } = await drain(ask(fetchImpl));
    expect(error).toBeInstanceOf(StreamProtocolError);
  });

  it("times out when the response never starts", async () => {
    const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      })) as typeof fetch;

    const { error } = await drain(ask(fetchImpl, { idleTimeoutMs: 30 }));
    expect(error).toBeInstanceOf(AskIdleTimeoutError);
    expect(describeFailure(error).retryable).toBe(true);
  });

  it("times out when the stream goes silent after some events", async () => {
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      sseResponse(
        abortAware(init?.signal, (c) => c.enqueue(frames([SOURCES]))),
      )) as typeof fetch;

    const { events, error } = await drain(
      ask(fetchImpl, { idleTimeoutMs: 40 }),
    );
    expect(events).toEqual([SOURCES]);
    expect(error).toBeInstanceOf(AskIdleTimeoutError);
  });

  it("does not time out while events keep arriving", async () => {
    const all: AskStreamEvent[] = [SOURCES, TOKEN, TOKEN, TOKEN, DONE];
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      sseResponse(
        abortAware(init?.signal, (c) => {
          void (async () => {
            for (const e of all) {
              await sleep(40);
              c.enqueue(frames([e]));
            }
          })();
        }),
      )) as typeof fetch;

    // Total time (about 200 ms) exceeds the limit; each gap (40 ms) does not.
    const { events, error } = await drain(
      ask(fetchImpl, { idleTimeoutMs: 150 }),
    );
    expect(error).toBeUndefined();
    expect(events).toEqual(all);
  });

  it("rethrows an abort the caller started, not as a timeout", async () => {
    const controller = new AbortController();
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      sseResponse(
        abortAware(init?.signal, (c) => c.enqueue(frames([SOURCES]))),
      )) as typeof fetch;

    const generator = ask(fetchImpl, { signal: controller.signal });
    const first = await generator.next();
    expect(first.value).toEqual(SOURCES);
    controller.abort();

    const { error } = await drain(generator);
    expect((error as { name?: string }).name).toBe("AbortError");
    expect(error).not.toBeInstanceOf(AskIdleTimeoutError);
  });
});

describe("describeFailure", () => {
  it("falls back to a generic retryable message for unknown errors", () => {
    expect(describeFailure(new Error("boom"))).toEqual({
      message: "Something went wrong. Please try again.",
      retryable: true,
    });
  });

  it("tells the user to reload on a 401 and offers no Retry", () => {
    const failure = describeFailure(new AskHttpError(401));
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain("Reload");
  });
});
