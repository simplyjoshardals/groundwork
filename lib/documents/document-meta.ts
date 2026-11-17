import type { DocumentStatus } from "./document-status";

/**
 * The meta line of a document row (DESIGN 5.10): "4 pages · PDF · added 2 days
 * ago". Pure and client-safe. Time goes in as `now`, so a row renders the same
 * on the server and in the browser (`DocumentList` seeds `now` from the
 * server's read) and tests control the clock.
 */

export type FileKind = "PDF" | "Text" | "Markdown";

const KIND_BY_EXTENSION: Readonly<Record<string, FileKind>> = {
  pdf: "PDF",
  txt: "Text",
  md: "Markdown",
  markdown: "Markdown",
};

/** The kind of file, from the extension of the name it was uploaded with. */
export function fileKindOf(fileName: string): FileKind | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return null;
  const extension = fileName.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(KIND_BY_EXTENSION, extension)
    ? KIND_BY_EXTENSION[extension]
    : null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  // Fixed zone: the server and the browser must print the same text.
  timeZone: "UTC",
});

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/** "added …" text, or null when the timestamp cannot be read. */
export function formatAdded(createdAt: string, now: number): string | null {
  const time = Date.parse(createdAt);
  if (Number.isNaN(time)) return null;
  const age = now - time;
  // A clock that is a little behind the server's must not print "in 2 minutes".
  if (age < MINUTE) return "added just now";
  if (age < HOUR) return `added ${plural(Math.floor(age / MINUTE), "minute")}`;
  if (age < DAY) return `added ${plural(Math.floor(age / HOUR), "hour")}`;
  if (age < 30 * DAY) return `added ${plural(Math.floor(age / DAY), "day")}`;
  return `added ${DATE_FORMAT.format(time)}`;
}

export interface DocumentMetaFields {
  status: DocumentStatus;
  originalFilename: string;
  pageCount: number | null;
  createdAt: string;
}

/** Parts of the meta line in display order; empty parts are left out. */
export function documentMetaParts(
  doc: DocumentMetaFields,
  now: number,
): string[] {
  const parts: string[] = [];
  // A page count is only trusted once the document is ready.
  if (doc.status === "ready" && doc.pageCount !== null) {
    parts.push(`${doc.pageCount} ${doc.pageCount === 1 ? "page" : "pages"}`);
  }
  const kind = fileKindOf(doc.originalFilename);
  if (kind) parts.push(kind);
  const added = formatAdded(doc.createdAt, now);
  if (added) parts.push(added);
  return parts;
}

export function documentMeta(doc: DocumentMetaFields, now: number): string {
  return documentMetaParts(doc, now).join(" · ");
}
