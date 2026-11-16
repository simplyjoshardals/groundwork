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

/**
 * The caches are module-level and keyed by id only, so they must not outlive
 * the signed-in user: sign-out and the next sign-in can be client-side
 * navigations that keep this module alive. Watch the auth state once, on first
 * use, and clear both caches when the user changes or signs out. The first
 * event (the current session) only records who is signed in.
 */
let watchingAuth = false;
let currentUser: string | null | undefined;

function clearAll(): void {
  documents.clear();
  chunks.clear();
}

function watchAuth(): void {
  if (watchingAuth || typeof window === "undefined") return;
  try {
    createBrowserSupabase().auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      if (event === "SIGNED_OUT" || (currentUser !== undefined && next !== currentUser)) {
        clearAll();
      }
      currentUser = next;
    });
    watchingAuth = true;
  } catch {
    // No client (missing configuration): the lookups below report their own
    // failure; the caches stay empty because nothing succeeds.
  }
}

/** The document lookup the viewer uses; shares work with `prefetchSource`. */
export function loadViewerDocument(
  documentId: string,
): Promise<ViewerDocumentResult> {
  watchAuth();
  return documents.get(documentId, () =>
    getViewerDocument(createBrowserSupabase(), documentId),
  );
}

/** The chunk lookup the viewer uses; shares work with `prefetchSource`. */
export function loadChunkPassage(chunkId: string): Promise<ChunkResult> {
  watchAuth();
  return chunks.get(chunkId, () =>
    getChunk(createBrowserSupabase(), chunkId),
  );
}

/** Warms both lookups for a source; called on marker hover or focus. */
export function prefetchSource(source: StreamSource): void {
  watchAuth();
  const chunkId = String(source.chunkId);
  documents.prefetch(source.documentId, () =>
    getViewerDocument(createBrowserSupabase(), source.documentId),
  );
  chunks.prefetch(chunkId, () => getChunk(createBrowserSupabase(), chunkId));
}