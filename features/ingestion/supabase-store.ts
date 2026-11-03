import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  ClaimLostError,
  IngestStoreError,
  type IngestChunkRow,
  type IngestDocumentRecord,
  type IngestFailureReason,
  type IngestStore,
} from "./types";

/** Storage bucket created by migration 0007 (DATA_MODEL 2.7). */
export const DOCUMENTS_BUCKET = "documents";

/** pgvector's text input format, which PostgREST accepts for a `vector` column. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * `IngestStore` backed by Supabase. The client MUST be the service-role
 * (admin) client: only that role may call the ingestion functions and write
 * chunks. It is passed in, never created here, so credentials stay with the
 * caller (Task 1.7 adds the shared admin client).
 */
export function createSupabaseIngestStore(
  client: SupabaseClient<Database>,
  options: { bucket?: string } = {},
): IngestStore {
  const bucket = options.bucket ?? DOCUMENTS_BUCKET;

  return {
    async getDocument(documentId): Promise<IngestDocumentRecord | null> {
      const { data, error } = await client
        .from("documents")
        .select("id, mime_type, storage_path")
        .eq("id", documentId)
        .maybeSingle();
      if (error) throw new IngestStoreError("load document", error.message);
      if (data === null) return null;
      return {
        id: data.id,
        mimeType: data.mime_type,
        storagePath: data.storage_path,
      };
    },

    async claim(documentId) {
      const { data, error } = await client.rpc("claim_document_for_ingest", {
        p_document_id: documentId,
      });
      if (error) throw new IngestStoreError("claim document", error.message);
      if (typeof data !== "boolean") {
        throw new IngestStoreError(
          "claim document",
          "unexpected response from claim_document_for_ingest",
        );
      }
      return data;
    },

    async download(storagePath) {
      const { data, error } = await client.storage
        .from(bucket)
        .download(storagePath);
      if (error) throw new IngestStoreError("download file", error.message);
      return new Uint8Array(await data.arrayBuffer());
    },

    async insertChunks(documentId, rows: readonly IngestChunkRow[]) {
      if (rows.length === 0) return;
      // Upsert on the unique key, so a repeated batch overwrites instead of duplicating.
      // owner_id and is_public are filled in by the chunks_bi_copy_owner trigger.
      const { error } = await client.from("chunks").upsert(
        rows.map((row) => ({
          document_id: documentId,
          chunk_index: row.chunkIndex,
          page_number: row.pageNumber,
          char_start: row.charStart,
          char_end: row.charEnd,
          content: row.content,
          embedding: toVectorLiteral(row.embedding),
          embedding_model: row.embeddingModel,
        })),
        { onConflict: "document_id,chunk_index" },
      );
      if (error) throw new IngestStoreError("insert chunks", error.message);
    },

    async finalize(documentId, input) {
      const { error } = await client.rpc("finalize_ingestion", {
        p_document_id: documentId,
        p_page_count: input.pageCount,
        p_embedding_model: input.embeddingModel,
        p_pipeline_version: input.pipelineVersion,
      });
      if (error) {
        // Raised by finalize_ingestion when the row is no longer 'processing'.
        if (error.message.includes("document_not_processing")) {
          throw new ClaimLostError();
        }
        throw new IngestStoreError("finalize ingestion", error.message);
      }
    },

    async fail(documentId, reason: IngestFailureReason) {
      const { error } = await client.rpc("fail_ingestion", {
        p_document_id: documentId,
        p_reason: reason,
      });
      if (error) throw new IngestStoreError("record failure", error.message);
    },
  };
}
