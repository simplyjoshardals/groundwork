import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ingestDocument } from "@/features/ingestion/ingest-document";
import { IngestStoreError, type IngestStore } from "@/features/ingestion/types";
import type { EmbeddingProvider } from "@/lib/providers";

const ID = "123e4567-e89b-42d3-a456-426614174000";

/**
 * Task 4.7: the user deletes a document while it is `processing`. The next batch
 * write fails (`chunks_before_insert` raises document_not_found), which must end
 * as a `failed` outcome, not a throw, and must never reach `finalize`.
 */
describe("ingestDocument when the document is deleted mid-run", () => {
  it("returns failed/internal_error, records it, and never finalizes", async () => {
    const text = "Deleted while processing. ".repeat(200);
    const store: IngestStore = {
      getDocument: vi.fn(async () => ({
        id: ID,
        mimeType: "text/plain",
        storagePath: "u1/d/a.txt",
      })),
      claim: vi.fn(async () => true),
      download: vi.fn(async () => new TextEncoder().encode(text)),
      insertChunks: vi.fn(async () => {
        throw new IngestStoreError("insert chunks", "document_not_found");
      }),
      finalize: vi.fn(),
      fail: vi.fn(async () => undefined),
    };
    const embedder: EmbeddingProvider = {
      model: "test-model",
      dimensions: 3,
      embed: vi.fn(async (texts: readonly string[]) => texts.map(() => [0.1, 0.2, 0.3])),
    };

    const outcome = await ingestDocument(ID, {
      store,
      embedder,
      options: { sleep: async () => undefined },
    });

    expect(outcome).toMatchObject({ status: "failed", reason: "internal_error" });
    expect(store.fail).toHaveBeenCalledWith(ID, "internal_error");
    expect(store.finalize).not.toHaveBeenCalled();
  });
});
