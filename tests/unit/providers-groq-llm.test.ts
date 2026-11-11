import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BadRequestError,
  ProviderUnavailableError,
  RateLimitError,
} from "@/lib/providers/errors";
import { MissingEnvError } from "@/lib/providers/env";
import {
  createGroqLlmProvider,
  DEFAULT_GROQ_LLM_MODEL,
  normalizeGroqText,
} from "@/lib/providers/groq-llm";
import {
  collect,
  everythingOf,
  instantPolicy,
  jsonResponse,
  SENSITIVE_FRAGMENTS,
  sseData,
  sseResponse,
  stubFetch,
  TEST_KEY,
} from "./helpers/provider-mocks";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  process.env.GROQ_API_KEY = TEST_KEY;
  delete process.env.GROQ_LLM_MODEL;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_LLM_MODEL;
});

const MESSAGES = [
  { role: "system", content: "Answer from the passages." },
  { role: "user", content: "How long is parental leave?" },
] as const;

function chunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  };
}

function provider(overrides: { maxRetries?: number } = {}) {
  const { policy } = instantPolicy({ maxRetries: 0, ...overrides });
  return createGroqLlmProvider({ retryPolicy: policy });
}

/** An OpenAI-style error body whose message echoes sensitive text. */
const rateLimitBody = {
  error: {
    message: `ECHOED-REQUEST-TEXT secret document sentence; key ${TEST_KEY}`,
    type: "tokens",
    code: "rate_limit_exceeded",
  },
};

describe("normalizeGroqText", () => {
  it("maps full-width brackets and narrow or no-break spaces, nothing else", () => {
    expect(normalizeGroqText("14\u202Fweeks 【3】\u00A0done **bold**")).toBe(
      "14 weeks [3] done **bold**",
    );
  });
});

describe("createGroqLlmProvider: streaming", () => {
  it("yields text, drops reasoning, and ends with one finish carrying usage", async () => {
    stubFetch(() =>
      sseResponse([
        sseData(chunk({ reasoning: "thinking..." })),
        sseData(chunk({ reasoning_content: "more thinking" })),
        sseData(chunk({ content: "Leave is " })),
        sseData(chunk({ content: "14 weeks [3]." })),
        sseData(
          chunk({}, "stop", {
            x_groq: { usage: { prompt_tokens: 11, completion_tokens: 7 } },
          }),
        ),
        "data: [DONE]\n\n",
      ]),
    );
    const events = await collect(provider().stream(MESSAGES));
    expect(events).toEqual([
      { type: "text", text: "Leave is " },
      { type: "text", text: "14 weeks [3]." },
      {
        type: "finish",
        reason: "stop",
        usage: { promptTokens: 11, completionTokens: 7 },
      },
    ]);
  });

  it("normalizes citation brackets and spaces token by token", async () => {
    stubFetch(() =>
      sseResponse([
        sseData(chunk({ content: "14\u202Fweeks 【" })),
        sseData(chunk({ content: "3】." })),
        sseData(chunk({}, "stop")),
        "data: [DONE]\n\n",
      ]),
    );
    const events = await collect(provider().stream(MESSAGES));
    const text = events
      .flatMap((e) => (e.type === "text" ? [e.text] : []))
      .join("");
    expect(text).toBe("14 weeks [3].");
  });

  it("maps finish reasons: length, content_filter and unknown", async () => {
    for (const [raw, expected] of [
      ["length", "length"],
      ["content_filter", "blocked"],
      ["tool_calls", "other"],
    ] as const) {
      stubFetch(() =>
        sseResponse([
          sseData(chunk({ content: "x" }, raw)),
          "data: [DONE]\n\n",
        ]),
      );
      const events = await collect(provider().stream(MESSAGES));
      expect(events.at(-1)).toMatchObject({ type: "finish", reason: expected });
    }
  });

  it("throws when the stream ends without a finish reason", async () => {
    stubFetch(() =>
      sseResponse([sseData(chunk({ content: "cut off" })), "data: [DONE]\n\n"]),
    );
    await expect(collect(provider().stream(MESSAGES))).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("maps an error object inside a 200 stream like an HTTP error", async () => {
    stubFetch(() =>
      sseResponse([
        sseData({ error: { code: 429, message: "ECHOED-REQUEST-TEXT" } }),
      ]),
    );
    const error = await collect(provider().stream(MESSAGES)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect(everythingOf(error)).not.toContain("ECHOED-REQUEST-TEXT");
  });

  it("turns a broken connection into ProviderUnavailableError", async () => {
    stubFetch(() =>
      sseResponse([sseData(chunk({ content: "a" }))], {
        failWith: new Error("socket hang up"),
      }),
    );
    await expect(collect(provider().stream(MESSAGES))).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });
});

describe("createGroqLlmProvider: request", () => {
  it("posts to the chat completions endpoint with a bearer key and the right body", async () => {
    const { calls } = stubFetch(() =>
      sseResponse([sseData(chunk({}, "stop")), "data: [DONE]\n\n"]),
    );
    await collect(provider().stream(MESSAGES, { maxOutputTokens: 300 }));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://api.groq.com/openai/v1/chat/completions",
    );
    expect(calls[0].headers.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(calls[0].body).toEqual({
      model: DEFAULT_GROQ_LLM_MODEL,
      stream: true,
      messages: [
        { role: "system", content: "Answer from the passages." },
        { role: "user", content: "How long is parental leave?" },
      ],
      max_completion_tokens: 300,
      reasoning_effort: "low",
    });
  });

  it("sends no reasoning_effort to a model that is not gpt-oss, and honours GROQ_LLM_MODEL", async () => {
    process.env.GROQ_LLM_MODEL = "llama-3.3-70b-versatile";
    const { calls } = stubFetch(() =>
      sseResponse([sseData(chunk({}, "stop")), "data: [DONE]\n\n"]),
    );
    const p = provider();
    expect(p.model).toBe("llama-3.3-70b-versatile");
    await collect(p.stream(MESSAGES));
    expect(calls[0].body).not.toHaveProperty("reasoning_effort");
    expect(calls[0].body).toMatchObject({ model: "llama-3.3-70b-versatile" });
  });

  it("rejects bad input locally, before any request", async () => {
    const { calls } = stubFetch(() => sseResponse([]));
    await expect(
      collect(provider().stream([{ role: "user", content: "  " }])),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      collect(provider().stream(MESSAGES, { maxOutputTokens: 0 })),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(calls).toHaveLength(0);
  });

  it("throws MissingEnvError, naming only the variable, when the key is unset", async () => {
    delete process.env.GROQ_API_KEY;
    const error = await collect(provider().stream(MESSAGES)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MissingEnvError);
    expect((error as MissingEnvError).variable).toBe("GROQ_API_KEY");
  });

  it("refuses an unsafe model id", () => {
    expect(() => createGroqLlmProvider({ model: "bad id; drop" })).toThrow(
      /Invalid Groq LLM model id/,
    );
  });
});

describe("createGroqLlmProvider: HTTP failures", () => {
  it("maps 429 to RateLimitError with the retry-after hint, leaking nothing", async () => {
    stubFetch(() => jsonResponse(429, rateLimitBody, { "retry-after": "7" }));
    const error = await collect(provider().stream(MESSAGES)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).provider).toBe("groq");
    expect((error as RateLimitError).retryAfterMs).toBe(7000);
    for (const fragment of SENSITIVE_FRAGMENTS) {
      expect(everythingOf(error)).not.toContain(fragment);
    }
  });

  it("maps 401 to an auth BadRequestError and 503 to ProviderUnavailableError", async () => {
    stubFetch(() => jsonResponse(401, rateLimitBody));
    const auth = await collect(provider().stream(MESSAGES)).catch(
      (e: unknown) => e,
    );
    expect(auth).toBeInstanceOf(BadRequestError);
    expect((auth as BadRequestError).isAuthError).toBe(true);

    stubFetch(() => jsonResponse(503, rateLimitBody));
    await expect(collect(provider().stream(MESSAGES))).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });
});
