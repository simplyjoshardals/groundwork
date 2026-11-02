import "server-only";
import type { PageInput } from "@/lib/chunking";
import {
  EmptyDocumentError,
  FileTooLargeError,
  InvalidFileSignatureError,
  UnsupportedMimeTypeError,
} from "./errors";
import { MAX_FILE_BYTES } from "./limits";
import { extractPdfPages, hasPdfMagic } from "./pdf";
import { extractTextPages } from "./text";

type SupportedMime = "application/pdf" | "text/plain" | "text/markdown";

/** Lowercases and drops parameters ("Text/Plain; charset=utf-8" -> "text/plain"). */
function parseMime(mimeType: string): SupportedMime | null {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return base === "application/pdf" ||
    base === "text/plain" ||
    base === "text/markdown"
    ? base
    : null;
}

/**
 * Extracts pages from an uploaded file, in the `PageInput` shape `chunkPages`
 * expects (`{ page, text }`, 1-based).
 *
 * - PDF: one entry per physical page, blank pages included, text not
 *   normalized (the chunker does that).
 * - text/plain and text/markdown: virtual pages from `paginateText`.
 *
 * Checks, in order: argument types, size, empty input, MIME type, then
 * content (the `%PDF-` signature for PDFs; UTF-8 and no NUL bytes for text).
 * The MIME type is only a routing hint; the bytes decide.
 *
 * Throws `ExtractionError` subclasses for problems with the file (see
 * ./errors.ts; `error.code` is a `documents.error_reason` value) and
 * `TypeError` for wrong argument types. It touches no database, storage or
 * network, and does not modify `buffer`.
 */
export async function extractPages(
  buffer: Uint8Array,
  mimeType: string,
): Promise<PageInput[]> {
  if (!(buffer instanceof Uint8Array)) {
    throw new TypeError("buffer must be a Uint8Array");
  }
  if (typeof mimeType !== "string") {
    throw new TypeError("mimeType must be a string");
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new FileTooLargeError(MAX_FILE_BYTES);
  }
  if (buffer.byteLength === 0) throw new EmptyDocumentError();

  const mime = parseMime(mimeType);
  if (mime === null) throw new UnsupportedMimeTypeError();

  if (mime === "application/pdf") {
    if (!hasPdfMagic(buffer)) throw new InvalidFileSignatureError();
    return extractPdfPages(buffer);
  }
  return extractTextPages(buffer);
}
