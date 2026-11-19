import { cardClasses } from "@/components/ui/card";
import { fileKindOf } from "@/lib/documents/document-meta";
import { titleFromFileName } from "@/lib/upload/file-checks";

/** A file the person just added, before the shelf has a row for it. */
export interface PendingUpload {
  fileName: string;
  /** Known once the upload has finished and the row exists in the database. */
  documentId: string | null;
}

/**
 * The document being added, shown on the shelf as soon as the file is chosen
 * (U5), so the feedback appears where the document will live. It has the same
 * structure and height as a real row, so the real row replaces it without a
 * jump. It is hidden from assistive technology: the upload control's live
 * region announces the progress, and the real row takes over.
 */
export function PendingRow({ upload }: { upload: PendingUpload }) {
  const kind = fileKindOf(upload.fileName);
  const meta = [kind, upload.documentId ? "added just now" : "uploading"]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      aria-hidden="true"
      className={cardClasses({
        className: "relative flex flex-col gap-1 overflow-hidden",
      })}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 font-medium wrap-break-word">
          {titleFromFileName(upload.fileName)}
        </span>
        <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-control px-2 py-0.5 text-xs font-medium text-muted">
          {upload.documentId ? "Queued" : "Uploading"}
        </span>
      </div>
      <div className="flex min-h-6 items-center">
        <p className="font-mono text-xs text-muted tabular-nums">{meta}</p>
      </div>
      <span className="row-progress">
        <span className="row-progress__bar" />
      </span>
    </li>
  );
}
