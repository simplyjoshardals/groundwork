/**
 * Pure logic for the text and Markdown viewer (Task 3.7). No React, no DOM,
 * no network, so it runs under the node-only Vitest setup.
 *
 * `chunks.char_start` / `char_end` are UTF-16 offsets into the NORMALIZED text
 * of one virtual page (Task 1.4), and that page text is not stored. The
 * viewer rebuilds it from the file with the same pipeline the ingestion used
 * (`paginateText`, then `normalizePageText` as `chunkPages` does), and only
 * highlights when `pageText.slice(charStart, charEnd)` is exactly the chunk's
 * stored content. Any doubt (a pipeline change, a different file, bad
 * offsets) declines the highlight and the fallback passage panel takes over:
 * a wrong highlight is worse than none.
 */
import { normalizePageText } from "@/lib/chunking/normalize";
import { paginateText } from "@/lib/chunking/paginate-text";
import type { HighlightStatus } from "@/lib/pdf-highlight/plan";

const TEXT_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/plain",
  "text/markdown",
]);

/** True for the two types this viewer opens (parameters such as charset are ignored). */
export function isTextMimeType(mimeType: string): boolean {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return TEXT_MIME_TYPES.has(base);
}

export type DecodeResult =
  { ok: true; text: string } | { ok: false; reason: "invalid_text" };

/**
 * Decodes a file the way `extractPages` does for text: strict UTF-8 (invalid
 * bytes are rejected, never replaced), a BOM stripped, and NUL bytes refused
 * (this also rejects UTF-16).
 */
export function decodeTextFile(bytes: Uint8Array): DecodeResult {
  if (bytes.includes(0)) return { ok: false, reason: "invalid_text" };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "invalid_text" };
  }
}

/**
 * The normalized text of each virtual page, in order (index 0 is page 1).
 * Empty for a file with no text. Uses the ingestion defaults on purpose: a
 * different page size would shift every offset.
 */
export function buildTextPages(text: string): string[] {
  return paginateText(text).map((page) => normalizePageText(page.text));
}

/** The cited passage as the text viewer needs it. */
export interface TextPassage {
  /** `chunks.id` as digits. */
  id: string;
  /** 1-based virtual page the chunk was cut from. */
  pageNumber: number;
  /** The chunk's stored content. */
  text: string;
  /** UTF-16 offsets into the normalized page text; `charEnd` is exclusive. */
  charStart: number;
  charEnd: number;
}

export type TextHighlightPlan =
  /** The link names no usable passage: show the page as it is. */
  | { status: "none" }
  | { status: "highlight"; before: string; match: string; after: string }
  | {
      status: "declined";
      reason: "other_page" | "render_mismatch";
      pageNumber: number | null;
    };

/**
 * Decides what to highlight on the page being shown. `pages` are the
 * normalized virtual pages; `shownPage` is 1-based. The caller passes `null`
 * for a passage that belongs to another document.
 */
export function planTextHighlight(
  pages: readonly string[],
  shownPage: number,
  passage: TextPassage | null,
): TextHighlightPlan {
  if (passage === null) return { status: "none" };
  if (passage.pageNumber !== shownPage) {
    return {
      status: "declined",
      reason: "other_page",
      pageNumber: passage.pageNumber,
    };
  }

  const declined: TextHighlightPlan = {
    status: "declined",
    reason: "render_mismatch",
    pageNumber: null,
  };
  const pageText = pages[shownPage - 1];
  if (pageText === undefined) return declined;

  const { charStart, charEnd } = passage;
  if (
    !Number.isInteger(charStart) ||
    !Number.isInteger(charEnd) ||
    charStart < 0 ||
    charEnd <= charStart ||
    charEnd > pageText.length
  ) {
    return declined;
  }
  // The exactness check: offsets are trusted only if they reproduce the chunk.
  if (pageText.slice(charStart, charEnd) !== passage.text) return declined;

  return {
    status: "highlight",
    before: pageText.slice(0, charStart),
    match: pageText.slice(charStart, charEnd),
    after: pageText.slice(charEnd),
  };
}

/** What the viewer reports to the panel for a plan (same type the PDF viewer uses). */
export function toHighlightStatus(plan: TextHighlightPlan): HighlightStatus {
  switch (plan.status) {
    case "none":
      return { state: "none" };
    case "highlight":
      return { state: "highlighted" };
    case "declined":
      return {
        state: "declined",
        reason: plan.reason,
        pageNumber: plan.pageNumber,
      };
  }
}

/** Keeps a page number from the URL inside 1..pageCount (1 when there are no pages). */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page) || pageCount < 1) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), pageCount);
}
