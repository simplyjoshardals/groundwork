import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AskStreamError,
  StreamIncompleteError,
  StreamInterruptedError,
  StreamProtocolError,
  encodeStreamEvent,
  readAskStream,
  type AskStreamEvent,
} from "@/lib/ask-stream";

const encoder = new TextEncoder();

const SOURCES: AskStreamEvent = {
  type: "sources",
  sources: [
    {
      marker: 1,
      documentId: "doc-1",
      chunkId: 1,
      documentTitle: "Employee Handbook",
      page: 4,
      snippet: "Remote work is allowed.",
    },
  ],
};
const TOKEN_A: AskStreamEvent = { type: "token", text: "Three " };
const TOKEN_B: AskStreamEvent = { type: "token", text: "days [1]." };
const DONE: AskStreamEvent = {
  type: "done",
  citations: [1],
  invalidCitations: [],
};

interface StreamOptions {
  /** Errors the stream after the chunks are delivered, instead of closing it. */
  failure?: unknown;
  onCancel?: () => void;
}

/** Builds a byte stream that delivers each chunk as its own network read. */
function makeStream(
  chunks: readonly (string | Uint8Array)[],
  options: StreamOptions = {},
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index++];
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        );
      } else if (options.failure !== undefined) {
        controller.error(options.failure);
      } else {
        controller.close();
      }
    },
    cancel() {
      options.onCancel?.();
    },
  });
}

/** Collects events until the generator ends or throws; returns both. */
async function drain(
  stream: ReadableStream<Uint8Array>,
): Promise<{ events: AskStreamEvent[]; error: unknown }> {
  const events: AskStreamEvent[] = [];
  try {
    for await (const event of readAskStream(stream)) events.push(event);
  } catch (error) {
    return { events, error };
  }
  return { events, error: undefined };
}

async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<AskStreamEvent[]> {
  const { events, error } = await drain(stream);
  if (error !== undefined) throw error;
  return events;
}

/** Splits bytes into chunks of `size`. */
function bytesIn(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size)
    out.push(bytes.slice(i, i + size));
  return out;
}

const frames = (...events: AskStreamEvent[]): string =>
  events.map(encodeStreamEvent).join("");

describe("readAskStream: the four acceptance cases", () => {
  it("reassembles an event split across two network chunks", async () => {
    const frame = encodeStreamEvent(TOKEN_A);
    const cut = 12;
    const events = await collect(
      makeStream([frame.slice(0, cut), frame.slice(cut), frames(DONE)]),
    );
    expect(events).toEqual([TOKEN_A, DONE]);
  });

  it("yields two events that arrive in one network chunk", async () => {
    const events = await collect(makeStream([frames(TOKEN_A, TOKEN_B, DONE)]));
    expect(events).toEqual([TOKEN_A, TOKEN_B, DONE]);
  });

  it("skips an unknown event type and keeps going", async () => {
    const unknown = 'data: {"type":"tick","seq":1}\n\n';
    const events = await collect(
      makeStream([frames(TOKEN_A), unknown, frames(DONE)]),
    );
    expect(events).toEqual([TOKEN_A, DONE]);
  });

  it("throws StreamIncompleteError when the stream ends without a terminal event", async () => {
    const { events, error } = await drain(
      makeStream([frames(SOURCES, TOKEN_A)]),
    );
    expect(events).toEqual([SOURCES, TOKEN_A]);
    expect(error).toBeInstanceOf(StreamIncompleteError);
    expect(error).toBeInstanceOf(AskStreamError);
  });
});

describe("readAskStream: framing", () => {
  it("handles CRLF line endings", async () => {
    const crlf = frames(TOKEN_A, DONE).replace(/\n/g, "\r\n");
    expect(await collect(makeStream([crlf]))).toEqual([TOKEN_A, DONE]);
  });

  it("handles a CRLF split between its CR and its LF", async () => {
    const crlf = frames(TOKEN_A, DONE).replace(/\n/g, "\r\n");
    const at = crlf.indexOf("\r\n\r\n") + 1; // between the first CR and LF
    const events = await collect(
      makeStream([crlf.slice(0, at), crlf.slice(at)]),
    );
    expect(events).toEqual([TOKEN_A, DONE]);
  });

  it("handles a blank line split across chunks", async () => {
    const events = await collect(
      makeStream(['data: {"type":"token","text":"x"}\n', "\n", frames(DONE)]),
    );
    expect(events).toEqual([{ type: "token", text: "x" }, DONE]);
  });

  it("gives the same events when every byte arrives separately", async () => {
    const bytes = encoder.encode(
      `: open\n\n${frames(SOURCES, TOKEN_A, TOKEN_B, DONE)}`,
    );
    const events = await collect(makeStream(bytesIn(bytes, 1)));
    expect(events).toEqual([SOURCES, TOKEN_A, TOKEN_B, DONE]);
  });

  it("does not treat `data:` without a space differently", async () => {
    const events = await collect(
      makeStream(['data:{"type":"token","text":"x"}\n\n', frames(DONE)]),
    );
    expect(events[0]).toEqual({ type: "token", text: "x" });
  });

  it("joins multiple data lines of one frame with a newline", async () => {
    const frame = 'data: {"type":"token",\ndata: "text":"joined"}\n\n';
    const events = await collect(makeStream([frame, frames(DONE)]));
    expect(events[0]).toEqual({ type: "token", text: "joined" });
  });

  it("ignores non-data fields and extra blank lines", async () => {
    const frame =
      'event: message\nid: 7\nretry: 100\ndata: {"type":"token","text":"x"}\n\n\n\n';
    const events = await collect(makeStream([frame, frames(DONE)]));
    expect(events).toEqual([{ type: "token", text: "x" }, DONE]);
  });
});

describe("readAskStream: multi-byte characters", () => {
  const text = "café 😀 日本語";
  const event: AskStreamEvent = { type: "token", text };

  it("survives a split at every byte boundary", async () => {
    const bytes = encoder.encode(frames(event, DONE));
    for (let cut = 1; cut < bytes.length; cut++) {
      const events = await collect(
        makeStream([bytes.slice(0, cut), bytes.slice(cut)]),
      );
      expect(events).toEqual([event, DONE]);
    }
  });

  it("survives a 4-byte emoji delivered one byte per chunk", async () => {
    const bytes = encoder.encode(frames({ type: "token", text: "😀" }, DONE));
    const events = await collect(makeStream(bytesIn(bytes, 1)));
    expect(events[0]).toEqual({ type: "token", text: "😀" });
  });
});

describe("readAskStream: comment frames", () => {
  it("skips an opening comment frame", async () => {
    const events = await collect(makeStream([`: open\n\n${frames(DONE)}`]));
    expect(events).toEqual([DONE]);
  });

  it("skips keep-alive comments between events, including `:` alone", async () => {
    const events = await collect(
      makeStream([
        frames(TOKEN_A),
        ": keep-alive\n\n",
        ":\n\n",
        frames(TOKEN_B, DONE),
      ]),
    );
    expect(events).toEqual([TOKEN_A, TOKEN_B, DONE]);
  });

  it("ignores a comment line inside a frame that also has data", async () => {
    const frame = ': note\ndata: {"type":"token","text":"x"}\n\n';
    const events = await collect(makeStream([frame, frames(DONE)]));
    expect(events[0]).toEqual({ type: "token", text: "x" });
  });

  it("a stream of only comments is incomplete", async () => {
    const { error } = await drain(makeStream([": open\n\n", ": ping\n\n"]));
    expect(error).toBeInstanceOf(StreamIncompleteError);
  });
});

describe("readAskStream: terminal events", () => {
  const terminals: AskStreamEvent[] = [
    DONE,
    {
      type: "not_found",
      closest: SOURCES.type === "sources" ? SOURCES.sources : [],
    },
    { type: "not_found" },
    { type: "limit", scope: "user" },
    { type: "limit", scope: "global" },
    { type: "error", code: "llm_unavailable", message: "Try again." },
  ];

  it.each(terminals)("%j ends the stream normally", async (terminal) => {
    const events = await collect(makeStream([frames(SOURCES, terminal)]));
    expect(events).toEqual([SOURCES, terminal]);
  });

  it("a terminal event can arrive with no earlier events", async () => {
    const events = await collect(
      makeStream([frames({ type: "limit", scope: "user" })]),
    );
    expect(events).toEqual([{ type: "limit", scope: "user" }]);
  });

  it("stops after the terminal event and cancels the reader", async () => {
    let cancelled = false;
    const stream = makeStream([frames(TOKEN_A, DONE), frames(TOKEN_B)], {
      onCancel: () => {
        cancelled = true;
      },
    });
    const events = await collect(stream);
    expect(events).toEqual([TOKEN_A, DONE]);
    expect(cancelled).toBe(true);
  });

  it("ignores everything after a terminal event, even malformed data", async () => {
    const events = await collect(
      makeStream([`${frames(DONE)}data: {not json\n\n`, "data: {{{\n\n"]),
    );
    expect(events).toEqual([DONE]);
  });

  it("does not require the stream to close after the terminal event", async () => {
    // A stream that stays open forever: only the terminal event can end it.
    let cancelled = false;
    const open = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frames(DONE)));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(await collect(open)).toEqual([DONE]);
    expect(cancelled).toBe(true);
  });
});

describe("readAskStream: malformed data", () => {
  it("throws StreamProtocolError for invalid JSON, keeping the cause", async () => {
    const { events, error } = await drain(
      makeStream([frames(TOKEN_A), "data: {not json\n\n"]),
    );
    expect(events).toEqual([TOKEN_A]);
    expect(error).toBeInstanceOf(StreamProtocolError);
    expect((error as StreamProtocolError).cause).toBeInstanceOf(SyntaxError);
  });

  it("throws for an empty data payload", async () => {
    const { error } = await drain(makeStream(["data:\n\n"]));
    expect(error).toBeInstanceOf(StreamProtocolError);
  });

  it("throws for a known event type with an invalid shape", async () => {
    const { error } = await drain(
      makeStream(['data: {"type":"token","text":5}\n\n']),
    );
    expect(error).toBeInstanceOf(StreamProtocolError);
  });

  it("throws for a payload that is not an object", async () => {
    for (const payload of ["null", "42", '"token"', "[]"]) {
      const { error } = await drain(makeStream([`data: ${payload}\n\n`]));
      expect(error).toBeInstanceOf(StreamProtocolError);
    }
  });

  it("throws for a payload with no type", async () => {
    const { error } = await drain(makeStream(['data: {"text":"x"}\n\n']));
    expect(error).toBeInstanceOf(StreamProtocolError);
  });

  it("cancels the reader when it throws", async () => {
    let cancelled = false;
    const { error } = await drain(
      makeStream(["data: nope\n\n", frames(DONE)], {
        onCancel: () => {
          cancelled = true;
        },
      }),
    );
    expect(error).toBeInstanceOf(StreamProtocolError);
    expect(cancelled).toBe(true);
  });
});

describe("readAskStream: incomplete streams", () => {
  it("throws StreamIncompleteError for an empty stream", async () => {
    const { events, error } = await drain(makeStream([]));
    expect(events).toEqual([]);
    expect(error).toBeInstanceOf(StreamIncompleteError);
  });

  it("discards a final frame that lacks its blank line", async () => {
    // A complete JSON value, but the frame never finished: treat as truncated.
    const unterminated = encodeStreamEvent(DONE).slice(0, -2);
    const { events, error } = await drain(
      makeStream([frames(TOKEN_A), unterminated]),
    );
    expect(events).toEqual([TOKEN_A]);
    expect(error).toBeInstanceOf(StreamIncompleteError);
  });

  it("does not throw a protocol error for a frame cut off mid-JSON at the end", async () => {
    const { error } = await drain(makeStream([frames(TOKEN_A), 'data: {"typ']));
    expect(error).toBeInstanceOf(StreamIncompleteError);
  });

  it("an unknown-only stream is incomplete, not silently successful", async () => {
    const { error } = await drain(
      makeStream(['data: {"type":"tick"}\n\n', 'data: {"type":"tock"}\n\n']),
    );
    expect(error).toBeInstanceOf(StreamIncompleteError);
  });
});

describe("readAskStream: interrupted reads", () => {
  it("wraps a reader failure in StreamInterruptedError with the cause", async () => {
    const failure = new TypeError("network error");
    const { events, error } = await drain(
      makeStream([frames(SOURCES, TOKEN_A)], { failure }),
    );
    expect(events).toEqual([SOURCES, TOKEN_A]); // delivered before the failure
    expect(error).toBeInstanceOf(StreamInterruptedError);
    expect(error).toBeInstanceOf(AskStreamError);
    expect((error as StreamInterruptedError).cause).toBe(failure);
  });

  it("wraps a failure that happens before any bytes arrive", async () => {
    const failure = new Error("connection reset");
    const { events, error } = await drain(makeStream([], { failure }));
    expect(events).toEqual([]);
    expect(error).toBeInstanceOf(StreamInterruptedError);
    expect((error as StreamInterruptedError).cause).toBe(failure);
  });

  it("wraps a non-Error rejection too", async () => {
    const { error } = await drain(makeStream([], { failure: "boom" }));
    expect(error).toBeInstanceOf(StreamInterruptedError);
    expect((error as StreamInterruptedError).cause).toBe("boom");
  });

  it("rethrows an AbortError unchanged (same instance, not wrapped)", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const { events, error } = await drain(
      makeStream([frames(TOKEN_A)], { failure: abort }),
    );
    expect(events).toEqual([TOKEN_A]);
    expect(error).toBe(abort);
    expect(error).not.toBeInstanceOf(StreamInterruptedError);
  });

  it("rethrows an AbortError-named plain Error unchanged", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { error } = await drain(makeStream([], { failure: abort }));
    expect(error).toBe(abort);
  });

  it("surfaces a real fetch-style abort from a signal", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        controller.signal.addEventListener("abort", () =>
          stream.error(controller.signal.reason),
        );
      },
    });
    const pending = drain(body);
    controller.abort();
    const { error } = await pending;
    expect((error as Error).name).toBe("AbortError");
    expect(error).not.toBeInstanceOf(StreamInterruptedError);
  });
});

describe("readAskStream: consumer behaviour", () => {
  it("cancels the reader when the consumer stops early", async () => {
    let cancelled = false;
    // Stays open, so the generator is suspended mid-stream when the loop breaks.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frames(TOKEN_A, TOKEN_B)));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const event of readAskStream(body)) {
      expect(event).toEqual(TOKEN_A);
      break;
    }
    expect(cancelled).toBe(true);
  });

  it("delivers events incrementally, before the stream has ended", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(frames(TOKEN_A)));
        await gate;
        controller.enqueue(encoder.encode(frames(DONE)));
        controller.close();
      },
    });
    const iterator = readAskStream(body);
    const first = await iterator.next();
    expect(first).toEqual({ done: false, value: TOKEN_A });
    release();
    expect(await iterator.next()).toEqual({ done: false, value: DONE });
    expect((await iterator.next()).done).toBe(true);
  });
});

describe("lib/ask-stream browser safety", () => {
  it("no module in the folder imports server-only", () => {
    const dir = join(process.cwd(), "lib", "ask-stream");
    const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
    expect(files).toEqual(
      expect.arrayContaining([
        "errors.ts",
        "events.ts",
        "index.ts",
        "parse.ts",
      ]),
    );
    for (const file of files) {
      expect(readFileSync(join(dir, file), "utf8")).not.toMatch(
        /^import .*"server-only"/m,
      );
    }
  });
});
