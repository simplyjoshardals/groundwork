import { describe, expect, it } from "vitest";
import {
  documentMeta,
  fileKindOf,
  formatAdded,
} from "@/lib/documents/document-meta";

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("fileKindOf", () => {
  it("names the three accepted kinds, whatever the case", () => {
    expect(fileKindOf("lease.pdf")).toBe("PDF");
    expect(fileKindOf("NOTES.TXT")).toBe("Text");
    expect(fileKindOf("readme.md")).toBe("Markdown");
  });
  it("returns null for no extension, a trailing dot or an unknown one", () => {
    expect(fileKindOf("lease")).toBeNull();
    expect(fileKindOf("lease.")).toBeNull();
    expect(fileKindOf("archive.zip")).toBeNull();
    // Inherited object keys are not extensions.
    expect(fileKindOf("x.constructor")).toBeNull();
  });
});

describe("formatAdded", () => {
  it("steps through just now, minutes, hours, days and a date", () => {
    expect(formatAdded(ago(10_000), NOW)).toBe("added just now");
    expect(formatAdded(ago(MIN), NOW)).toBe("added 1 minute ago");
    expect(formatAdded(ago(5 * MIN), NOW)).toBe("added 5 minutes ago");
    expect(formatAdded(ago(3 * HOUR), NOW)).toBe("added 3 hours ago");
    expect(formatAdded(ago(2 * DAY), NOW)).toBe("added 2 days ago");
    expect(formatAdded(ago(45 * DAY), NOW)).toBe("added 3 Oct 2026");
  });
  it("treats a timestamp in the future as just now", () => {
    expect(formatAdded(ago(-5 * MIN), NOW)).toBe("added just now");
  });
  it("returns null for an unreadable timestamp", () => {
    expect(formatAdded("not a date", NOW)).toBeNull();
  });
});

describe("documentMeta", () => {
  const base = {
    status: "ready" as const,
    originalFilename: "lease.pdf",
    pageCount: 6,
    createdAt: ago(2 * DAY),
  };
  it("joins pages, kind and age", () => {
    expect(documentMeta(base, NOW)).toBe("6 pages · PDF · added 2 days ago");
    expect(documentMeta({ ...base, pageCount: 1 }, NOW)).toBe(
      "1 page · PDF · added 2 days ago",
    );
  });
  it("leaves out the page count until the document is ready", () => {
    expect(documentMeta({ ...base, status: "processing" }, NOW)).toBe(
      "PDF · added 2 days ago",
    );
    expect(documentMeta({ ...base, pageCount: null }, NOW)).toBe(
      "PDF · added 2 days ago",
    );
  });
});
