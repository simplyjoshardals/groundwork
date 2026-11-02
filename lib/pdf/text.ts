import "server-only";
import { paginateText, type PageInput } from "@/lib/chunking";
import {
  EmptyDocumentError,
  InvalidFileSignatureError,
  TooManyPagesError,
} from "./errors";
import { MAX_PAGES } from "./limits";

/**
 * Turns a .txt or .md file into virtual pages (the shape the chunker expects).
 *
 * Text validation, since a MIME type proves nothing:
 * - A NUL byte means binary data (this also rejects UTF-16 text). Rejected
 *   with `InvalidFileSignatureError`.
 * - The bytes must be valid UTF-8 (strict decode). A UTF-8 BOM is dropped.
 *   Anything else, e.g. Latin-1 or a renamed binary, is rejected with
 *   `InvalidFileSignatureError`. Nothing is silently replaced with U+FFFD.
 *
 * Markdown is not parsed; it is plain text. Normalization and pagination
 * belong to `paginateText`, which is reused as-is.
 *
 * Text that is empty after normalization throws `EmptyDocumentError`. More
 * than MAX_PAGES virtual pages throws `TooManyPagesError`, because the
 * database caps `page_count` at 30 for every file type.
 */
export function extractTextPages(input: Uint8Array): PageInput[] {
  if (input.indexOf(0) !== -1) throw new InvalidFileSignatureError();

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new InvalidFileSignatureError();
  }

  const pages = paginateText(decoded);
  if (pages.length === 0) throw new EmptyDocumentError();
  if (pages.length > MAX_PAGES) throw new TooManyPagesError(MAX_PAGES);
  return pages;
}
