/**
 * PDF text extraction for the Task 0.6 spike.
 *
 * Pure-JS (unpdf = serverless build of PDF.js), returning text PER PAGE.
 * Every failure is mapped to a PdfExtractionError with a stable code, so a
 * caller can never crash on a raw library error and never leaks library
 * messages to a client.
 */
import { extractText, getDocumentProxy } from "unpdf";
import { round } from "../provider/util";

export type PdfErrorCode =
  | "not_pdf"
  | "too_large"
  | "too_many_pages"
  | "encrypted"
  | "corrupt"
  | "unexpected";

export class PdfExtractionError extends Error {
  constructor(
    readonly code: PdfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PdfExtractionError";
  }
}

/**
 * PROVISIONAL, chosen from the synthetic fixtures (see docs/spikes/pdf.md):
 * scanned files averaged 0-5 characters per page, the sparsest real-text file
 * 59, every normal text file 600+. 25 sits in that gap. It still needs
 * confirming on the deployed route and on real scans before task 1.5 uses it.
 */
export const DEFAULT_MIN_AVG_CHARS_PER_PAGE = 25;

/** Safety bound for the spike route (the product limit of 30 is task 1.5). */
export const DEFAULT_MAX_PAGES = 100;

/** The PDF spec lets the header sit anywhere in the first 1024 bytes. */
const HEADER_WINDOW = 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function hasPdfMagic(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, HEADER_WINDOW) - PDF_MAGIC.length;
  for (let start = 0; start <= end; start++) {
    if (PDF_MAGIC.every((byte, i) => bytes[start + i] === byte)) return true;
  }
  return false;
}

/** Counts non-whitespace characters, so blank layout cannot inflate a page. */
export function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

/**
 * Scanned-PDF heuristic from ARCHITECTURE section 3.6: average extracted
 * characters per page below a small threshold. An empty list counts as scanned.
 */
export function isLikelyScanned(
  pageChars: readonly number[],
  minAvgCharsPerPage: number,
): boolean {
  if (pageChars.length === 0) return true;
  const total = pageChars.reduce((sum, n) => sum + n, 0);
  return total / pageChars.length < minAvgCharsPerPage;
}

/** Maps anything thrown by the library to a controlled error. */
export function mapPdfError(error: unknown): PdfExtractionError {
  if (error instanceof PdfExtractionError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") {
    return new PdfExtractionError(
      "encrypted",
      "The PDF is password-protected.",
    );
  }
  if (
    name === "InvalidPDFException" ||
    name === "MissingPDFException" ||
    name === "FormatError"
  ) {
    return new PdfExtractionError("corrupt", "The PDF could not be parsed.");
  }
  return new PdfExtractionError(
    "unexpected",
    "Unexpected error while reading the PDF.",
  );
}

export interface ExtractedPage {
  page: number;
  /** Non-whitespace characters. */
  chars: number;
  text: string;
}

export interface ExtractOptions {
  maxBytes: number;
  maxPages: number;
  minAvgCharsPerPage: number;
}

export interface ExtractResult {
  pageCount: number;
  pages: ExtractedPage[];
  totalChars: number;
  avgCharsPerPage: number;
  likelyScanned: boolean;
  timings: { loadMs: number; extractMs: number };
}

export async function extractPdf(
  input: Uint8Array,
  options?: Partial<ExtractOptions>,
): Promise<ExtractResult> {
  const maxBytes = options?.maxBytes ?? 5 * 1024 * 1024;
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const minAvg = options?.minAvgCharsPerPage ?? DEFAULT_MIN_AVG_CHARS_PER_PAGE;

  if (input.byteLength > maxBytes) {
    throw new PdfExtractionError("too_large", "The file is too large.");
  }
  if (!hasPdfMagic(input)) {
    throw new PdfExtractionError("not_pdf", "The file is not a PDF.");
  }

  // PDF.js may take ownership of the buffer, so it gets its own copy.
  const data = new Uint8Array(input);
  const loadStarted = performance.now();
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(data, { verbosity: 0 });
    const loadMs = performance.now() - loadStarted;
    if (pdf.numPages < 1) {
      throw new PdfExtractionError("corrupt", "The PDF has no pages.");
    }
    if (pdf.numPages > maxPages) {
      throw new PdfExtractionError(
        "too_many_pages",
        `The PDF has more than ${maxPages} pages.`,
      );
    }

    const extractStarted = performance.now();
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const extractMs = performance.now() - extractStarted;

    const pages = text.map((pageText, index) => ({
      page: index + 1,
      chars: countChars(pageText),
      text: pageText,
    }));
    const totalChars = pages.reduce((sum, p) => sum + p.chars, 0);
    return {
      pageCount: totalPages,
      pages,
      totalChars,
      avgCharsPerPage: round(totalChars / pages.length, 1),
      likelyScanned: isLikelyScanned(
        pages.map((p) => p.chars),
        minAvg,
      ),
      timings: { loadMs: round(loadMs, 1), extractMs: round(extractMs, 1) },
    };
  } catch (error) {
    throw mapPdfError(error);
  } finally {
    if (pdf) await release(pdf);
  }
}

/**
 * Frees PDF.js resources. A failure here must never replace the real result
 * or error, so it is contained (the document has already been read by now).
 */
async function release(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
): Promise<void> {
  try {
    await pdf.loadingTask.destroy();
  } catch {
    // Intentionally ignored: cleanup only.
  }
}
