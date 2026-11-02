/** Product limits enforced by extraction. They mirror the DB constraints in DATA_MODEL.md. */

/** `documents.page_count between 1 and 30`. Applies to PDF pages and to virtual text pages. */
export const MAX_PAGES = 30;

/** 5 MiB: `documents.size_bytes` check and the storage bucket limit. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * PROVISIONAL scanned-PDF heuristic: a PDF whose average number of
 * non-whitespace characters per page is below this is rejected as scanned.
 *
 * Evidence (docs/spikes/pdf.md section 5.1) is synthetic only: two generated
 * scans averaged 0 and 5, the sparsest real-text fixture 59, every normal text
 * fixture 600+; 25 sits in that gap. It was never checked on a real scan.
 * Known limits:
 * - It is not OCR detection, only a "too little extractable text" guard.
 * - A real scan with a stamp, Bates number or OCR layer averaging 25 or more
 *   passes and produces junk or near-empty chunks.
 * - A genuine text PDF that is mostly images or slides can fall below it and
 *   be rejected.
 * - It uses the average, so a half-scanned document can pass.
 * - Garbled text (unmapped fonts) still counts as characters and passes.
 * Re-check it on real documents before relying on it.
 */
export const MIN_AVG_CHARS_PER_PAGE = 25;
