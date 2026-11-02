import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BadRequestError,
  ProviderError,
  ProviderUnavailableError,
  RateLimitError,
} from "@/lib/providers/errors";
import { MissingEnvError } from "@/lib/providers/env";
import {
  createGeminiLlmProvider,
  DEFAULT_GEMINI_LLM_MODEL,
} from "@/lib/providers/gemini-llm";
import type { LlmStreamEvent } from "@/lib/providers/types";
import {
  clearTestEnv,
  collect,
  everythingOf,
  geminiChunk,
  googleError,
  instantPolicy,
  jsonResponse,
  SENSITIVE_FRAGMENTS,
  setTestKey,
  sseData,
  sseResponse,
  stubFetch,
  TEST_KEY,
} from "./helpers/provider-mocks";

vi.mock("server-only", () => ({}));

beforeEach(setTestKey);
afterEach(() => {
  vi.unstubAllGlobals();
  clearTestEnv();
});

const MESSAGES = [
  { role: "system", content: "Answer from the passages." },
  { role: "user", content: "How long is parental leave?" },
] as const;

function llm() {
  const { policy, waits } = instantPolicy();
  return { provider: createGeminiLlmProvider({ retryPolicy: policy }), waits };
}

function happyStream(): Response {
  return sseResponse([
    sseData(geminiChunk("Parental leave ")),
    sseData(geminiChunk("is 14 weeks [3].")),
    sseData(geminiChunk("", { finishReason: "STOP", usage: true })),
  ]);
}

describe("llm: success", () => {
  it("yields text events in order, then exactly one finish event with usage", async () => {
    stubFetch(() => happyStream());
    const events = await collect(llm().provider.stream(MESSAGES));
    expect(events).toEqual([
      { type: "text", text: "Parental leave " },
      { type: "text", text: "is 14 weeks [3]." },
      {
        type: "finish",
        reason: "stop",
        usage: { promptTokens: 11, completionTokens: 7 },
      },
    ]);
  });

  it("reassembles events split at arbitrary byte boundaries, with CRLF line endings", async () => {
    const wire =
      sseData(geminiChunk("Hello, ")) +
      sseData(geminiChunk("world", { finishReason: "STOP" }));
    const crlf = wire.replace(/\n/g, "\r\n");
    const pieces: string[] = [];
    for (let i = 0; i < crlf.length; i += 7) pieces.push(crlf.slice(i, i + 7));
    stubFetch(() => sseResponse(pieces));
    const events = await collect(llm().provider.stream(MESSAGES));
    expect(events.filter((e) => e.type === "text")).toEqual([
      { type: "text", text: "Hello, " },
      { type: "text", text: "world" },
    ]);
    expect(events[events.length - 1]).toEqual({
      type: "finish",
      reason: "stop",
    });
  });

  it("does not need a trailing blank line after the last event", async () => {
    stubFetch(() =>
      sseResponse([
        sseData(geminiChunk("Hi")),
        `data: ${JSON.stringify(geminiChunk("", { finishReason: "STOP" }))}`,
      ]),
    );
    const events = await collect(llm().provider.stream(MESSAGES));
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ type: "finish", reason: "stop" });
  });

  it("drops reasoning (thought) parts", async () => {
    stubFetch(() =>
      sseResponse([
        sseData(geminiChunk("hidden reasoning", { thought: true })),
        sseData(geminiChunk("answer", { finishReason: "STOP" })),
      ]),
    );
    const events = await collect(llm().provider.stream(MESSAGES));
    expect(events.filter((e) => e.type === "text")).toEqual([
      { type: "text", text: "answer" },
    ]);
  });

  it("ignores SSE comments and unknown-but-valid chunks", async () => {
    stubFetch(() =>
      sseResponse([
        ": keep-alive\n\n",
        sseData({ modelVersion: "x" }),
        sseData(geminiChunk("ok", { finishReason: "STOP" })),
      ]),
    );
    const events = await collect(llm().provider.stream(MESSAGES));
    expect(events).toHaveLength(2);
  });
});

describe("llm: request construction", () => {
  it("maps roles, puts system text in systemInstruction, sends the key as a header", async () => {
    const { calls } = stubFetch(() => happyStream());
    await collect(
      llm().provider.stream(
        [
          { role: "system", content: "Rule one." },
          { role: "system", content: "Rule two." },
          { role: "user", content: "Q1" },
          { role: "assistant", content: "A1" },
          { role: "user", content: "Q2" },
        ],
        { maxOutputTokens: 600 },
      ),
    );
    expect(calls[0].url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_LLM_MODEL}:streamGenerateContent?alt=sse`,
    );
    expect(calls[0].url).not.toContain(TEST_KEY);
    expect(calls[0].headers["x-goog-api-key"]).toBe(TEST_KEY);
    expect(calls[0].body).toEqual({
      systemInstruction: { parts: [{ text: "Rule one.\n\nRule two." }] },
      contents: [
        { role: "user", parts: [{ text: "Q1" }] },
        { role: "model", parts: [{ text: "A1" }] },
        { role: "user", parts: [{ text: "Q2" }] },
      ],
      generationConfig: { maxOutputTokens: 600 },
    });
  });

  it("omits systemInstruction and generationConfig when not needed", async () => {
    const { calls } = stubFetch(() => happyStream());
    await collect(llm().provider.stream([{ role: "user", content: "hi" }]));
    expect(calls[0].body).toEqual({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    });
  });

  it("rejects invalid messages locally, before any network call", async () => {
    const { calls } = stubFetch(() => happyStream());
    const { provider } = llm();
    await expect(collect(provider.stream([]))).rejects.toBeInstanceOf(
      BadRequestError,
    );
    await expect(
      collect(provider.stream([{ role: "system", content: "only system" }])),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      collect(provider.stream([{ role: "user", content: "  " }])),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      collect(
        provider.stream([{ role: "user", content: "ok" }], {
          maxOutputTokens: 0,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(calls).toHaveLength(0);
  });

  it("throws MissingEnvError when the key is absent", async () => {
    stubFetch(() => happyStream());
    delete process.env.GEMINI_API_KEY;
    await expect(
      collect(llm().provider.stream(MESSAGES)),
    ).rejects.toBeInstanceOf(MissingEnvError);
  });
});

describe("llm: model is configurable", () => {
  it("uses the default, then the env var, then the option", () => {
    expect(createGeminiLlmProvider().model).toBe(DEFAULT_GEMINI_LLM_MODEL);
    process.env.GEMINI_LLM_MODEL = "gemma-4-26b";
    expect(createGeminiLlmProvider().model).toBe("gemma-4-26b");
    expect(createGeminiLlmProvider({ model: "gemini-test-model" }).model).toBe(
      "gemini-test-model",
    );
  });

  it("puts the configured model in the URL", async () => {
    const { calls } = stubFetch(() => happyStream());
    await collect(
      createGeminiLlmProvider({ model: "gemini-test-model" }).stream(MESSAGES),
    );
    expect(calls[0].url).toContain(
      "/models/gemini-test-model:streamGenerateContent",
    );
  });

  it("rejects model ids that could alter the URL path", () => {
    for (const bad of ["../x", "a/b", "a b", "", "a?b=1", "x:y"]) {
      expect(() => createGeminiLlmProvider({ model: bad })).toThrow(
        /Invalid Gemini LLM model id/,
      );
    }
  });

  it("does not need an API key just to be created", () => {
    delete process.env.GEMINI_API_KEY;
    expect(createGeminiLlmProvider().model).toBe(DEFAULT_GEMINI_LLM_MODEL);
  });
});

describe("llm: finish reasons", () => {
  const cases: [string, string][] = [
    ["MAX_TOKENS", "length"],
    ["SAFETY", "blocked"],
    ["RECITATION", "blocked"],
    ["OTHER", "other"],
    ["SOMETHING_NEW", "other"],
  ];
  for (const [gemini, normalized] of cases) {
    it(`${gemini} -> ${normalized}`, async () => {
      stubFetch(() =>
        sseResponse([
          sseData(geminiChunk("partial", { finishReason: gemini })),
        ]),
      );
      const events = await collect(llm().provider.stream(MESSAGES));
      expect(events[events.length - 1]).toEqual({
        type: "finish",
        reason: normalized,
      });
    });
  }

  it("reports a blocked prompt (no candidates) as finish: blocked", async () => {
    stubFetch(() =>
      sseResponse([sseData({ promptFeedback: { blockReason: "SAFETY" } })]),
    );
    expect(await collect(llm().provider.stream(MESSAGES))).toEqual([
      { type: "finish", reason: "blocked" },
    ]);
  });
});

describe("llm: failures before the stream starts", () => {
  it("retries a 429 then streams", async () => {
    const { calls } = stubFetch((_c, i) =>
      i === 0
        ? jsonResponse(429, googleError(429, "RESOURCE_EXHAUSTED"), {
            "retry-after": "1",
          })
        : happyStream(),
    );
    const { provider, waits } = llm();
    expect(await collect(provider.stream(MESSAGES))).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([1250]);
  });

  it("throws RateLimitError when 429 persists", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(429, googleError(429, "RESOURCE_EXHAUSTED"), {
        "retry-after": "1",
      }),
    );
    const error = await collect(llm().provider.stream(MESSAGES)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      status: 429,
      providerCode: "RESOURCE_EXHAUSTED",
      retryAfterMs: 1000,
    });
    expect(calls).toHaveLength(3);
  });

  it("throws RateLimitError immediately when asked to wait too long", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(429, {}, { "retry-after": "300" }),
    );
    const { provider, waits } = llm();
    await expect(collect(provider.stream(MESSAGES))).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  for (const status of [500, 503]) {
    it(`retries HTTP ${status} then throws ProviderUnavailableError`, async () => {
      const { calls } = stubFetch(() =>
        jsonResponse(status, googleError(status, "UNAVAILABLE")),
      );
      const error = await collect(llm().provider.stream(MESSAGES)).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect(error).toMatchObject({ status });
      expect(calls).toHaveLength(3);
    });
  }

  it("maps 400 to BadRequestError without retrying", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(400, googleError(400, "INVALID_ARGUMENT")),
    );
    await expect(
      collect(llm().provider.stream(MESSAGES)),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(calls).toHaveLength(1);
  });

  it("keeps auth failures distinguishable (401, 403, API_KEY_INVALID)", async () => {
    for (const [status, code, reason] of [
      [401, "UNAUTHENTICATED", undefined],
      [403, "PERMISSION_DENIED", undefined],
      [400, "INVALID_ARGUMENT", "API_KEY_INVALID"],
    ] as const) {
      stubFetch(() =>
        jsonResponse(status, googleError(status, code, { reason })),
      );
      const error = await collect(llm().provider.stream(MESSAGES)).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(BadRequestError);
      expect(error).toMatchObject({ status, providerCode: code });
      expect((error as BadRequestError).isAuthError).toBe(true);
    }
  });

  it("treats a 200 with no body as ProviderUnavailableError", async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    await expect(
      collect(llm().provider.stream(MESSAGES)),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("treats network failures as ProviderUnavailableError after retries", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts++;
      throw new TypeError("fetch failed");
    });
    await expect(
      collect(llm().provider.stream(MESSAGES)),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(attempts).toBe(3);
  });
});

describe("llm: pre-stream errors never leak secrets or provider messages", () => {
  for (const status of [400, 401, 429, 503]) {
    it(`HTTP ${status}`, async () => {
      stubFetch(() => jsonResponse(status, googleError(status, "SOME_STATUS")));
      const error = await collect(llm().provider.stream(MESSAGES)).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ProviderError);
      for (const fragment of SENSITIVE_FRAGMENTS)
        expect(everythingOf(error)).not.toContain(fragment);
    });
  }
});

describe("llm: failures after the first token propagate through the iterator", () => {
  async function drain(iterable: AsyncIterable<LlmStreamEvent>) {
    const seen: LlmStreamEvent[] = [];
    let error: unknown = null;
    try {
      for await (const event of iterable) seen.push(event);
    } catch (e) {
      error = e;
    }
    return { seen, error };
  }

  it("a malformed chunk mid-stream throws after earlier text was delivered", async () => {
    stubFetch(() =>
      sseResponse([
        sseData(geminiChunk("first ")),
        "data: {not json\n\n",
        sseData(geminiChunk("never", { finishReason: "STOP" })),
      ]),
    );
    const { seen, error } = await drain(llm().provider.stream(MESSAGES));
    expect(seen).toEqual([{ type: "text", text: "first " }]);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
  });

  it("a non-object chunk is malformed", async () => {
    stubFetch(() => sseResponse([sseData(geminiChunk("a")), sseData("42")]));
    const { seen, error } = await drain(llm().provider.stream(MESSAGES));
    expect(seen).toHaveLength(1);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
  });

  it("a connection that dies mid-stream becomes ProviderUnavailableError", async () => {
    stubFetch(() =>
      sseResponse([sseData(geminiChunk("partial "))], {
        failWith: new TypeError("terminated", {
          cause: { code: "UND_ERR_SOCKET" },
        }),
      }),
    );
    const { seen, error } = await drain(llm().provider.stream(MESSAGES));
    expect(seen).toEqual([{ type: "text", text: "partial " }]);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as Error).message).toContain("UND_ERR_SOCKET");
  });

  it("a stream that just ends, with no finish reason, is an error, not a complete answer", async () => {
    stubFetch(() => sseResponse([sseData(geminiChunk("cut off"))]));
    const { seen, error } = await drain(llm().provider.stream(MESSAGES));
    expect(seen).toEqual([{ type: "text", text: "cut off" }]);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as Error).message).toContain("finish reason");
  });

  it("an in-stream 429 error object becomes RateLimitError", async () => {
    stubFetch(() =>
      sseResponse([
        sseData(geminiChunk("a")),
        sseData(googleError(429, "RESOURCE_EXHAUSTED")),
      ]),
    );
    const { seen, error } = await drain(llm().provider.stream(MESSAGES));
    expect(seen).toHaveLength(1);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      status: 429,
      providerCode: "RESOURCE_EXHAUSTED",
    });
  });

  it("an in-stream 503 error object becomes ProviderUnavailableError, and 400 BadRequestError", async () => {
    stubFetch(() => sseResponse([sseData(googleError(503, "UNAVAILABLE"))]));
    expect((await drain(llm().provider.stream(MESSAGES))).error).toBeInstanceOf(
      ProviderUnavailableError,
    );
    stubFetch(() =>
      sseResponse([sseData(googleError(400, "INVALID_ARGUMENT"))]),
    );
    expect((await drain(llm().provider.stream(MESSAGES))).error).toBeInstanceOf(
      BadRequestError,
    );
  });

  it("is not retried once streaming has begun (one fetch call)", async () => {
    const { calls } = stubFetch(() =>
      sseResponse([sseData(geminiChunk("a"))], { failWith: new Error("boom") }),
    );
    await drain(llm().provider.stream(MESSAGES));
    expect(calls).toHaveLength(1);
  });

  it("no secrets or provider messages leak from stream errors", async () => {
    stubFetch(() =>
      sseResponse([
        sseData(geminiChunk("a")),
        sseData(googleError(429, "RESOURCE_EXHAUSTED")),
      ]),
    );
    const { error } = await drain(llm().provider.stream(MESSAGES));
    for (const fragment of SENSITIVE_FRAGMENTS)
      expect(everythingOf(error)).not.toContain(fragment);

    stubFetch(() =>
      sseResponse([sseData(geminiChunk("a"))], {
        failWith: new Error(`socket error ${TEST_KEY}`),
      }),
    );
    const second = await drain(llm().provider.stream(MESSAGES));
    expect(second.error).toBeInstanceOf(ProviderUnavailableError);
    expect(everythingOf(second.error)).not.toContain(TEST_KEY);
  });
});

describe("llm: cancellation and cleanup", () => {
  it("cancels the underlying stream when the consumer stops early", async () => {
    let cancelled = false;
    stubFetch(() =>
      sseResponse(
        [
          sseData(geminiChunk("one ")),
          sseData(geminiChunk("two ")),
          sseData(geminiChunk("three", { finishReason: "STOP" })),
        ],
        {
          onCancel: () => {
            cancelled = true;
          },
        },
      ),
    );
    for await (const event of llm().provider.stream(MESSAGES)) {
      if (event.type === "text") break;
    }
    expect(cancelled).toBe(true);
  });

  it("rethrows a caller abort as-is and does not wrap or retry it", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("user left", "AbortError"));
    const { calls } = stubFetch(() => happyStream());
    const error = await collect(
      llm().provider.stream(MESSAGES, { signal: controller.signal }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect(error).not.toBeInstanceOf(ProviderError);
    expect(calls).toHaveLength(0);
  });

  it("rethrows an abort that happens mid-stream without wrapping it", async () => {
    const controller = new AbortController();
    stubFetch(() =>
      sseResponse([sseData(geminiChunk("a "))], {
        failWith: new DOMException("aborted", "AbortError"),
      }),
    );
    const seen: LlmStreamEvent[] = [];
    let error: unknown = null;
    try {
      for await (const event of llm().provider.stream(MESSAGES, {
        signal: controller.signal,
      })) {
        seen.push(event);
        controller.abort();
      }
    } catch (e) {
      error = e;
    }
    expect(seen).toHaveLength(1);
    expect(error).not.toBeInstanceOf(ProviderError);
  });
});
