import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ingestDocument } = vi.hoisted(() => ({ ingestDocument: vi.fn() }));
vi.mock("@/features/ingestion/ingest-document", () => ({ ingestDocument }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: vi.fn() }));
vi.mock("@/lib/providers", () => ({ createGeminiEmbeddingProvider: vi.fn() }));

import { ingestOwnedDocument } from "@/features/ingestion/ingest-owned-document";
import { IngestStoreError, type IngestStore } from "@/features/ingestion/types";
import type { Database } from "@/types/database";
import type { EmbeddingProvider } from "@/lib/providers";

const ID = "123e4567-e89b-42d3-a456-426614174000";

function fakeClient(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const eq = vi.fn();
  const chain = { select: vi.fn(), eq, maybeSingle: vi.fn(async () => result) };
  chain.select.mockReturnValue(chain);
  eq.mockReturnValue(chain);
  const from = vi.fn(() => chain);
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    eq,
  };
}

const store = {} as IngestStore;
const embedder = {
  model: "m",
  dimensions: 3,
  embed: vi.fn(),
} as EmbeddingProvider;

afterEach(() => vi.clearAllMocks());

describe("ingestOwnedDocument", () => {
  it("looks the document up as the user with explicit owner and private filters", async () => {
    const { client, from, eq } = fakeClient({ data: { id: ID }, error: null });
    ingestDocument.mockResolvedValue({ status: "not_claimed" });
    await ingestOwnedDocument(
      { supabase: client, userId: "u1", documentId: ID },
      { createStore: () => store, createEmbedder: () => embedder },
    );
    expect(from).toHaveBeenCalledWith("documents");
    expect(eq.mock.calls).toEqual([
      ["id", ID],
      ["owner_id", "u1"],
      ["is_public", false],
    ]);
  });

  it("returns not_found without building anything or ingesting when it is not owned", async () => {
    const { client } = fakeClient({ data: null, error: null });
    const createStore = vi.fn(() => store);
    const createEmbedder = vi.fn(() => embedder);
    const outcome = await ingestOwnedDocument(
      { supabase: client, userId: "u1", documentId: ID },
      { createStore, createEmbedder },
    );
    expect(outcome).toEqual({ status: "not_found" });
    expect(createStore).not.toHaveBeenCalled();
    expect(createEmbedder).not.toHaveBeenCalled();
    expect(ingestDocument).not.toHaveBeenCalled();
  });

  it("throws IngestStoreError when the ownership lookup fails", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    await expect(
      ingestOwnedDocument(
        { supabase: client, userId: "u1", documentId: ID },
        { createStore: () => store, createEmbedder: () => embedder },
      ),
    ).rejects.toBeInstanceOf(IngestStoreError);
    expect(ingestDocument).not.toHaveBeenCalled();
  });

  it("builds the embedder before the store, then returns the outcome unchanged", async () => {
    const { client } = fakeClient({ data: { id: ID }, error: null });
    const order: string[] = [];
    const outcome = { status: "ready", pageCount: 2, chunkCount: 5 };
    ingestDocument.mockImplementation(async () => {
      order.push("ingest");
      return outcome;
    });
    const result = await ingestOwnedDocument(
      { supabase: client, userId: "u1", documentId: ID },
      {
        createEmbedder: () => (order.push("embedder"), embedder),
        createStore: () => (order.push("store"), store),
      },
    );
    expect(order).toEqual(["embedder", "store", "ingest"]);
    expect(ingestDocument).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ store, embedder }),
    );
    expect(result).toBe(outcome);
  });

  it("does not claim anything when the embedder cannot be built", async () => {
    const { client } = fakeClient({ data: { id: ID }, error: null });
    const createStore = vi.fn(() => store);
    await expect(
      ingestOwnedDocument(
        { supabase: client, userId: "u1", documentId: ID },
        {
          createEmbedder: () => {
            throw new Error("missing GEMINI_API_KEY");
          },
          createStore,
        },
      ),
    ).rejects.toThrow("missing GEMINI_API_KEY");
    expect(createStore).not.toHaveBeenCalled();
    expect(ingestDocument).not.toHaveBeenCalled();
  });
});
