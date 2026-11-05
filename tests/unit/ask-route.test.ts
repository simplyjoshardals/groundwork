import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getClaims = vi.fn();
const rpc = vi.fn();
const embed = vi.fn();
const llmStream = vi.fn();

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
  createGeminiLlmProvider: () => ({ model: "llm-model", stream: llmStream }),
}));

import * as route from "@/app/api/ask/route";
import { REFUSAL_SIMILARITY_THRESHOLD } from "@/lib/config";
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
  });
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
            documentTitle: "Handbook",
            page: 4,
            snippet: "Notice is 30 days.",
          },
        ],
      },
      { type: "token", text: "30 days [1]" },
      { type: "done", citations: [], invalidCitations: [] },
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
            documentTitle: "Handbook",
            page: 4,
            snippet: "Notice is 30 days.",
          },
        ],
      },
    ]);
  });

  it("answers not_found without `closest` when nothing was retrieved", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const events = await readEvents(await post({ question: "Q" }));
    expect(llmStream).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "not_found" }]);
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
