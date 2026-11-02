import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import type { PageInput } from "@/lib/chunking";
import {
  CorruptPdfError,
  EncryptedPdfError,
  ExtractionError,
  ScannedPdfError,
  TooManyPagesError,
  UnexpectedExtractionError,
} from "./errors";
import { MAX_PAGES, MIN_AVG_CHARS_PER_PAGE } from "./limits";

/** The PDF spec lets the header sit anywhere in the first 1024 bytes. */
const HEADER_WINDOW = 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** True when `%PDF-` appears in the first 1024 bytes (the spike's validated rule). */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, HEADER_WINDOW) - PDF_MAGIC.length;
  for (let start = 0; start <= end; start++) {
    if (PDF_MAGIC.every((byte, i) => bytes[start + i] === byte)) return true;
  }
  return false;
}

/** Non-whitespace characters, so blank layout cannot inflate a page. */
function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** Average non-whitespace characters per page is below the provisional threshold. */
function isLikelyScanned(pages: readonly PageInput[]): boolean {
  if (pages.length === 0) return true;
  const total = pages.reduce((sum, p) => sum + countChars(p.text), 0);
  return total / pages.length < MIN_AVG_CHARS_PER_PAGE;
}

/**
 * Maps anything thrown by the library to a controlled error. Only failures
 * known from the spike get a specific code; everything else is
 * `internal_error` and the original message is dropped.
 */
function mapLibraryError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") return new EncryptedPdfError();
  if (
    name === "InvalidPDFException" ||
    name === "MissingPDFException" ||
    name === "FormatError"
  ) {
    return new CorruptPdfError();
  }
  return new UnexpectedExtractionError();
}

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/**
 * Frees PDF.js resources. In pdf.js 6.x the document proxy has no `destroy()`;
 * it lives on `loadingTask` (verified against unpdf 1.9.1). A failure here
 * must never replace the real result or error, so everything is contained.
 */
async function release(pdf: PdfDocument): Promise<void> {
  try {
    await pdf.loadingTask.destroy();
  } catch {
    // Intentionally ignored: cleanup only.
  }
}

/**
 * Extracts one page entry per physical PDF page (1-based, blank pages kept,
 * text un-normalized: the chunker normalizes). The caller must already have
 * checked the file size and the `%PDF-` signature.
 */
export async function extractPdfPages(input: Uint8Array): Promise<PageInput[]> {
  // PDF.js may take ownership of the buffer it is given, so it gets a copy.
  const data = new Uint8Array(input);
  let pdf: PdfDocument | null = null;
  try {
    pdf = await getDocumentProxy(data, { verbosity: 0 });
    if (pdf.numPages < 1) throw new CorruptPdfError();
    // Checked before extracting any text.
    if (pdf.numPages > MAX_PAGES) throw new TooManyPagesError(MAX_PAGES);

    const { text } = await extractText(pdf, { mergePages: false });
    if (text.length !== pdf.numPages) throw new UnexpectedExtractionError();

    const pages = text.map((pageText, index) => ({
      page: index + 1,
      text: pageText,
    }));
    if (isLikelyScanned(pages)) throw new ScannedPdfError();
    return pages;
  } catch (error) {
    throw mapLibraryError(error);
  } finally {
    if (pdf) await release(pdf);
  }
}
