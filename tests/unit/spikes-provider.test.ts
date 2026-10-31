import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChunks,
  FACT_CHUNK_INDICES,
  SYNTHETIC_QUERIES,
} from "@/spikes/provider/chunks";
import { buildPrompt, defaultEmbedStyle } from "@/spikes/provider/benchmarks";
import { fetchWithRetry } from "@/spikes/provider/http";
import { parseSpikeRequest } from "@/spikes/provider/request";
import {
  cosine,
  l2Norm,
  parseRetryDelayMs,
  pickSafeHeaders,
  sseDataOf,
  splitSseEvents,
} from "@/spikes/provider/util";

describe("SSE parsing", () => {
  it("splits complete events and keeps the unfinished tail", () => {
    const { events, rest } = splitSseEvents(
      'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"',
    );
    expect(events).toHaveLength(2);
    expect(rest).toBe('data: {"c"');
  });

  it("handles CRLF line endings", () => {
    const { events } = splitSseEvents("data: one\r\n\r\ndata: two\r\n\r\n");
    expect(events.map(sseDataOf)).toEqual(["one", "two"]);
  });

  it("returns null for blocks without data lines", () => {
    expect(sseDataOf(": keep-alive")).toBeNull();
  });
});

describe("header whitelist", () => {
  it("never passes through secrets or unknown headers", () => {
    const headers = new Headers({
      authorization: "Bearer secret-value",
      "x-goog-api-key": "secret-value",
      "set-cookie": "session=secret-value",
      "x-request-id": "abc",
      "retry-after": "12",
      "x-ratelimit-remaining-tokens": "7500",
      "content-type": "text/event-stream",
    });
    const safe = pickSafeHeaders(headers);
    expect(Object.keys(safe).sort()).toEqual([
      "content-type",
      "retry-after",
      "x-ratelimit-remaining-tokens",
    ]);
    expect(JSON.stringify(safe)).not.toContain("secret-value");
  });
});

describe("vector maths", () => {
  it("computes norm and cosine", () => {
    expect(l2Norm([3, 4])).toBe(5);
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it("parses Google retry delays", () => {
    expect(parseRetryDelayMs("12s")).toBe(12_000);
    expect(parseRetryDelayMs("0.5s")).toBe(500);
    expect(parseRetryDelayMs("soon")).toBeNull();
  });
});

describe("synthetic data", () => {
  it("is deterministic and the right size", () => {
    const a = buildChunks(100);
    const b = buildChunks(100);
    expect(a).toEqual(b);
    expect(a).toHaveLength(100);
    for (const chunk of a) {
      expect(chunk.text.length).toBeGreaterThanOrEqual(700);
      expect(chunk.text.length).toBeLessThan(1100);
    }
  });

  it("puts each expected answer only in its own chunk", () => {
    const chunks = buildChunks(100);
    for (const query of SYNTHETIC_QUERIES) {
      if (query.expectedChunkIndex === null || query.expectedSubstring === null)
        continue;
      const needle = query.expectedSubstring;
      if (needle === "85") continue; // too short to be a unique-substring check
      const hits = chunks
        .filter((c) => c.text.includes(needle))
        .map((c) => c.index);
      expect(hits).toEqual([query.expectedChunkIndex]);
    }
    expect(FACT_CHUNK_INDICES).toHaveLength(5);
  });

  it("builds a RAG prompt that contains the answer passage once", () => {
    const prompt = buildPrompt("rag", 12);
    expect(prompt.user.match(/14 weeks/g)).toHaveLength(1);
    expect(prompt.user).toContain("Question:");
    expect(prompt.expectedSubstring).toBe("14 weeks");
  });
});

describe("embedding style", () => {
  it("uses prefixes for gemini-embedding-2 and taskType otherwise", () => {
    expect(defaultEmbedStyle("gemini-embedding-2")).toBe("instruction-prefix");
    expect(defaultEmbedStyle("gemini-embedding-001")).toBe("task-type");
  });
});

describe("parseSpikeRequest", () => {
  it("accepts valid requests and applies defaults", () => {
    const result = parseSpikeRequest({
      task: "embed-100",
      model: "gemini-embedding-001",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        task: "embed-100",
        model: "gemini-embedding-001",
        batchSize: 20,
        delayMs: 0,
        chunks: 100,
      },
    });
  });

  it("rejects bad input", () => {
    expect(parseSpikeRequest(null).ok).toBe(false);
    expect(
      parseSpikeRequest({ task: "embed-100", model: "bad model!" }).ok,
    ).toBe(false);
    expect(
      parseSpikeRequest({ task: "embed-100", model: "x", batchSize: 500 }).ok,
    ).toBe(false);
    expect(
      parseSpikeRequest({ task: "stream", model: "x", provider: "openai" }).ok,
    ).toBe(false);
    expect(
      parseSpikeRequest({
        task: "stream",
        model: "x",
        provider: "groq",
        maxOutputTokens: 99999,
      }).ok,
    ).toBe(false);
    expect(parseSpikeRequest({ task: "nope", model: "x" }).ok).toBe(false);
  });

  it("accepts provider-style model ids with slashes", () => {
    const result = parseSpikeRequest({
      task: "stream",
      model: "openai/gpt-oss-120b",
      provider: "groq",
    });
    expect(result.ok).toBe(true);
  });
});

describe("fetchWithRetry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries a 429 and records every attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message: "quota",
            },
          }),
          { status: 429, headers: { "retry-after": "0" } },
        ),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWithRetry(
      "https://example.test",
      {},
      { maxRetries: 2, maxWaitMs: 5000 },
    );
    expect(result.ok).toBe(true);
    expect(result.attempts.map((a) => a.status)).toEqual([429, 200]);
    expect(result.attempts[0].errorStatus).toBe("RESOURCE_EXHAUSTED");
  });

  it("gives up without sleeping when the provider asks for a long wait", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{}", {
          status: 429,
          headers: { "retry-after": "120" },
        }),
      ),
    );
    const result = await fetchWithRetry(
      "https://example.test",
      {},
      { maxRetries: 2, maxWaitMs: 15_000 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gaveUpReason).toContain("above the 15000 ms limit");
      expect(result.attempts).toHaveLength(1);
    }
  });

  it("does not retry a 400", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchWithRetry(
      "https://example.test",
      {},
      { maxRetries: 2, maxWaitMs: 5000 },
    );
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
