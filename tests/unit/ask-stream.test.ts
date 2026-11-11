import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAskResponseStream,
  MAX_SNIPPET_LENGTH,
  toStreamSources,
  toStreamUsage,
} from "@/lib/ask/stream";
import type { LlmStreamEvent } from "@/lib/providers/types";
import type { AskStreamEvent } from "@/types/ask-stream";

const sources = toStreamSources([
  {
    chunk_id: 11,
    doc_id: "d1",
    doc_title: "Doc",
    page_number: 2,
    content: "text",
  },
]);
const messages = [{ role: "user" as const, content: "hi" }];

function decodeFrame(frame: string): AskStreamEvent {
  return JSON.parse(frame.replace(/^data: /, "")) as AskStreamEvent;
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<AskStreamEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text.split("\n\n").filter(Boolean).map(decodeFrame);
}

const llmFrom = (
  gen: (signal?: AbortSignal) => AsyncGenerator<LlmStreamEvent>,
) => ({
  stream: (_m: unknown, options?: { signal?: AbortSignal }) =>
    gen(options?.signal),
});

const finish: LlmStreamEvent = { type: "finish", reason: "stop" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("toStreamSources", () => {
  it("numbers markers from 1 and maps database fields", () => {
    const result = toStreamSources([
      {
        chunk_id: 21,
        doc_id: "a",
        doc_title: "A",
        page_number: 1,
        content: "one",
      },
      {
        chunk_id: 22,
        doc_id: "b",
        doc_title: "B",
        page_number: 7,
        content: "two",
      },
    ]);
    expect(result).toEqual([
      {
        marker: 1,
        documentId: "a",
        chunkId: 21,
        documentTitle: "A",
        page: 1,
        snippet: "one",
      },
      {
        marker: 2,
        documentId: "b",
        chunkId: 22,
        documentTitle: "B",
        page: 7,
        snippet: "two",
      },
    ]);
  });

  it("collapses whitespace and caps long snippets", () => {
    const [source] = toStreamSources([
      {
        chunk_id: 23,
        doc_id: "a",
        doc_title: "A",
        page_number: 1,
        content: `  a\n\n b ${"x".repeat(1000)}`,
      },
    ]);
    expect(source.snippet.startsWith("a b x")).toBe(true);
    expect(Array.from(source.snippet)).toHaveLength(MAX_SNIPPET_LENGTH);
    expect(source.snippet.endsWith("…")).toBe(true);
  });
});

describe("createAskResponseStream", () => {
  it("emits sources, then tokens, then done", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "Hel" };
      yield { type: "text", text: "" }; // empty chunks are skipped
      yield { type: "text", text: "lo [1]" };
      yield finish;
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm }),
    );
    expect(events).toEqual([
      { type: "sources", sources },
      { type: "token", text: "Hel" },
      { type: "token", text: "lo [1]" },
      { type: "done", citations: [1], invalidCitations: [] },
    ]);
  });

  it("delivers tokens incrementally, before the LLM has finished", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "first" };
      await gate;
      yield { type: "text", text: "second" };
      yield finish;
    });
    const reader = createAskResponseStream({
      sources,
      messages,
      llm,
    }).getReader();
    const decoder = new TextDecoder();
    const read = async () =>
      decodeFrame(decoder.decode((await reader.read()).value).trim());

    expect((await read()).type).toBe("sources");
    expect(await read()).toEqual({ type: "token", text: "first" }); // gate still closed
    release();
    expect(await read()).toEqual({ type: "token", text: "second" });
    expect((await read()).type).toBe("done");
  });

  it("emits sources, then llm_unavailable, when the LLM fails before any token", async () => {
    const llm = llmFrom(async function* () {
      throw new Error("secret provider detail");
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm }),
    );
    // No text was released, but the passages still go out ahead of the error.
    expect(events.map((e) => e.type)).toEqual(["sources", "error"]);
    expect(events[0]).toMatchObject({ type: "sources", sources });
    const error = events[1];
    expect(error).toMatchObject({ type: "error", code: "llm_unavailable" });
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("emits interrupted when the LLM fails after tokens were sent", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "partial" };
      throw new Error("boom");
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm }),
    );
    expect(events.map((e) => e.type)).toEqual(["sources", "token", "error"]);
    expect(events[2]).toMatchObject({ code: "interrupted" });
  });

  it("treats a blocked finish as an error, not a done", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "finish", reason: "blocked" };
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: "llm_unavailable",
    });
  });

  it("aborts the LLM and ends quietly when the request signal aborts", async () => {
    let seenSignal: AbortSignal | undefined;
    const llm = llmFrom(async function* (signal) {
      seenSignal = signal;
      yield { type: "text", text: "a" };
      await new Promise((_, reject) =>
        signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        ),
      );
    });
    const client = new AbortController();
    const reader = createAskResponseStream({
      sources,
      messages,
      llm,
      signal: client.signal,
    }).getReader();

    await reader.read(); // sources
    await reader.read(); // token "a"
    client.abort();
    expect(seenSignal?.aborted).toBe(true);
    expect((await reader.read()).done).toBe(true); // closes, no error or done event
  });

  it("aborts the LLM when the consumer cancels the stream", async () => {
    let seenSignal: AbortSignal | undefined;
    let cleanedUp = false;
    const llm = llmFrom(async function* (signal) {
      seenSignal = signal;
      try {
        yield { type: "text", text: "a" };
        yield { type: "text", text: "b" };
      } finally {
        cleanedUp = true;
      }
    });
    const reader = createAskResponseStream({
      sources,
      messages,
      llm,
    }).getReader();
    await reader.read(); // sources
    await reader.read(); // token "a"
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seenSignal?.aborted).toBe(true);
    expect(cleanedUp).toBe(true);
  });
});

describe("createAskResponseStream: refusal gate #2 (sentinel)", () => {
  const closest = sources;

  async function run(
    chunks: string[],
    options: { signal?: AbortSignal } = {},
  ): Promise<AskStreamEvent[]> {
    const llm = llmFrom(async function* () {
      for (const text of chunks) yield { type: "text", text };
      yield finish;
    });
    return readAll(
      createAskResponseStream({ sources, messages, llm, ...options }),
    );
  }

  it("converts a sentinel in one token into a single not_found frame", async () => {
    expect(await run(["NOT_FOUND"])).toEqual([{ type: "not_found", closest }]);
  });

  it("converts a sentinel split across two tokens", async () => {
    expect(await run(["NOT_", "FOUND"])).toEqual([
      { type: "not_found", closest },
    ]);
  });

  it("converts a sentinel split across many tokens, after leading whitespace", async () => {
    expect(await run(["\n", "NO", "T_F", "OUND", "."])).toEqual([
      { type: "not_found", closest },
    ]);
  });

  it("never lets any text of a refused answer through", async () => {
    const events = await run(["NOT_FOUND", " The documents do not say."]);
    expect(events.map((e) => e.type)).toEqual(["not_found"]);
    expect(JSON.stringify(events)).not.toContain("documents do not say");
  });

  it("omits closest when there are no sources", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "NOT_FOUND" };
      yield finish;
    });
    const events = await readAll(
      createAskResponseStream({ sources: [], messages, llm }),
    );
    expect(events).toEqual([{ type: "not_found" }]);
  });

  it("keeps a normal answer that merely contains 'not found' later", async () => {
    const events = await run(["The form is ", "not found [1]. ", "NOT_FOUND"]);
    expect(events).toEqual([
      { type: "sources", sources },
      { type: "token", text: "The form is " },
      { type: "token", text: "not found [1]. " },
      { type: "token", text: "NOT_FOUND" },
      { type: "done", citations: [1], invalidCitations: [] },
    ]);
  });

  it("sends sources first and releases held-back text in one token", async () => {
    const events = await run(["NOT_", "quite", " right"]);
    expect(events).toEqual([
      { type: "sources", sources },
      { type: "token", text: "NOT_quite" },
      { type: "token", text: " right" },
      { type: "done", citations: [], invalidCitations: [] },
    ]);
  });

  it("flushes a partial sentinel prefix as an answer when the stream ends", async () => {
    expect(await run(["NOT"])).toEqual([
      { type: "sources", sources },
      { type: "token", text: "NOT" },
      { type: "done", citations: [], invalidCitations: [] },
    ]);
  });

  it("still sends sources and done for an empty answer", async () => {
    expect((await run([])).map((e) => e.type)).toEqual(["sources", "done"]);
  });

  it("aborts the LLM call as soon as it refuses", async () => {
    let seenSignal: AbortSignal | undefined;
    let cleanedUp = false;
    let pulledAfterRefusal = false;
    const llm = llmFrom(async function* (signal) {
      seenSignal = signal;
      try {
        yield { type: "text", text: "NOT_FOUND" };
        pulledAfterRefusal = true;
        yield { type: "text", text: "never read" };
      } finally {
        cleanedUp = true;
      }
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.map((e) => e.type)).toEqual(["not_found"]);
    expect(seenSignal?.aborted).toBe(true);
    expect(cleanedUp).toBe(true);
    expect(pulledAfterRefusal).toBe(false);
  });

  it("emits sources, then llm_unavailable, when the LLM fails while the start is held back", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "NOT_" };
      throw new Error("boom");
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm }),
    );
    expect(events.map((e) => e.type)).toEqual(["sources", "error"]);
    expect(events[1]).toMatchObject({ code: "llm_unavailable" });
  });

  it("treats a blocked finish while the start is held back as an error", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "NOT_" };
      yield { type: "finish", reason: "blocked" };
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm }),
    );
    expect(events.map((e) => e.type)).toEqual(["sources", "error"]);
  });
});

describe("createAskResponseStream: citation validation", () => {
  const twoSources = toStreamSources([
    {
      chunk_id: 31,
      doc_id: "d1",
      doc_title: "Doc",
      page_number: 1,
      content: "one",
    },
    {
      chunk_id: 32,
      doc_id: "d2",
      doc_title: "Doc",
      page_number: 2,
      content: "two",
    },
  ]);

  async function run(
    chunks: string[],
    options: { sources?: typeof twoSources } = {},
  ): Promise<AskStreamEvent[]> {
    const llm = llmFrom(async function* () {
      for (const text of chunks) yield { type: "text", text };
      yield finish;
    });
    return readAll(
      createAskResponseStream({
        sources: options.sources ?? twoSources,
        messages,
        llm,
      }),
    );
  }

  it("reports valid and invalid markers in done, in first-appearance order", async () => {
    const events = await run(["Yes [2][1]. ", "Also [9] and [2]."]);
    expect(events.at(-1)).toEqual({
      type: "done",
      citations: [2, 1],
      invalidCitations: [9],
    });
  });

  it("finds a marker split across tokens", async () => {
    const events = await run(["Notice is 30 days [", "2", "]."]);
    expect(events.at(-1)).toEqual({
      type: "done",
      citations: [2],
      invalidCitations: [],
    });
  });

  it("validates text that was held back and released with the sentinel check", async () => {
    // "NOT_" is held, then released together with "[1]" as a normal answer.
    const events = await run(["NOT_", "ice [1]"]);
    expect(events.at(-1)).toMatchObject({ type: "done", citations: [1] });
  });

  it("treats every marker as invalid when there are no sources", async () => {
    const events = await run(["Made up [1]."], { sources: [] });
    expect(events.at(-1)).toEqual({
      type: "done",
      citations: [],
      invalidCitations: [1],
    });
  });

  it("logs an uncited answer by count only, never its text", async () => {
    await run(["Secret answer text."]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "Secret",
    );
  });

  it("does not log when the answer has a valid citation", async () => {
    await run(["Fine [1]."]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("sends no done event for a refusal", async () => {
    const events = await run(["NOT_FOUND"]);
    expect(events.map((e) => e.type)).toEqual(["not_found"]);
  });

  it("sends no done event when the LLM fails mid-stream", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "Partial [1]" };
      throw new Error("boom");
    });
    const events = await readAll(
      createAskResponseStream({ sources: twoSources, messages, llm }),
    );
    expect(events.map((e) => e.type)).toEqual(["sources", "token", "error"]);
  });
});

describe("createAskResponseStream: onRefundable (Task 5.2)", () => {
  const run = async (
    gen: (signal?: AbortSignal) => AsyncGenerator<LlmStreamEvent>,
    onRefundable = vi.fn(),
  ) => {
    const events = await readAll(
      createAskResponseStream({
        sources,
        messages,
        llm: llmFrom(gen),
        onRefundable,
      }),
    );
    return { events, onRefundable };
  };

  it("fires once when the LLM fails before any text", async () => {
    const { events, onRefundable } = await run(async function* () {
      yield* [];
      throw new Error("boom");
    });
    expect(events).toEqual([
      expect.objectContaining({ type: "sources" }),
      expect.objectContaining({ type: "error", code: "llm_unavailable" }),
    ]);
    expect(onRefundable).toHaveBeenCalledTimes(1);
  });

  it("fires when the failure comes while the sentinel check still holds text back", async () => {
    const { events, onRefundable } = await run(async function* () {
      yield { type: "text", text: "NOT_" };
      throw new Error("boom");
    });
    expect(events.map((e) => e.type)).toEqual(["sources", "error"]);
    expect(onRefundable).toHaveBeenCalledTimes(1);
  });

  it("fires when the response is blocked before any text", async () => {
    const { events, onRefundable } = await run(async function* () {
      yield { type: "finish", reason: "blocked" };
    });
    expect(events.map((e) => e.type)).toEqual(["sources", "error"]);
    expect(onRefundable).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the LLM fails after text was sent", async () => {
    const { events, onRefundable } = await run(async function* () {
      yield { type: "text", text: "Partial [1]" };
      throw new Error("boom");
    });
    expect(events.map((e) => e.type)).toEqual(["sources", "token", "error"]);
    expect(onRefundable).not.toHaveBeenCalled();
  });

  it("does not fire for a model refusal", async () => {
    const { events, onRefundable } = await run(async function* () {
      yield { type: "text", text: "NOT_FOUND" };
      yield finish;
    });
    expect(events.map((e) => e.type)).toEqual(["not_found"]);
    expect(onRefundable).not.toHaveBeenCalled();
  });

  it("does not fire for a normal answer", async () => {
    const { events, onRefundable } = await run(async function* () {
      yield { type: "text", text: "Fine [1]." };
      yield finish;
    });
    expect(events.map((e) => e.type)).toEqual(["sources", "token", "done"]);
    expect(onRefundable).not.toHaveBeenCalled();
  });

  it("does not fire when the client cancels before reading", async () => {
    const onRefundable = vi.fn();
    const stream = createAskResponseStream({
      sources,
      messages,
      llm: llmFrom(async function* () {
        yield finish;
      }),
      onRefundable,
    });
    await stream.cancel();
    expect(onRefundable).not.toHaveBeenCalled();
  });

  it("still ends the stream with an error event when the hook throws", async () => {
    const { events } = await run(
      async function* () {
        yield* [];
        throw new Error("boom");
      },
      vi.fn(() => {
        throw new Error("hook broke");
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({ type: "sources" }),
      expect.objectContaining({ type: "error", code: "llm_unavailable" }),
    ]);
  });
});

describe("usage (Task 5.3)", () => {
  const usage = {
    remaining: 4,
    dailyLimit: 20,
    resetsAt: "2026-11-11T00:00:00.000Z",
  };

  it("toStreamUsage turns a spent unit into questions left, never negative", () => {
    expect(
      toStreamUsage({
        usedToday: 16,
        dailyLimit: 20,
        resetsAt: usage.resetsAt,
      }),
    ).toEqual(usage);
    expect(
      toStreamUsage({ usedToday: 21, dailyLimit: 20, resetsAt: usage.resetsAt })
        .remaining,
    ).toBe(0);
  });

  it("puts usage on the done event", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "Answer [1]" };
      yield finish;
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm, usage }),
    );
    expect(events.at(-1)).toEqual({
      type: "done",
      citations: [1],
      invalidCitations: [],
      usage,
    });
  });

  it("puts usage on the sentinel not_found event", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "NOT_FOUND" };
      yield finish;
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm, usage }),
    );
    expect(events).toEqual([{ type: "not_found", closest: sources, usage }]);
  });

  it("sends no usage on an error event", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "partial" };
      throw new Error("boom");
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm, usage }),
    );
    expect(events.at(-1)?.type).toBe("error");
    expect(JSON.stringify(events.at(-1))).not.toContain("remaining");
  });
});
