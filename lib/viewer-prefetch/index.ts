import {
  getChunk,
  type ChunkResult,
} from "@/lib/documents/get-chunk";
import {
  getViewerDocument,
  type ViewerDocumentResult,
} from "@/lib/documents/get-viewer-document";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { StreamSource } from "@/types/ask-stream";
import { createTtlCache } from "./cache";

const TTL_MS = 60_000;

const documents = createTtlCache<ViewerDocumentResult>({
  ttlMs: TTL_MS,
  isCacheable: (result) => result.ok,
});
const chunks = createTtlCache<ChunkResult>({
  ttlMs: TTL_MS,
  isCacheable: (result) => result.ok,
});

/** The document lookup the viewer uses; shares work with `prefetchSource`. */
export function loadViewerDocument(
  documentId: string,
): Promise<ViewerDocumentResult> {
  return documents.get(documentId, () =>
    getViewerDocument(createBrowserSupabase(), documentId),
  );
}

/** The chunk lookup the viewer uses; shares work with `prefetchSource`. */
export function loadChunkPassage(chunkId: string): Promise<ChunkResult> {
  return chunks.get(chunkId, () =>
    getChunk(createBrowserSupabase(), chunkId),
  );
}

/** Warms both lookups for a source; called on marker hover or focus. */
export function prefetchSource(source: StreamSource): void {
  const chunkId = String(source.chunkId);
  documents.prefetch(source.documentId, () =>
    getViewerDocument(createBrowserSupabase(), source.documentId),
  );
  chunks.prefetch(chunkId, () => getChunk(createBrowserSupabase(), chunkId));
}
