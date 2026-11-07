/**
 * The viewer's place in the URL (Task 3.3): `?doc=<id>&page=<n>&chunk=<id>`.
 * Pure helpers with no React and no Next.js, so they run under the node-only
 * Vitest setup. Everything read from the URL is untrusted input and is
 * validated here before it reaches a query or the viewer.
 */

export const DOC_PARAM = "doc";
export const PAGE_PARAM = "page";
export const CHUNK_PARAM = "chunk";

/** What a link or a click asks the viewer to show. */
export interface ViewerTarget {
  documentId: string;
  /** 1-based. The viewer clamps it to the document's page count. */
  page: number;
  /**
   * `chunks.id` of the cited passage, as digits. The viewer loads it to
   * highlight the passage (Task 3.5).
   */
  chunkId: string | null;
}

export type ViewerLocation =
  | { status: "closed" }
  /** `doc` is present but the link is malformed; the panel says so. */
  | { status: "invalid" }
  | ({ status: "open" } & ViewerTarget);

/** The part of `URLSearchParams` this module reads. */
export interface SearchParamsReader {
  get(name: string): string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Digits only and short, so the value is always a safe integer. */
const PAGE_PATTERN = /^\d{1,6}$/;
const CHUNK_PATTERN = /^[1-9]\d{0,14}$/;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** `chunks.id` as it appears in the URL: digits only, no leading zero. */
export function isChunkId(value: string): boolean {
  return CHUNK_PATTERN.test(value);
}

/**
 * Reads the viewer state from search params. No `doc` means closed (stray
 * `page` or `chunk` values are ignored). A `doc` with any malformed value is
 * `invalid`, never silently treated as closed. A missing `page` is page 1.
 */
export function parseViewerLocation(
  params: SearchParamsReader,
): ViewerLocation {
  const doc = params.get(DOC_PARAM);
  if (doc === null) return { status: "closed" };
  if (!isUuid(doc)) return { status: "invalid" };

  const rawPage = params.get(PAGE_PARAM);
  if (rawPage !== null && !PAGE_PATTERN.test(rawPage)) {
    return { status: "invalid" };
  }

  const rawChunk = params.get(CHUNK_PARAM);
  if (rawChunk !== null && !CHUNK_PATTERN.test(rawChunk)) {
    return { status: "invalid" };
  }

  return {
    status: "open",
    documentId: doc.toLowerCase(),
    page: rawPage === null ? 1 : Number.parseInt(rawPage, 10),
    chunkId: rawChunk,
  };
}

/**
 * The query string (with its leading `?`, or empty) that shows `target`, or
 * closes the viewer when `target` is `null`. Other parameters are kept as
 * they are.
 */
export function withViewerParams(
  search: string,
  target: ViewerTarget | null,
): string {
  const params = new URLSearchParams(search);
  params.delete(DOC_PARAM);
  params.delete(PAGE_PARAM);
  params.delete(CHUNK_PARAM);
  if (target) {
    params.set(DOC_PARAM, target.documentId);
    params.set(PAGE_PARAM, String(target.page));
    if (target.chunkId !== null) params.set(CHUNK_PARAM, target.chunkId);
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
