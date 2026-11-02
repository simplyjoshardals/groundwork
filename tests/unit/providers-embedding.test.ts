import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BadRequestError,
  ProviderUnavailableError,
  RateLimitError,
} from "@/lib/providers/errors";
import { MissingEnvError } from "@/lib/providers/env";
import {
  createGeminiEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
  formatEmbeddingInput,
  GEMINI_EMBEDDING_MODEL,
} from "@/lib/providers/gemini-embedding";
import {
  clearTestEnv,
  embeddingsBody,
  everythingOf,
  googleError,
  instantPolicy,
  jsonResponse,
  SENSITIVE_FRAGMENTS,
  setTestKey,
  stubFetch,
  TEST_KEY,
} from "./helpers/provider-mocks";

vi.mock("server-only", () => ({}));

beforeEach(setTestKey);
afterEach(() => {
  vi.unstubAllGlobals();
  clearTestEnv();
});

function provider() {
  const { policy, waits } = instantPolicy();
  return {
    embedder: createGeminiEmbeddingProvider({ retryPolicy: policy }),
    waits,
  };
}

describe("embeddings: success", () => {
  it("returns one 768-length vector per text, in order, from a single request", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, embeddingsBody(3)));
    const { embedder } = provider();
    const vectors = await embedder.embed(["a", "b", "c"], "document");

    expect(calls).toHaveLength(1);
    expect(vectors).toHaveLength(3);
    for (const v of vectors) expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(vectors[0][0]).toBe(0);
    expect(vectors[2][0]).toBe(0.002);
    expect(embedder.model).toBe("gemini-embedding-2");
    expect(embedder.dimensions).toBe(768);
  });

  it("applies the document prefix and sends no taskType", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, embeddingsBody(1)));
    await provider().embedder.embed(
      ["Parental leave is 14 weeks."],
      "document",
    );

    const body = calls[0].body as { requests: Record<string, unknown>[] };
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toEqual({
      model: `models/${GEMINI_EMBEDDING_MODEL}`,
      content: {
        parts: [{ text: "title: none | text: Parental leave is 14 weeks." }],
      },
      outputDimensionality: 768,
    });
    expect("taskType" in body.requests[0]).toBe(false);
  });

  it("applies the query prefix", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, embeddingsBody(1)));
    await provider().embedder.embed(["How long is parental leave?"], "query");
    const body = calls[0].body as {
      requests: { content: { parts: { text: string }[] } }[];
    };
    expect(body.requests[0].content.parts[0].text).toBe(
      "task: search result | query: How long is parental leave?",
    );
    expect(formatEmbeddingInput("x", "query")).toBe(
      "task: search result | query: x",
    );
  });

  it("sends the key in a header, never in the URL", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, embeddingsBody(1)));
    await provider().embedder.embed(["x"], "document");
    expect(calls[0].headers["x-goog-api-key"]).toBe(TEST_KEY);
    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents",
    );
    expect(calls[0].url).not.toContain(TEST_KEY);
  });
});

describe("embeddings: input validation (no network call)", () => {
  it("returns an empty array for empty input without calling fetch or needing a key", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, embeddingsBody(0)));
    delete process.env.GEMINI_API_KEY;
    expect(await provider().embedder.embed([], "document")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("rejects blank text with BadRequestError", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, embeddingsBody(2)));
    await expect(
      provider().embedder.embed(["ok", "   "], "document"),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      provider().embedder.embed([""], "query"),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(calls).toHaveLength(0);
  });

  it("rejects text that already carries a prefix, so nothing is prefixed twice", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, embeddingsBody(1)));
    const { embedder } = provider();
    await expect(
      embedder.embed(["title: none | text: hello"], "document"),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      embedder.embed(["task: search result | query: hi"], "query"),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(calls).toHaveLength(0);
  });

  it("accepts exactly 100 texts and rejects 101", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, embeddingsBody(100)));
    const { embedder } = provider();
    const hundred = Array.from({ length: 100 }, (_, i) => `text ${i}`);
    expect(await embedder.embed(hundred, "document")).toHaveLength(100);
    await expect(
      embedder.embed([...hundred, "one more"], "document"),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(calls).toHaveLength(1);
  });

  it("throws MissingEnvError (naming the variable) when the key is absent", async () => {
    stubFetch(() => jsonResponse(200, embeddingsBody(1)));
    delete process.env.GEMINI_API_KEY;
    await expect(
      provider().embedder.embed(["x"], "document"),
    ).rejects.toBeInstanceOf(MissingEnvError);
    await expect(provider().embedder.embed(["x"], "document")).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
  });
});

describe("embeddings: malformed responses become ProviderUnavailableError", () => {
  const cases: [string, () => Response][] = [
    ["non-JSON body", () => new Response("<html>oops</html>", { status: 200 })],
    ["empty object", () => jsonResponse(200, {})],
    [
      "embeddings is not a list",
      () => jsonResponse(200, { embeddings: "nope" }),
    ],
    [
      "vector count mismatch (fewer)",
      () => jsonResponse(200, embeddingsBody(1)),
    ],
    [
      "vector count mismatch (more)",
      () => jsonResponse(200, embeddingsBody(3)),
    ],
    [
      "wrong dimension (3072)",
      () => jsonResponse(200, embeddingsBody(2, 3072)),
    ],
    [
      "wrong dimension (empty vector)",
      () => jsonResponse(200, embeddingsBody(2, 0)),
    ],
    ["item without values", () => jsonResponse(200, { embeddings: [{}, {}] })],
    [
      "non-numeric value",
      () => {
        const body = embeddingsBody(2) as {
          embeddings: { values: unknown[] }[];
        };
        body.embeddings[1].values[5] = "0.5";
        return jsonResponse(200, body);
      },
    ],
    [
      "null value",
      () => {
        const body = embeddingsBody(2) as {
          embeddings: { values: unknown[] }[];
        };
        body.embeddings[0].values[767] = null;
        return jsonResponse(200, body);
      },
    ],
  ];
  for (const [name, make] of cases) {
    it(name, async () => {
      stubFetch(() => make());
      await expect(
        provider().embedder.embed(["a", "b"], "document"),
      ).rejects.toBeInstanceOf(ProviderUnavailableError);
    });
  }

  it("rejects a non-finite value (the 1e999 JSON literal parses to Infinity)", async () => {
    const values = Array.from({ length: 768 }, () => "0.1");
    values[10] = "1e999";
    const raw = `{"embeddings":[{"values":[${values.join(",")}]}]}`;
    stubFetch(() => new Response(raw, { status: 200 }));
    await expect(
      provider().embedder.embed(["a"], "document"),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

describe("embeddings: HTTP 429", () => {
  it("retries and then succeeds, honouring Retry-After", async () => {
    const { calls } = stubFetch((_c, i) =>
      i === 0
        ? jsonResponse(429, googleError(429, "RESOURCE_EXHAUSTED"), {
            "retry-after": "2",
          })
        : jsonResponse(200, embeddingsBody(1)),
    );
    const { embedder, waits } = provider();
    expect(await embedder.embed(["x"], "document")).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2250]);
  });

  it("honours Google's retryDelay when there is no Retry-After header", async () => {
    stubFetch((_c, i) =>
      i === 0
        ? jsonResponse(
            429,
            googleError(429, "RESOURCE_EXHAUSTED", { retryDelay: "12s" }),
          )
        : jsonResponse(200, embeddingsBody(1)),
    );
    const { embedder, waits } = provider();
    await embedder.embed(["x"], "document");
    expect(waits).toEqual([12_250]);
  });

  it("throws RateLimitError with status, code and wait once retries are used up", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(429, googleError(429, "RESOURCE_EXHAUSTED"), {
        "retry-after": "1",
      }),
    );
    const { embedder } = provider();
    const error = await embedder
      .embed(["x"], "document")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      provider: "gemini",
      status: 429,
      providerCode: "RESOURCE_EXHAUSTED",
      retryAfterMs: 1000,
    });
    expect(calls).toHaveLength(3);
  });

  it("gives up immediately, without sleeping, when asked to wait too long", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(429, googleError(429, "RESOURCE_EXHAUSTED"), {
        "retry-after": "120",
      }),
    );
    const { embedder, waits } = provider();
    const error = await embedder
      .embed(["x"], "document")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ retryAfterMs: 120_000 });
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("copes with a 429 that has no body and no hints (real shape was never captured)", async () => {
    stubFetch(() => new Response("", { status: 429 }));
    const { embedder, waits } = provider();
    const error = await embedder
      .embed(["x"], "document")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      status: 429,
      providerCode: null,
      retryAfterMs: null,
    });
    expect(waits).toHaveLength(2);
  });
});

describe("embeddings: HTTP 5xx and network failures", () => {
  for (const status of [500, 502, 503, 504]) {
    it(`retries HTTP ${status} then throws ProviderUnavailableError`, async () => {
      const { calls } = stubFetch(() =>
        jsonResponse(status, googleError(status, "UNAVAILABLE")),
      );
      const error = await provider()
        .embedder.embed(["x"], "document")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect(error).toMatchObject({ status, providerCode: "UNAVAILABLE" });
      expect(calls).toHaveLength(3);
    });
  }

  it("recovers when a 503 is followed by success", async () => {
    stubFetch((_c, i) =>
      i === 0
        ? jsonResponse(503, googleError(503, "UNAVAILABLE"))
        : jsonResponse(200, embeddingsBody(1)),
    );
    expect(await provider().embedder.embed(["x"], "document")).toHaveLength(1);
  });

  it("treats a network failure as ProviderUnavailableError after retries", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts++;
      throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    });
    const error = await provider()
      .embedder.embed(["x"], "document")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(error).toMatchObject({ status: null });
    expect(attempts).toBe(3);
    expect((error as Error).message).toContain("ECONNRESET");
  });
});

describe("embeddings: HTTP 4xx", () => {
  it("maps 400 to BadRequestError without retrying", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(400, googleError(400, "INVALID_ARGUMENT")),
    );
    const error = await provider()
      .embedder.embed(["x"], "document")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestError);
    expect(error).toMatchObject({
      status: 400,
      providerCode: "INVALID_ARGUMENT",
    });
    expect((error as BadRequestError).isAuthError).toBe(false);
    expect(calls).toHaveLength(1);
  });

  for (const [status, code] of [
    [401, "UNAUTHENTICATED"],
    [403, "PERMISSION_DENIED"],
  ] as const) {
    it(`maps ${status} to BadRequestError but keeps it distinguishable as an auth failure`, async () => {
      const { calls } = stubFetch(() =>
        jsonResponse(status, googleError(status, code)),
      );
      const error = await provider()
        .embedder.embed(["x"], "document")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestError);
      expect(error).toMatchObject({ status, providerCode: code });
      expect((error as BadRequestError).isAuthError).toBe(true);
      expect(calls).toHaveLength(1);
    });
  }

  it("flags Google's 400 API_KEY_INVALID as an auth failure", async () => {
    stubFetch(() =>
      jsonResponse(
        400,
        googleError(400, "INVALID_ARGUMENT", { reason: "API_KEY_INVALID" }),
      ),
    );
    const error = await provider()
      .embedder.embed(["x"], "document")
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 400,
      providerReason: "API_KEY_INVALID",
    });
    expect((error as BadRequestError).isAuthError).toBe(true);
  });
});

describe("embeddings: secrets and response bodies never leak into errors", () => {
  const statuses = [400, 401, 403, 429, 500, 503];
  for (const status of statuses) {
    it(`HTTP ${status}: no key, request text or provider message in the error`, async () => {
      stubFetch(() => jsonResponse(status, googleError(status, "SOME_STATUS")));
      const error = await provider()
        .embedder.embed(["secret document sentence"], "document")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      const everything = everythingOf(error);
      for (const fragment of SENSITIVE_FRAGMENTS)
        expect(everything).not.toContain(fragment);
    });
  }

  it("drops provider codes that are not short enum-like strings", async () => {
    stubFetch(() =>
      jsonResponse(400, {
        error: {
          code: 400,
          status: `leak ${TEST_KEY} please`,
          details: [{ reason: "ECHOED-REQUEST-TEXT secret" }],
        },
      }),
    );
    const error = await provider()
      .embedder.embed(["x"], "document")
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ providerCode: null, providerReason: null });
    expect(everythingOf(error)).not.toContain(TEST_KEY);
  });

  it("does not leak the key on malformed responses or network errors", async () => {
    stubFetch(() => jsonResponse(200, `{"embeddings": "${TEST_KEY}"}`));
    const malformed = await provider()
      .embedder.embed(["x"], "document")
      .catch((e: unknown) => e);
    expect(everythingOf(malformed)).not.toContain(TEST_KEY);

    vi.stubGlobal("fetch", async () => {
      throw new Error(`connect failed for key ${TEST_KEY}`);
    });
    const network = await provider()
      .embedder.embed(["x"], "document")
      .catch((e: unknown) => e);
    expect(network).toBeInstanceOf(ProviderUnavailableError);
    expect(everythingOf(network)).not.toContain(TEST_KEY);
  });
});
