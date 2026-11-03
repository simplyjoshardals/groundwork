import "server-only";

/** Public entry point for document ingestion (Task 1.6). Server-only. */

export {
  DEFAULT_BATCH_DELAY_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_RETRY_WAIT_MS,
  DEFAULT_RETRY_WAITS_MS,
  classifyFailure,
  ingestDocument,
} from "./ingest-document";
export type { IngestDeps, IngestOptions } from "./ingest-document";
export {
  DOCUMENTS_BUCKET,
  createSupabaseIngestStore,
  toVectorLiteral,
} from "./supabase-store";
export { ClaimLostError, IngestStoreError } from "./types";
export type {
  IngestChunkRow,
  IngestDocumentRecord,
  IngestFailureReason,
  IngestOutcome,
  IngestStore,
} from "./types";
