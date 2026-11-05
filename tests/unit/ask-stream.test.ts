import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAskResponseStream,
  MAX_SNIPPET_LENGTH,
  toStreamSources,
} from "@/lib/ask/stream";
import type { LlmStreamEvent } from "@/lib/providers/types";
import type { AskStreamEvent } from "@/types/ask-stream";

const sources = toStreamSources([
  { doc_id: "d1", doc_title: "Doc", page_number: 2, content: "text" },
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
});
afterEach(() => vi.restoreAllMocks());

describe("toStreamSources", () => {
  it("numbers markers from 1 and maps database fields", () => {
    const result = toStreamSources([
      { doc_id: "a", doc_title: "A", page_number: 1, content: "one" },
      { doc_id: "b", doc_title: "B", page_number: 7, content: "two" },
    ]);
    expect(result).toEqual([
      {
        marker: 1,
        documentId: "a",
        documentTitle: "A",
        page: 1,
        snippet: "one",
      },
      {
        marker: 2,
        documentId: "b",
        documentTitle: "B",
        page: 7,
        snippet: "two",
      },
    ]);
  });

  it("collapses whitespace and caps long snippets", () => {
    const [source] = toStreamSources([
      {
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
      { type: "done", citations: [], invalidCitations: [] },
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

  it("emits only llm_unavailable when the LLM fails before any token", async () => {
    const llm = llmFrom(async function* () {
      throw new Error("secret provider detail");
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm }),
    );
    // No text was released, so `sources` was never sent either.
    expect(events.map((e) => e.type)).toEqual(["error"]);
    const error = events[0];
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
      { type: "done", citations: [], invalidCitations: [] },
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

  it("emits llm_unavailable, with no sources, when the LLM fails while the start is held back", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "NOT_" };
      throw new Error("boom");
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm }),
    );
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0]).toMatchObject({ code: "llm_unavailable" });
  });

  it("treats a blocked finish while the start is held back as an error", async () => {
    const llm = llmFrom(async function* () {
      yield { type: "text", text: "NOT_" };
      yield { type: "finish", reason: "blocked" };
    });
    const events = await readAll(
      createAskResponseStream({ sources, messages, llm }),
    );
    expect(events.map((e) => e.type)).toEqual(["error"]);
  });
});
