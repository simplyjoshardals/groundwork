import { MIN_CHUNK_CHARS, splitIntoSpans, type PageInput } from "./chunk-pages";
import { normalizePageText } from "./normalize";

export interface PaginateOptions {
  /** Target size of a virtual page in UTF-16 code units. Default 4000. */
  virtualPageChars?: number;
}

/** Virtual page size for .txt/.md files (DATA_MODEL.md suggests ~4000). */
export const DEFAULT_VIRTUAL_PAGE_CHARS = 4000;

/**
 * Cuts plain text (a .txt or .md file, which has no pages) into virtual pages
 * so every chunk can carry a page number.
 *
 * - The text is normalized first. Markdown is not parsed; it stays plain text.
 * - Pages end at the latest paragraph boundary within the size target. Only
 *   when a paragraph is larger than the target does it fall back to a
 *   sentence, line or word boundary, and finally to a hard cut that never
 *   splits a surrogate pair.
 * - Nothing is lost or duplicated: apart from the blank-line separators
 *   between pages, the pages joined in order are the normalized text.
 * - Each page is already normalized, so `chunkPages` leaves its offsets
 *   unchanged when it normalizes the page again.
 *
 * Page numbers start at 1. The 30-page database limit (about 120,000
 * characters of text) is enforced by extraction/ingestion, not here.
 */
export function paginateText(
  text: string,
  options: PaginateOptions = {},
): PageInput[] {
  const size = options.virtualPageChars ?? DEFAULT_VIRTUAL_PAGE_CHARS;
  if (!Number.isInteger(size) || size < MIN_CHUNK_CHARS) {
    throw new RangeError(
      `virtualPageChars must be an integer >= ${MIN_CHUNK_CHARS}, got ${size}`,
    );
  }
  const normalized = normalizePageText(text);
  if (normalized.length === 0) return [];
  return splitIntoSpans(normalized, size, 0).map((span, index) => ({
    page: index + 1,
    text: normalized.slice(span.start, span.end),
  }));
}
