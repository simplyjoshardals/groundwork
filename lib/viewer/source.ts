import type { ChunkResult } from "@/lib/documents/get-chunk";
import type { ViewerDocumentResult } from "@/lib/documents/get-viewer-document";
import {
  createDocumentSignedUrl,
  type SignedUrlResult,
} from "@/lib/storage/documents";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  loadTextFile,
  type TextFileResult,
} from "@/lib/text-viewer/load-text-file";
import { loadChunkPassage, loadViewerDocument } from "@/lib/viewer-prefetch";

/**
 * Everything the viewer reads from outside: one small seam, so the dev drill
 * (`/dev-states/viewer/<scenario>`) can run the real viewer against scripted
 * answers (errors, slow responses, declined highlights) with no backend.
 * Members are plain function properties, not methods, so they can be passed
 * around unbound. Callers wrap every call in try/catch: a source may reject.
 */
export interface ViewerSource {
  loadDocument: (documentId: string) => Promise<ViewerDocumentResult>;
  loadChunk: (chunkId: string) => Promise<ChunkResult>;
  /** A URL PDF.js can fetch for a stored file. */
  createPdfUrl: (storagePath: string) => Promise<SignedUrlResult>;
  loadText: (
    storagePath: string,
    signal: AbortSignal,
  ) => Promise<TextFileResult>;
}

/** The real backend: the browser (user) session, through the 60 s prefetch cache. */
export const realViewerSource: ViewerSource = {
  loadDocument: (documentId) => loadViewerDocument(documentId),
  loadChunk: (chunkId) => loadChunkPassage(chunkId),
  createPdfUrl: (storagePath) =>
    createDocumentSignedUrl(createBrowserSupabase(), storagePath),
  loadText: (storagePath, signal) =>
    loadTextFile(createBrowserSupabase(), storagePath, { signal }),
};
