import { describe, expect, it } from "vitest";
import type { OwnDocument } from "@/lib/documents/list-own-documents";
import {
  SHELF_SLOTS,
  SPINE_DEFAULT_PX,
  isPendingShown,
  shelfCaption,
  shelfOrder,
  SPINE_DEFAULT_WIDTH_PX,
  spineHeightPx,
  spineWidthPx,
} from "@/lib/documents/shelf";
import { MAX_DOCS_PER_USER_HINT } from "@/lib/upload/file-checks";

const doc = (over: Partial<OwnDocument> & { id: string }): OwnDocument => ({
  title: over.id,
  originalFilename: `${over.id}.pdf`,
  status: "ready",
  errorReason: null,
  pageCount: 5,
  chunkCount: 10,
  createdAt: "2026-11-17T12:00:00.000Z",
  processingStartedAt: null,
  ...over,
});

describe("shelf", () => {
  it("has exactly as many slots as the document cap", () => {
    expect(SHELF_SLOTS).toBe(MAX_DOCS_PER_USER_HINT);
  });

  it("makes a spine taller for more pages, up to 30", () => {
    const h = (pageCount: number | null, status: OwnDocument["status"] = "ready") =>
      spineHeightPx({ status, pageCount });
    expect(h(1)).toBeLessThan(h(12));
    expect(h(12)).toBeLessThan(h(30));
    expect(h(30)).toBe(h(80));
  });

  it("stands everything without a trusted page count at the default height", () => {
    expect(spineHeightPx({ status: "processing", pageCount: 12 })).toBe(SPINE_DEFAULT_PX);
    expect(spineHeightPx({ status: "failed", pageCount: null })).toBe(SPINE_DEFAULT_PX);
    expect(spineHeightPx({ status: "ready", pageCount: null })).toBe(SPINE_DEFAULT_PX);
    expect(spineHeightPx({ status: "ready", pageCount: 0 })).toBe(SPINE_DEFAULT_PX);
  });

  it("shelves the oldest first, so the newest is the last spine", () => {
    const docs = [
      doc({ id: "new", createdAt: "2026-11-17T12:00:00.000Z" }),
      doc({ id: "old", createdAt: "2026-11-01T12:00:00.000Z" }),
      doc({ id: "mid", createdAt: "2026-11-10T12:00:00.000Z" }),
    ];
    expect(shelfOrder(docs).map((d) => d.id)).toEqual(["old", "mid", "new"]);
    // The input is not changed.
    expect(docs[0].id).toBe("new");
  });

  it("words the caption", () => {
    expect(shelfCaption(4)).toBe(`4 of ${SHELF_SLOTS} on your shelf`);
  });

  it("shows a placeholder until the shelf holds the real row", () => {
    expect(isPendingShown(null, [])).toBe(false);
    expect(isPendingShown({ documentId: null }, [])).toBe(true);
    expect(isPendingShown({ documentId: "a" }, [])).toBe(true);
    expect(isPendingShown({ documentId: "a" }, null)).toBe(true);
    expect(isPendingShown({ documentId: "a" }, [doc({ id: "a" })])).toBe(false);
  });

  it("makes a spine thicker for more pages, up to 30", () => {
    const w = (pageCount: number | null, status: OwnDocument["status"] = "ready") =>
      spineWidthPx({ status, pageCount });
    expect(w(1)).toBeLessThan(w(12));
    expect(w(12)).toBeLessThan(w(30));
    expect(w(30)).toBe(w(80));
  });

  it("gives everything without a trusted page count the default width", () => {
    expect(spineWidthPx({ status: "processing", pageCount: 12 })).toBe(SPINE_DEFAULT_WIDTH_PX);
    expect(spineWidthPx({ status: "failed", pageCount: null })).toBe(SPINE_DEFAULT_WIDTH_PX);
    expect(spineWidthPx({ status: "ready", pageCount: null })).toBe(SPINE_DEFAULT_WIDTH_PX);
  });
});
