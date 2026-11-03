/**
 * Types shared by the ingestion flow and its store (Task 1.6).
 *
 * `IngestStore` is the only thing `ingestDocument` knows about persistence, so
 * the flow can be tested without a database and the Supabase details stay in
 * `supabase-store.ts`. Nothing here carries `server-only` because it holds no
 * runtime behaviour beyond two error classes.
 */

import type { ExtractionErrorCode } from "@/lib/pdf";

/**
 * Values of `documents.error_reason` that ingestion can write. The extraction
 * codes are already a subset of the column's vocabulary (see lib/pdf/errors.ts);
 * `provider_unavailable` is the one ingestion adds.
 */
export type IngestFailureReason = ExtractionErrorCode | "provider_unavailable";

/** The columns ingestion needs to know about a document. */
export interface IngestDocumentRecord {
  id: string;
  mimeType: string;
  storagePath: string;
}

/** One chunk ready to store, with its vector. Offsets are the chunker's, unchanged. */
export interface IngestChunkRow {
  chunkIndex: number;
  pageNumber: number;
  /** UTF-16 offset into the normalized page text, inclusive. */
  charStart: number;
  /** UTF-16 offset into the normalized page text, exclusive. */
  charEnd: number;
  content: string;
  embedding: readonly number[];
  embeddingModel: string;
}

export interface IngestStore {
  /** Returns null when no such document exists. */
  getDocument(documentId: string): Promise<IngestDocumentRecord | null>;
  /**
   * Atomically moves the document to `processing` and clears old chunks.
   * Returns false when someone else holds it or it is already `ready`.
   */
  claim(documentId: string): Promise<boolean>;
  download(storagePath: string): Promise<Uint8Array>;
  /** Must be idempotent per `(documentId, chunkIndex)`: a repeated batch must not duplicate rows. */
  insertChunks(
    documentId: string,
    rows: readonly IngestChunkRow[],
  ): Promise<void>;
  /**
   * Flips the document to `ready` after verifying the stored chunks.
   * Throws `ClaimLostError` when the document is no longer `processing`.
   */
  finalize(
    documentId: string,
    input: {
      pageCount: number;
      embeddingModel: string;
      pipelineVersion: number;
    },
  ): Promise<void>;
  /** Deletes partial chunks and records the failure on the document. */
  fail(documentId: string, reason: IngestFailureReason): Promise<void>;
}

export type IngestOutcome =
  | { status: "ready"; pageCount: number; chunkCount: number }
  /** The document is now `failed` with `reason`; `error` is the underlying cause, for logs. */
  | { status: "failed"; reason: IngestFailureReason; error: unknown }
  /** Already `ready`, or another run holds it. Nothing was changed. */
  | { status: "not_claimed" }
  | { status: "not_found" }
  /**
   * The document stopped being `processing` before we could finalize it (for
   * example it was re-claimed after the stale timeout). Nothing more was
   * written; the other run owns the document now.
   */
  | { status: "claim_lost" };

/** The store reports that this run no longer owns the document. */
export class ClaimLostError extends Error {
  constructor() {
    super("The document is no longer being processed by this run.");
    this.name = "ClaimLostError";
  }
}

/** A database or storage call failed. The message names the operation, never document content. */
export class IngestStoreError extends Error {
  constructor(
    readonly operation: string,
    detail: string,
  ) {
    super(`${operation} failed: ${detail}`);
    this.name = "IngestStoreError";
  }
}
