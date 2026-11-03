import "server-only";
import { PIPELINE_VERSION, chunkPages, type Chunk } from "@/lib/chunking";
import { EmptyDocumentError, ExtractionError, extractPages } from "@/lib/pdf";
import {
  MAX_EMBED_TEXTS_PER_CALL,
  ProviderUnavailableError,
  RateLimitError,
  type EmbeddingProvider,
} from "@/lib/providers";
import {
  ClaimLostError,
  type IngestChunkRow,
  type IngestFailureReason,
  type IngestOutcome,
  type IngestStore,
} from "./types";

/**
 * Pacing and retry defaults.
 *
 * Provisional, taken from the Task 0.5 spike (docs/spikes/provider.md 5.1 to 5.7):
 * batches of 10 with a 10 s pause avoided the 429s that unpaced batches of 20 hit.
 * The quota behind those 429s was never identified (it looks like a per-minute
 * limit), so a 429 that survives the adapter's own short retries is retried here
 * with longer waits that can span a minute window. Not tuned against a real 429.
 */
export const DEFAULT_BATCH_SIZE = 10;
export const DEFAULT_BATCH_DELAY_MS = 10_000;
export const DEFAULT_RETRY_WAITS_MS: readonly number[] = [15_000, 30_000];
/** Longest single wait. A provider hint above this means "not soon": give up instead. */
export const DEFAULT_MAX_RETRY_WAIT_MS = 65_000;

export interface IngestOptions {
  /** Texts per embedding call, 1 to 100. Default 10. */
  batchSize?: number;
  /** Pause between embedding batches (not after the last one). Default 10 s. */
  batchDelayMs?: number;
  /**
   * Waits before each retry of a rate-limited or unavailable embedding call.
   * The number of retries is its length. Default 15 s then 30 s.
   */
  retryWaitsMs?: readonly number[];
  /** Largest wait we will honour, including a provider's `retryAfterMs`. Default 65 s. */
  maxRetryWaitMs?: number;
  /** Replaceable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Progress lines. Never receives document text, vectors or credentials. */
  log?: (message: string) => void;
}

export interface IngestDeps {
  store: IngestStore;
  embedder: EmbeddingProvider;
  options?: IngestOptions;
}

interface ResolvedOptions {
  batchSize: number;
  batchDelayMs: number;
  retryWaitsMs: readonly number[];
  maxRetryWaitMs: number;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function resolveOptions(options: IngestOptions = {}): ResolvedOptions {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const batchDelayMs = options.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS;
  const retryWaitsMs = options.retryWaitsMs ?? DEFAULT_RETRY_WAITS_MS;
  const maxRetryWaitMs = options.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS;

  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_EMBED_TEXTS_PER_CALL
  ) {
    throw new RangeError(
      `batchSize must be an integer from 1 to ${MAX_EMBED_TEXTS_PER_CALL}`,
    );
  }
  const nonNegative = (value: number): boolean =>
    Number.isFinite(value) && value >= 0;
  if (!nonNegative(batchDelayMs)) {
    throw new RangeError("batchDelayMs must be a non-negative number");
  }
  if (!nonNegative(maxRetryWaitMs)) {
    throw new RangeError("maxRetryWaitMs must be a non-negative number");
  }
  if (!retryWaitsMs.every(nonNegative)) {
    throw new RangeError("retryWaitsMs must contain non-negative numbers");
  }
  return {
    batchSize,
    batchDelayMs,
    retryWaitsMs,
    maxRetryWaitMs,
    sleep: options.sleep ?? defaultSleep,
    log: options.log ?? (() => undefined),
  };
}

function isRetryable(
  error: unknown,
): error is RateLimitError | ProviderUnavailableError {
  return (
    error instanceof RateLimitError || error instanceof ProviderUnavailableError
  );
}

/**
 * Embeds one batch, retrying rate limits and provider outages with growing
 * waits. A provider hint (`retryAfterMs`) can lengthen a wait but never shorten
 * it. A hint longer than the cap means the provider asked for more than we are
 * willing to wait, so the error is rethrown instead of sleeping.
 */
async function embedBatchWithRetry(
  embedder: EmbeddingProvider,
  texts: readonly string[],
  opts: ResolvedOptions,
  label: string,
): Promise<number[][]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await embedder.embed(texts, "document");
    } catch (error) {
      if (!isRetryable(error) || attempt >= opts.retryWaitsMs.length) {
        throw error;
      }
      const hinted = error.retryAfterMs ?? 0;
      if (hinted > opts.maxRetryWaitMs) throw error;
      const wait = Math.min(
        Math.max(opts.retryWaitsMs[attempt], hinted),
        opts.maxRetryWaitMs,
      );
      opts.log(
        `${label}: ${error.name}${error.status === null ? "" : ` (HTTP ${error.status})`}; ` +
          `retry ${attempt + 1} of ${opts.retryWaitsMs.length} in ${Math.round(wait / 1000)} s`,
      );
      await opts.sleep(wait);
    }
  }
}

/** Checks the provider's answer before anything is written. */
function assertVectors(
  vectors: readonly (readonly number[])[],
  expectedCount: number,
  dimensions: number,
): void {
  if (vectors.length !== expectedCount) {
    throw new Error(
      `embedding provider returned ${vectors.length} vectors for ${expectedCount} texts`,
    );
  }
  for (const vector of vectors) {
    if (
      vector.length !== dimensions ||
      !vector.every((value) => Number.isFinite(value))
    ) {
      throw new Error("embedding provider returned an invalid vector");
    }
  }
}

/** Maps any failure to the `documents.error_reason` value stored with it. */
export function classifyFailure(error: unknown): IngestFailureReason {
  if (error instanceof ExtractionError) return error.code;
  if (
    error instanceof RateLimitError ||
    error instanceof ProviderUnavailableError
  ) {
    return "provider_unavailable";
  }
  // BadRequestError (including a bad API key), storage or database errors and
  // anything unexpected are our fault or configuration, not the user's file.
  return "internal_error";
}

function toRows(
  chunks: readonly Chunk[],
  vectors: readonly (readonly number[])[],
  model: string,
): IngestChunkRow[] {
  return chunks.map((chunk, index) => ({
    chunkIndex: chunk.chunkIndex,
    pageNumber: chunk.pageNumber,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    content: chunk.content,
    embedding: vectors[index],
    embeddingModel: model,
  }));
}

/**
 * Ingests one document: claim, download, extract, chunk, embed in paced
 * batches, store each batch, then finalize (DATA_MODEL 2.6).
 *
 * - Chunks are invisible to search until `finalize` verifies them and flips the
 *   document to `ready`, so a crash leaves a harmless `processing` row that is
 *   re-claimed (and its chunks wiped) after the stale timeout.
 * - Any failure after the claim calls `fail`, which deletes partial chunks and
 *   records a `documents.error_reason`, and returns a `failed` outcome instead
 *   of throwing. Failed documents can be claimed again.
 * - Offsets are stored exactly as `chunkPages` produced them.
 *
 * Returns an outcome for every expected result. Throws only for invalid
 * arguments (before anything is touched) and when the failure itself cannot be
 * recorded, in which case the document stays `processing` until it goes stale.
 */
export async function ingestDocument(
  documentId: string,
  deps: IngestDeps,
): Promise<IngestOutcome> {
  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) {
    throw new TypeError("documentId must be a UUID string");
  }
  const { store, embedder } = deps;
  const opts = resolveOptions(deps.options);

  const document = await store.getDocument(documentId);
  if (document === null) return { status: "not_found" };

  if (!(await store.claim(documentId))) return { status: "not_claimed" };
  opts.log("claimed");

  try {
    const bytes = await store.download(document.storagePath);
    const pages = await extractPages(bytes, document.mimeType);
    const chunks = chunkPages(pages);
    if (chunks.length === 0) throw new EmptyDocumentError();
    const pageCount = Math.max(...pages.map((page) => page.page));
    opts.log(`extracted ${pages.length} pages, ${chunks.length} chunks`);

    const batchCount = Math.ceil(chunks.length / opts.batchSize);
    for (let b = 0; b < batchCount; b++) {
      if (b > 0 && opts.batchDelayMs > 0) await opts.sleep(opts.batchDelayMs);
      const batch = chunks.slice(b * opts.batchSize, (b + 1) * opts.batchSize);
      const label = `batch ${b + 1}/${batchCount}`;
      const vectors = await embedBatchWithRetry(
        embedder,
        batch.map((chunk) => chunk.content),
        opts,
        label,
      );
      assertVectors(vectors, batch.length, embedder.dimensions);
      await store.insertChunks(
        documentId,
        toRows(batch, vectors, embedder.model),
      );
      opts.log(`${label} stored`);
    }

    await store.finalize(documentId, {
      pageCount,
      embeddingModel: embedder.model,
      pipelineVersion: PIPELINE_VERSION,
    });
    opts.log("ready");
    return { status: "ready", pageCount, chunkCount: chunks.length };
  } catch (error) {
    // Calling `fail` after losing the claim would delete the new owner's chunks.
    if (error instanceof ClaimLostError) return { status: "claim_lost" };

    const reason = classifyFailure(error);
    try {
      await store.fail(documentId, reason);
    } catch (failError) {
      throw new Error(
        "Ingestion failed and the failure could not be recorded; the document stays processing until it goes stale.",
        { cause: failError },
      );
    }
    opts.log(`failed: ${reason}`);
    return { status: "failed", reason, error };
  }
}
