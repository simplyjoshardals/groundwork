import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MATCH_COUNT,
  SearchFailedError,
  retrieveChunks,
} from "@/features/qa";
import type { EmbeddingProvider } from "@/lib/providers/types";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));

const DIMENSIONS = 3;
const DOC_ID = "5a000000-0000-4000-8000-000000000001";

function fakeEmbedder(
  vectors: number[][] = [[0.1, 0.2, 0.3]],
): EmbeddingProvider & { calls: { texts: readonly string[]; role: string }[] } {
  const calls: { texts: readonly string[]; role: string }[] = [];
  return {
    model: "test-model",
    dimensions: DIMENSIONS,
    calls,
    embed: async (texts, role) => {
      calls.push({ texts, role });
      return vectors;
    },
  };
}

function fakeSupabase(reply: {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: null, error: null, ...reply };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, rpcCalls };
}

const ROW = {
  chunk_id: 1,
  doc_id: DOC_ID,
  doc_title: "Doc",
  page_number: 2,
  char_start: 0,
  char_end: 10,
  content: "text",
  similarity: 0.9,
};

describe("retrieveChunks", () => {
  it("embeds the question as a query and calls match_chunks with the default count", async () => {
    const embedder = fakeEmbedder();
    const { client, rpcCalls } = fakeSupabase({ data: [ROW] });

    const rows = await retrieveChunks({
      supabase: client,
      embedder,
      question: "How many days?",
    });

    expect(rows).toEqual([ROW]);
    expect(embedder.calls).toEqual([
      { texts: ["How many days?"], role: "query" },
    ]);
    expect(rpcCalls).toEqual([
      {
        fn: "match_chunks",
        args: {
          query_embedding: "[0.1,0.2,0.3]",
          p_embedding_model: "test-model",
          match_count: DEFAULT_MATCH_COUNT,
        },
      },
    ]);
    expect(DEFAULT_MATCH_COUNT).toBe(6);
  });

  it("passes a document filter and a custom count only when given", async () => {
    const { client, rpcCalls } = fakeSupabase({ data: [] });
    await retrieveChunks({
      supabase: client,
      embedder: fakeEmbedder(),
      question: "q",
      documentId: DOC_ID,
      matchCount: 3,
    });
    expect(rpcCalls[0]?.args).toMatchObject({
      match_count: 3,
      p_document_id: DOC_ID,
    });
  });

  it("returns an empty list when the database returns null data", async () => {
    const { client } = fakeSupabase({ data: null });
    await expect(
      retrieveChunks({
        supabase: client,
        embedder: fakeEmbedder(),
        question: "q",
      }),
    ).resolves.toEqual([]);
  });

  it("throws SearchFailedError with the code and message when the search fails", async () => {
    const { client } = fakeSupabase({
      error: { code: "42501", message: "denied" },
    });
    const failure = retrieveChunks({
      supabase: client,
      embedder: fakeEmbedder(),
      question: "q",
    });
    await expect(failure).rejects.toBeInstanceOf(SearchFailedError);
    await expect(failure).rejects.toThrow("match_chunks failed: 42501: denied");
  });

  it.each([
    ["no vector", []],
    ["a vector of the wrong length", [[0.1, 0.2]]],
  ])(
    "rejects an embedding with %s without searching",
    async (_name, vectors) => {
      const { client, rpcCalls } = fakeSupabase({ data: [] });
      await expect(
        retrieveChunks({
          supabase: client,
          embedder: fakeEmbedder(vectors),
          question: "q",
        }),
      ).rejects.toThrow("unexpected shape");
      expect(rpcCalls).toHaveLength(0);
    },
  );
});
