import type { OwnDocument } from "@/lib/documents/list-own-documents";
import { MAX_DOCS_PER_USER_HINT } from "@/lib/upload/file-checks";

/**
 * The shelf has room for a fixed number of documents, and the UI shows it as
 * that many slots: filled by a document's spine, or empty. The number is the
 * document cap, never a second copy of it.
 */
export const SHELF_SLOTS = MAX_DOCS_PER_USER_HINT;

const SPINE_BASE_PX = 36;
const SPINE_PER_PAGE_PX = 0.8;
const SPINE_MAX_PAGES = 30;
const SPINE_WIDTH_BASE_PX = 16;
const SPINE_WIDTH_PER_PAGE_PX = 0.55;
/** An empty slot, and a spine without a trusted page count, is this wide. */
export const SPINE_DEFAULT_WIDTH_PX = 24;

/** A document without a page count yet (still processing, or text) stands this tall. */
export const SPINE_DEFAULT_PX = 44;

/**
 * How tall a spine stands: more pages, a taller book, up to 30 pages. It is
 * real data (the page count of a ready document), and everything else stands
 * at one default height so a processing row does not jump when it finishes by
 * more than a few pixels.
 */
export function spineHeightPx(
  doc: Pick<OwnDocument, "status" | "pageCount">,
): number {
  if (doc.status === "ready" && doc.pageCount !== null && doc.pageCount > 0) {
    return Math.round(
      SPINE_BASE_PX +
        Math.min(doc.pageCount, SPINE_MAX_PAGES) * SPINE_PER_PAGE_PX,
    );
  }
  return SPINE_DEFAULT_PX;
}

/**
 * How thick a spine is: more pages, a thicker book (16 px, up to about 32 px at
 * 30 pages). The shelf is a fixed width, so when the books together are wider
 * than it, they all shrink in proportion (`flex-shrink` in `ShelfStrip`).
 */
export function spineWidthPx(
  doc: Pick<OwnDocument, "status" | "pageCount">,
): number {
  if (doc.status === "ready" && doc.pageCount !== null && doc.pageCount > 0) {
    return Math.round(
      SPINE_WIDTH_BASE_PX +
        Math.min(doc.pageCount, SPINE_MAX_PAGES) * SPINE_WIDTH_PER_PAGE_PX,
    );
  }
  return SPINE_DEFAULT_WIDTH_PX;
}

/** Oldest first, as books are shelved: the newest spine is the last one. */
export function shelfOrder(documents: readonly OwnDocument[]): OwnDocument[] {
  return [...documents].sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return Number.isNaN(diff) ? 0 : diff;
  });
}

export function shelfCaption(count: number): string {
  return `${count} of ${SHELF_SLOTS} on your shelf`;
}

/**
 * Whether the file being added still needs a placeholder: once the shelf holds
 * the row with its id, the real row takes over.
 */
export function isPendingShown(
  pending: { documentId: string | null } | null,
  documents: readonly OwnDocument[] | null,
): boolean {
  if (pending === null) return false;
  if (pending.documentId === null) return true;
  return !documents?.some((d) => d.id === pending.documentId);
}
