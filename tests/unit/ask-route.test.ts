import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getClaims = vi.fn();
const rpc = vi.fn();
const embed = vi.fn();
const llmStream = vi.fn();
const { consumeUsage, refundUsage } = vi.hoisted(() => ({
  consumeUsage: vi.fn(),
  refundUsage: vi.fn(),
}));

// The spend and refund calls are mocked; the real denial mapping is kept.
vi.mock("@/features/limits", async () => {
  const types = await import("@/features/limits/types");
  return {
    UsageCheckError: types.UsageCheckError,
    limitInfoFor: types.limitInfoFor,
    consumeUsage,
    refundUsage,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getClaims }, rpc })),
}));

vi.mock("@/lib/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers")>()),
  createGeminiEmbeddingProvider: () => ({
    model: "emb-model",
    dimensions: 3,
    embed,
  }),
  createAnswerLlmProvider: () => ({ model: "llm-model", stream: llmStream }),
}));

import * as route from "@/app/api/ask/route";
import { REFUSAL_SIMILARITY_THRESHOLD } from "@/lib/config";
import { UsageCheckError } from "@/features/limits/types";
import { ProviderUnavailableError } from "@/lib/providers";
import type { AskStreamEvent } from "@/types/ask-stream";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const ROW = {
  chunk_id: 1,
  doc_id: UUID,
  doc_title: "Handbook",
  page_number: 4,
  char_start: 0,
  char_end: 10,
  content: "Notice is 30 days.",
  similarity: 0.9,
};

const RESET = "2026-11-10T00:00:00.000Z";
// The default `consumeUsage` answer is 1 of 20 used, so 19 are left.
const USAGE = { remaining: 19, dailyLimit: 20, resetsAt: RESET };

const post = (body: unknown, raw = false) =>
  route.POST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );

async function readEvents(response: Response): Promise<AskStreamEvent[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data: /, "")) as AskStreamEvent);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
  consumeUsage.mockResolvedValue({
    allowed: true,
    usedToday: 1,
    dailyLimit: 20,
    resetsAt: RESET,
  });
  refundUsage.mockResolvedValue(undefined);
  embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
  rpc.mockResolvedValue({ data: [ROW], error: null });
  llmStream.mockImplementation(async function* () {
    yield { type: "text", text: "30 days [1]" };
    yield { type: "finish", reason: "stop" };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("route config", () => {
  it("exports only POST and the approved segment config", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(60);
    expect(
      Object.keys(route).filter((k) => /^(GET|PUT|PATCH|DELETE)$/.test(k)),
    ).toEqual([]);
  });

  it("does not import the admin Supabase client", () => {
    const source = readFileSync("app/api/ask/route.ts", "utf8");
    expect(source).not.toMatch(/supabase\/admin|createAdminSupabase/);
  });
});

describe("POST /api/ask: request validation", () => {
  it("returns 400 for invalid JSON, before touching auth", async () => {
    const response = await post("{not json", true);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid shape", async () => {
    const response = await post({ question: "" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
    expect(embed).not.toHaveBeenCalled();
  });
});

describe("POST /api/ask: authentication", () => {
  it.each([
    ["error", { data: null, error: { message: "no session" } }],
    ["no claims", { data: { claims: null }, error: null }],
  ])("returns 401 on %s and does no work", async (_name, result) => {
    getClaims.mockResolvedValue(result);
    const response = await post({ question: "Q" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(embed).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(consumeUsage).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a retryable fetch error",
      Object.assign(new Error("fetch failed"), {
        name: "AuthRetryableFetchError",
        status: 0,
      }),
    ],
    [
      "a 503 from the auth server",
      Object.assign(new Error("unavailable"), {
        name: "AuthApiError",
        status: 503,
      }),
    ],
  ])(
    "returns 503 auth_unavailable on %s (not 401), spending and calling nothing (Task 5.9)",
    async (_name, error) => {
      getClaims.mockResolvedValue({ data: null, error });
      const response = await post({ question: "Q" });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "auth_unavailable",
      });
      expect(consumeUsage).not.toHaveBeenCalled();
      expect(refundUsage).not.toHaveBeenCalled();
      expect(embed).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        "[ask] auth service unavailable:",
        expect.stringContaining("Error"),
      );
    },
  );

  it.each([
    ["missing", {}],
    ["empty", { sub: "" }],
    ["not a string", { sub: 7 }],
  ])(
    "returns 401 when the sub claim is %s, spending nothing",
    async (_n, claims) => {
      getClaims.mockResolvedValue({ data: { claims }, error: null });
      const response = await post({ question: "Q" });
      expect(response.status).toBe(401);
      expect(consumeUsage).not.toHaveBeenCalled();
      expect(embed).not.toHaveBeenCalled();
    },
  );
});

describe("POST /api/ask: success", () => {
  it("embeds as a query, searches with pgvector text, and streams in order", async () => {
    const response = await post({
      question: "  How long is notice? ",
      documentId: UUID,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    expect(embed).toHaveBeenCalledWith(["How long is notice?"], "query");
    expect(rpc).toHaveBeenCalledWith("match_chunks", {
      query_embedding: "[0.1,0.2,0.3]",
      p_embedding_model: "emb-model",
      match_count: 6,
      p_document_id: UUID,
    });

    // The LLM is only called once the body is read (lazy first pull).
    const events = await readEvents(response);

    const messages = llmStream.mock.calls[0][0] as {
      role: string;
      content: string;
    }[];
    expect(messages[1].content).toContain("Notice is 30 days.");
    expect(messages[1].content).toContain("How long is notice?");

    expect(events).toEqual([
      {
        type: "sources",
        sources: [
          {
            marker: 1,
            documentId: UUID,
            chunkId: 1,
            documentTitle: "Handbook",
            page: 4,
            snippet: "Notice is 30 days.",
          },
        ],
      },
      { type: "token", text: "30 days [1]" },
      { type: "done", citations: [1], invalidCitations: [], usage: USAGE },
    ]);
  });

  it("omits p_document_id when none is given", async () => {
    await (await post({ question: "Q" })).text();
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_document_id");
  });
});

describe("POST /api/ask: refusal gate #1", () => {
  it("answers not_found with the closest matches and never calls the LLM below the threshold", async () => {
    rpc.mockResolvedValue({
      data: [{ ...ROW, similarity: 0.6 }],
      error: null,
    });
    const response = await post({ question: "Q" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    // The body is fully read, so a lazy LLM call would have happened by now.
    const events = await readEvents(response);
    expect(llmStream).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: "not_found",
        closest: [
          {
            marker: 1,
            documentId: UUID,
            chunkId: 1,
            documentTitle: "Handbook",
            page: 4,
            snippet: "Notice is 30 days.",
          },
        ],
        usage: USAGE,
      },
    ]);
  });

  it("answers not_found without `closest` when nothing was retrieved", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const events = await readEvents(await post({ question: "Q" }));
    expect(llmStream).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "not_found", usage: USAGE }]);
  });

  it("still calls the LLM at exactly the threshold", async () => {
    rpc.mockResolvedValue({
      data: [{ ...ROW, similarity: REFUSAL_SIMILARITY_THRESHOLD }],
      error: null,
    });
    const events = await readEvents(await post({ question: "Q" }));
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual([
      "sources",
      "token",
      "done",
    ]);
  });
});

describe("POST /api/ask: refusal gate #2 (sentinel)", () => {
  it("answers a single not_found frame, with closest, when the model replies NOT_FOUND", async () => {
    llmStream.mockImplementation(async function* () {
      yield { type: "text", text: "NOT_" };
      yield { type: "text", text: "FOUND" };
      yield { type: "finish", reason: "stop" };
    });
    const response = await post({ question: "Q" });
    expect(response.status).toBe(200);
    const events = await readEvents(response);
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      {
        type: "not_found",
        closest: [
          {
            marker: 1,
            documentId: UUID,
            chunkId: 1,
            documentTitle: "Handbook",
            page: 4,
            snippet: "Notice is 30 days.",
          },
        ],
        usage: USAGE,
      },
    ]);
  });

  it("asks the model for the sentinel in the system prompt", async () => {
    await (await post({ question: "Q" })).text();
    const messages = llmStream.mock.calls[0][0] as { content: string }[];
    expect(messages[0].content).toContain("NOT_FOUND");
  });
});

describe("POST /api/ask: usage in the stream (Task 5.3)", () => {
  it("reports the questions left on done, from the spent unit", async () => {
    consumeUsage.mockResolvedValue({
      allowed: true,
      usedToday: 7,
      dailyLimit: 20,
      resetsAt: RESET,
    });
    const events = await readEvents(await post({ question: "Q" }));
    expect(events.at(-1)).toMatchObject({
      type: "done",
      usage: { remaining: 13, dailyLimit: 20, resetsAt: RESET },
    });
  });

  it("reports 0 left on the last allowed question", async () => {
    consumeUsage.mockResolvedValue({
      allowed: true,
      usedToday: 20,
      dailyLimit: 20,
      resetsAt: RESET,
    });
    const events = await readEvents(await post({ question: "Q" }));
    expect(events.at(-1)).toMatchObject({ usage: { remaining: 0 } });
  });
});

describe("POST /api/ask: pre-stream failures", () => {
  it("returns 503 when the embedding provider is unavailable, without leaking details", async () => {
    embed.mockRejectedValue(
      new ProviderUnavailableError(
        "Gemini request failed (HTTP 503) secret-detail",
        {
          provider: "gemini",
          status: 503,
        },
      ),
    );
    const response = await post({ question: "Q" });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "secret-detail",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 503 when match_chunks fails", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "08006", message: "db secret" },
    });
    const response = await post({ question: "Q" });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("db secret");
  });

  it("returns 500 for unexpected errors, without leaking details", async () => {
    embed.mockRejectedValue(new Error("internal secret"));
    const response = await post({ question: "Q" });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "internal_error" });
    expect(console.error).toHaveBeenCalled();
  });

  it("returns 500 when the embedding has the wrong dimension count", async () => {
    embed.mockResolvedValue([[0.1]]);
    expect((await post({ question: "Q" })).status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/ask: usage limits", () => {
  it("spends one question unit for the signed-in user before embedding or searching", async () => {
    await (await post({ question: "Q" })).text();
    expect(consumeUsage).toHaveBeenCalledTimes(1);
    expect(consumeUsage).toHaveBeenCalledWith("u1", "question");
    const spentAt = consumeUsage.mock.invocationCallOrder[0];
    expect(spentAt).toBeLessThan(embed.mock.invocationCallOrder[0]);
    expect(spentAt).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });

  it("does not refund a normal answer", async () => {
    await (await post({ question: "Q" })).text();
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it.each([
    ["user_limit", { scope: "user", reason: "user_limit" }],
    ["cooldown", { scope: "user", reason: "cooldown" }],
    ["global_limit", { scope: "global", reason: "global_limit" }],
    ["not_allowed", { scope: "global", reason: "global_limit" }],
  ])(
    "answers a one-frame limit event for %s, with no provider or search call",
    async (reason, expected) => {
      consumeUsage.mockResolvedValue({
        allowed: false,
        reason,
        usedToday: 20,
        dailyLimit: 20,
        resetsAt: RESET,
      });
      const response = await post({ question: "Q" });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(await readEvents(response)).toEqual([
        { type: "limit", ...expected, resetsAt: RESET },
      ]);
      expect(embed).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled(); // match_chunks
      expect(llmStream).not.toHaveBeenCalled();
      expect(refundUsage).not.toHaveBeenCalled();
    },
  );

  it("returns 401 for a user the limiter does not know, with no provider call", async () => {
    consumeUsage.mockResolvedValue({
      allowed: false,
      reason: "unknown_user",
      usedToday: 0,
      dailyLimit: 0,
      resetsAt: RESET,
    });
    const response = await post({ question: "Q" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(embed).not.toHaveBeenCalled();
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the limiter fails: no provider call, nothing to refund", async () => {
    consumeUsage.mockRejectedValue(
      new UsageCheckError("consume_usage failed: db secret"),
    );
    const response = await post({ question: "Q" });
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ error: "usage_unavailable" });
    expect(text).not.toContain("db secret");
    expect(embed).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(llmStream).not.toHaveBeenCalled();
    expect(refundUsage).not.toHaveBeenCalled();
  });
});

describe("POST /api/ask: refunds", () => {
  it("refunds when embedding fails with a provider error (503)", async () => {
    embed.mockRejectedValue(
      new ProviderUnavailableError("down", { provider: "gemini", status: 503 }),
    );
    expect((await post({ question: "Q" })).status).toBe(503);
    expect(refundUsage).toHaveBeenCalledTimes(1);
    expect(refundUsage).toHaveBeenCalledWith("u1", "question");
  });

  it("refunds when match_chunks fails (503)", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "08006", message: "x" },
    });
    expect((await post({ question: "Q" })).status).toBe(503);
    expect(refundUsage).toHaveBeenCalledTimes(1);
    expect(refundUsage).toHaveBeenCalledWith("u1", "question");
  });

  it("refunds on an unexpected error (500)", async () => {
    embed.mockRejectedValue(new Error("internal secret"));
    expect((await post({ question: "Q" })).status).toBe(500);
    expect(refundUsage).toHaveBeenCalledTimes(1);
  });

  it("does not refund a gate #1 not_found: the question used provider quota", async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW, similarity: 0.1 }], error: null });
    await readEvents(await post({ question: "Q" }));
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("does not refund a sentinel not_found", async () => {
    llmStream.mockImplementation(async function* () {
      yield { type: "text", text: "NOT_FOUND" };
      yield { type: "finish", reason: "stop" };
    });
    await readEvents(await post({ question: "Q" }));
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("refunds once when the LLM fails before the first token", async () => {
    llmStream.mockImplementation(async function* () {
      yield* [];
      throw new ProviderUnavailableError("down", { provider: "gemini" });
    });
    const events = await readEvents(await post({ question: "Q" }));
    // Task 5.5: the passages still come through, ahead of the error.
    expect(events.map((e) => e.type)).toEqual(["sources", "error"]);
    expect(events[0]).toMatchObject({
      type: "sources",
      sources: [{ marker: 1, documentTitle: "Handbook", page: 4 }],
    });
    expect(events[1]).toMatchObject({ type: "error", code: "llm_unavailable" });
    expect(refundUsage).toHaveBeenCalledTimes(1);
    expect(refundUsage).toHaveBeenCalledWith("u1", "question");
  });

  it("does not refund when the LLM fails after text was sent", async () => {
    llmStream.mockImplementation(async function* () {
      yield { type: "text", text: "Partial [1]" };
      throw new Error("boom");
    });
    const events = await readEvents(await post({ question: "Q" }));
    expect(events.map((e) => e.type)).toEqual(["sources", "token", "error"]);
    expect(refundUsage).not.toHaveBeenCalled();
  });
});
