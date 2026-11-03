import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  ClaimLostError,
  IngestStoreError,
  createSupabaseIngestStore,
  toVectorLiteral,
} from "@/features/ingestion";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));

const DOC_ID = "5a000000-0000-4000-8000-000000000099";

interface PgError {
  message: string;
}
interface Reply {
  data?: unknown;
  error?: PgError | null;
}

/** A just-enough fake of the supabase-js calls the store uses. Records what it was asked. */
function createFakeClient(replies: {
  rpc?: Reply;
  upsert?: Reply;
  select?: Reply;
  download?: Reply;
}) {
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const upserts: { rows: unknown; options: unknown }[] = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return { data: null, error: null, ...replies.rpc };
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: null,
            ...replies.select,
          }),
        }),
      }),
      upsert: async (rows: unknown, options: unknown) => {
        expect(table).toBe("chunks");
        upserts.push({ rows, options });
        return { error: null, ...replies.upsert };
      },
    }),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          expect([bucket, path]).toEqual(["documents", "samples/a.md"]);
          return { data: null, error: null, ...replies.download };
        },
      }),
    },
  } as unknown as SupabaseClient<Database>;
  return { client, rpcCalls, upserts };
}

describe("toVectorLiteral", () => {
  it("uses pgvector's text format", () => {
    expect(toVectorLiteral([0.5, -1, 2e-7])).toBe("[0.5,-1,2e-7]");
  });
});

describe("createSupabaseIngestStore", () => {
  it("maps a documents row to the ingest record, or null", async () => {
    const found = createFakeClient({
      select: {
        data: {
          id: DOC_ID,
          mime_type: "text/markdown",
          storage_path: "samples/a.md",
        },
      },
    });
    expect(
      await createSupabaseIngestStore(found.client).getDocument(DOC_ID),
    ).toEqual({
      id: DOC_ID,
      mimeType: "text/markdown",
      storagePath: "samples/a.md",
    });
    const missing = createFakeClient({});
    expect(
      await createSupabaseIngestStore(missing.client).getDocument(DOC_ID),
    ).toBeNull();
  });

  it("throws IngestStoreError when loading fails", async () => {
    const { client } = createFakeClient({
      select: { error: { message: "boom" } },
    });
    await expect(
      createSupabaseIngestStore(client).getDocument(DOC_ID),
    ).rejects.toThrow(IngestStoreError);
  });

  it("claims through claim_document_for_ingest and returns its boolean", async () => {
    const { client, rpcCalls } = createFakeClient({ rpc: { data: true } });
    expect(await createSupabaseIngestStore(client).claim(DOC_ID)).toBe(true);
    expect(rpcCalls).toEqual([
      { fn: "claim_document_for_ingest", args: { p_document_id: DOC_ID } },
    ]);
  });

  it("rejects a claim response that is not a boolean", async () => {
    const { client } = createFakeClient({ rpc: { data: "yes" } });
    await expect(
      createSupabaseIngestStore(client).claim(DOC_ID),
    ).rejects.toThrow(IngestStoreError);
  });

  it("upserts snake_case rows on (document_id, chunk_index) with a vector literal", async () => {
    const { client, upserts } = createFakeClient({});
    await createSupabaseIngestStore(client).insertChunks(DOC_ID, [
      {
        chunkIndex: 3,
        pageNumber: 2,
        charStart: 10,
        charEnd: 40,
        content: "hello",
        embedding: [0.25, 0.5],
        embeddingModel: "m",
      },
    ]);
    expect(upserts).toEqual([
      {
        rows: [
          {
            document_id: DOC_ID,
            chunk_index: 3,
            page_number: 2,
            char_start: 10,
            char_end: 40,
            content: "hello",
            embedding: "[0.25,0.5]",
            embedding_model: "m",
          },
        ],
        options: { onConflict: "document_id,chunk_index" },
      },
    ]);
  });

  it("does nothing for an empty batch and reports insert errors", async () => {
    const empty = createFakeClient({});
    await createSupabaseIngestStore(empty.client).insertChunks(DOC_ID, []);
    expect(empty.upserts).toEqual([]);

    const failing = createFakeClient({
      upsert: { error: { message: "constraint" } },
    });
    await expect(
      createSupabaseIngestStore(failing.client).insertChunks(DOC_ID, [
        {
          chunkIndex: 0,
          pageNumber: 1,
          charStart: 0,
          charEnd: 1,
          content: "x",
          embedding: [1],
          embeddingModel: "m",
        },
      ]),
    ).rejects.toThrow(IngestStoreError);
  });

  it("finalizes with the documented argument names", async () => {
    const { client, rpcCalls } = createFakeClient({});
    await createSupabaseIngestStore(client).finalize(DOC_ID, {
      pageCount: 10,
      embeddingModel: "m",
      pipelineVersion: 1,
    });
    expect(rpcCalls).toEqual([
      {
        fn: "finalize_ingestion",
        args: {
          p_document_id: DOC_ID,
          p_page_count: 10,
          p_embedding_model: "m",
          p_pipeline_version: 1,
        },
      },
    ]);
  });

  it("turns document_not_processing into ClaimLostError and other errors into IngestStoreError", async () => {
    const lost = createFakeClient({
      rpc: { error: { message: "document_not_processing" } },
    });
    await expect(
      createSupabaseIngestStore(lost.client).finalize(DOC_ID, {
        pageCount: 1,
        embeddingModel: "m",
        pipelineVersion: 1,
      }),
    ).rejects.toThrow(ClaimLostError);

    const other = createFakeClient({
      rpc: { error: { message: "no_chunks_written" } },
    });
    await expect(
      createSupabaseIngestStore(other.client).finalize(DOC_ID, {
        pageCount: 1,
        embeddingModel: "m",
        pipelineVersion: 1,
      }),
    ).rejects.toThrow(IngestStoreError);
  });

  it("records a failure through fail_ingestion", async () => {
    const { client, rpcCalls } = createFakeClient({});
    await createSupabaseIngestStore(client).fail(DOC_ID, "scanned_pdf");
    expect(rpcCalls).toEqual([
      {
        fn: "fail_ingestion",
        args: { p_document_id: DOC_ID, p_reason: "scanned_pdf" },
      },
    ]);
  });

  it("downloads a file as bytes and reports download errors", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const ok = createFakeClient({ download: { data: blob } });
    expect(
      await createSupabaseIngestStore(ok.client).download("samples/a.md"),
    ).toEqual(new Uint8Array([1, 2, 3]));

    const bad = createFakeClient({
      download: { error: { message: "Object not found" } },
    });
    await expect(
      createSupabaseIngestStore(bad.client).download("samples/a.md"),
    ).rejects.toThrow(IngestStoreError);
  });
});
