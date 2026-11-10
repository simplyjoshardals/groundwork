import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ingestDocument, consumeUsage, refundUsage } = vi.hoisted(() => ({
  ingestDocument: vi.fn(),
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
vi.mock("@/features/ingestion/ingest-document", () => ({ ingestDocument }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: vi.fn() }));
vi.mock("@/lib/providers", () => ({ createGeminiEmbeddingProvider: vi.fn() }));

import { ingestOwnedDocument } from "@/features/ingestion/ingest-owned-document";
import { IngestStoreError, type IngestStore } from "@/features/ingestion/types";
import { UsageCheckError } from "@/features/limits/types";
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

const RESET = "2026-11-10T00:00:00.000Z";

beforeEach(() => {
  consumeUsage.mockResolvedValue({
    allowed: true,
    usedToday: 1,
    dailyLimit: 10,
    resetsAt: RESET,
  });
  refundUsage.mockResolvedValue(undefined);
});
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

describe("ingestOwnedDocument: usage limits (Task 5.2)", () => {
  const owned = () => fakeClient({ data: { id: ID }, error: null }).client;
  const run = (
    client: SupabaseClient<Database>,
    deps: Parameters<typeof ingestOwnedDocument>[1] = {},
  ) =>
    ingestOwnedDocument(
      { supabase: client, userId: "u1", documentId: ID },
      { createStore: () => store, createEmbedder: () => embedder, ...deps },
    );

  it("spends one ingest unit after the embedder is built and before the store or ingestion", async () => {
    const order: string[] = [];
    consumeUsage.mockImplementation(async () => {
      order.push("consume");
      return { allowed: true, usedToday: 1, dailyLimit: 10, resetsAt: RESET };
    });
    ingestDocument.mockImplementation(async () => {
      order.push("ingest");
      return { status: "ready", pageCount: 1, chunkCount: 1 };
    });
    await run(owned(), {
      createEmbedder: () => (order.push("embedder"), embedder),
      createStore: () => (order.push("store"), store),
    });
    expect(order).toEqual(["embedder", "consume", "store", "ingest"]);
    expect(consumeUsage).toHaveBeenCalledWith("u1", "ingest");
  });

  it("spends nothing for a document the caller does not own", async () => {
    const { client } = fakeClient({ data: null, error: null });
    await run(client);
    expect(consumeUsage).not.toHaveBeenCalled();
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("spends nothing when the ownership lookup fails", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    await expect(run(client)).rejects.toBeInstanceOf(IngestStoreError);
    expect(consumeUsage).not.toHaveBeenCalled();
  });

  it("spends nothing when the embedder cannot be built", async () => {
    await expect(
      run(owned(), {
        createEmbedder: () => {
          throw new Error("missing GEMINI_API_KEY");
        },
      }),
    ).rejects.toThrow("missing GEMINI_API_KEY");
    expect(consumeUsage).not.toHaveBeenCalled();
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it.each([
    ["user_limit", "user_limit"],
    ["cooldown", "cooldown"],
    ["global_limit", "global_limit"],
    ["not_allowed", "global_limit"],
  ])(
    "returns a limit outcome for %s without building the store or ingesting",
    async (reason, expected) => {
      consumeUsage.mockResolvedValue({
        allowed: false,
        reason,
        usedToday: 10,
        dailyLimit: 10,
        resetsAt: RESET,
      });
      const createStore = vi.fn(() => store);
      expect(await run(owned(), { createStore })).toEqual({
        status: "limit",
        reason: expected,
        resetsAt: RESET,
      });
      expect(createStore).not.toHaveBeenCalled();
      expect(ingestDocument).not.toHaveBeenCalled();
      expect(refundUsage).not.toHaveBeenCalled();
    },
  );

  it("throws for unknown_user: the ownership check already proved the user exists", async () => {
    consumeUsage.mockResolvedValue({
      allowed: false,
      reason: "unknown_user",
      usedToday: 0,
      dailyLimit: 0,
      resetsAt: RESET,
    });
    await expect(run(owned())).rejects.toBeInstanceOf(UsageCheckError);
    expect(ingestDocument).not.toHaveBeenCalled();
  });

  it("fails closed when the limiter fails: nothing is built or ingested, nothing to refund", async () => {
    consumeUsage.mockRejectedValue(new UsageCheckError("consume_usage failed"));
    const createStore = vi.fn(() => store);
    await expect(run(owned(), { createStore })).rejects.toBeInstanceOf(
      UsageCheckError,
    );
    expect(createStore).not.toHaveBeenCalled();
    expect(ingestDocument).not.toHaveBeenCalled();
    expect(refundUsage).not.toHaveBeenCalled();
  });

  describe("refunds", () => {
    it.each([
      ["ready", { status: "ready", pageCount: 2, chunkCount: 5 }, false],
      ["not_claimed", { status: "not_claimed" }, true],
      ["claim_lost", { status: "claim_lost" }, true],
      ["not_found", { status: "not_found" }, true],
      ["failed: provider_unavailable", { status: "failed", reason: "provider_unavailable", error: new Error("x") }, true],
      ["failed: internal_error", { status: "failed", reason: "internal_error", error: new Error("x") }, true],
      // A problem with the user's file keeps the unit spent.
      ["failed: scanned_pdf", { status: "failed", reason: "scanned_pdf", error: new Error("x") }, false],
      ["failed: too_many_pages", { status: "failed", reason: "too_many_pages", error: new Error("x") }, false],
      ["failed: corrupt_file", { status: "failed", reason: "corrupt_file", error: new Error("x") }, false],
    ])("%s", async (_label, outcome, refunded) => {
      ingestDocument.mockResolvedValue(outcome);
      expect(await run(owned())).toBe(outcome);
      if (refunded) {
        expect(refundUsage).toHaveBeenCalledTimes(1);
        expect(refundUsage).toHaveBeenCalledWith("u1", "ingest");
      } else {
        expect(refundUsage).not.toHaveBeenCalled();
      }
    });

    it("refunds and rethrows when ingestDocument throws", async () => {
      const failure = new Error("could not record failure");
      ingestDocument.mockRejectedValue(failure);
      await expect(run(owned())).rejects.toBe(failure);
      expect(refundUsage).toHaveBeenCalledTimes(1);
      expect(refundUsage).toHaveBeenCalledWith("u1", "ingest");
    });

    it("refunds and rethrows when the store cannot be built", async () => {
      const failure = new Error("missing service key");
      await expect(
        run(owned(), {
          createStore: () => {
            throw failure;
          },
        }),
      ).rejects.toBe(failure);
      expect(refundUsage).toHaveBeenCalledTimes(1);
      expect(ingestDocument).not.toHaveBeenCalled();
    });
  });
});
