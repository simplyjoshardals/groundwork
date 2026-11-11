import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitError } from "@/lib/providers/errors";
import {
  collect,
  geminiChunk,
  googleError,
  jsonResponse,
  sseData,
  sseResponse,
  stubFetch,
  TEST_KEY,
} from "./helpers/provider-mocks";

vi.mock("server-only", () => ({}));

const MESSAGES = [
  { role: "system", content: "Answer from the passages." },
  { role: "user", content: "How long is parental leave?" },
] as const;

beforeEach(() => {
  process.env.GEMINI_API_KEY = TEST_KEY;
  process.env.GROQ_API_KEY = "groq-key-SECRET-456";
  delete process.env.GEMINI_LLM_MODEL;
  delete process.env.GROQ_LLM_MODEL;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.resetModules(); // the "no fallback" warning is once per module instance
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
});

async function load() {
  return (await import("@/lib/providers/answer-llm")).createAnswerLlmProvider;
}

const isGemini = (url: string) => url.includes("generativelanguage");

const geminiOk = () =>
  sseResponse([
    sseData(geminiChunk("Gemini says 14 weeks [1].")),
    sseData(geminiChunk("", { finishReason: "STOP" })),
  ]);
const groqOk = () =>
  sseResponse([
    sseData({
      choices: [{ delta: { content: "Groq says 14\u202Fweeks 【1】." } }],
    }),
    sseData({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    "data: [DONE]\n\n",
  ]);
// A long retry-after makes the adapter give up at once instead of waiting.
const gemini429 = () =>
  jsonResponse(429, googleError(429, "RESOURCE_EXHAUSTED"), {
    "retry-after": "60",
  });
const groq429 = () =>
  jsonResponse(
    429,
    { error: { code: "rate_limit_exceeded" } },
    {
      "retry-after": "60",
    },
  );

function textOf(events: Awaited<ReturnType<typeof collect>>): string {
  return (events as { type: string; text?: string }[])
    .flatMap((e) => (e.type === "text" && e.text ? [e.text] : []))
    .join("");
}

describe("createAnswerLlmProvider (Task 5.5)", () => {
  it("answers from Groq, with normalized citations, when Gemini returns 429", async () => {
    const { calls } = stubFetch((call) =>
      isGemini(call.url) ? gemini429() : groqOk(),
    );
    const llm = (await load())();
    const events = await collect(llm.stream(MESSAGES));
    expect(textOf(events)).toBe("Groq says 14 weeks [1].");
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
    expect(calls).toHaveLength(2);
    expect(isGemini(calls[0].url)).toBe(true);
    expect(calls[1].url).toContain("api.groq.com");
    // Each provider gets only its own key.
    expect(calls[0].headers["x-goog-api-key"]).toBe(TEST_KEY);
    expect(calls[1].headers.authorization).toBe("Bearer groq-key-SECRET-456");
  });

  it("never calls Groq while Gemini works", async () => {
    const { calls } = stubFetch(() => geminiOk());
    const events = await collect((await load())().stream(MESSAGES));
    expect(textOf(events)).toBe("Gemini says 14 weeks [1].");
    expect(calls).toHaveLength(1);
  });

  it("fails with a provider error when both providers are rate limited", async () => {
    const { calls } = stubFetch((call) =>
      isGemini(call.url) ? gemini429() : groq429(),
    );
    const error = await collect((await load())().stream(MESSAGES)).catch(
      (e: unknown) => e,
    );
    // Compared by name: `vi.resetModules()` gives each test fresh error classes.
    expect((error as Error).name).toBe("RateLimitError");
    expect((error as RateLimitError).provider).toBe("groq");
    expect(calls).toHaveLength(2);
  });

  it("runs on Gemini alone, and says so once, when GROQ_API_KEY is unset", async () => {
    delete process.env.GROQ_API_KEY;
    const { calls } = stubFetch(() => geminiOk());
    const create = await load();
    await collect(create().stream(MESSAGES));
    await collect(create().stream(MESSAGES));
    expect(calls.every((c) => isGemini(c.url))).toBe(true);
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.filter((c) => String(c[0]).includes("GROQ_API_KEY"));
    expect(warnings).toHaveLength(1);
  });

  it("without a fallback a Gemini 429 is a plain error", async () => {
    delete process.env.GROQ_API_KEY;
    stubFetch(() => gemini429());
    const error = await collect((await load())().stream(MESSAGES)).catch(
      (e: unknown) => e,
    );
    expect((error as Error).name).toBe("RateLimitError");
    expect((error as RateLimitError).provider).toBe("gemini");
  });
});
