"use client";

import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { documentMeta } from "@/lib/documents/document-meta";
import type { OwnDocument } from "@/lib/documents/list-own-documents";
import { ingestFailureMessage } from "@/lib/ingest/failure-messages";

export const STUCK_NOTE = "This is taking longer than expected. You can retry it.";

/**
 * One row of the shelf (DESIGN 5.10): title and status badge, then the meta
 * line and the row actions, then at most one note. It is an `<li>`; the list
 * owns the `<ul>`, the polling and the retry logic, and passes the results in.
 *
 * Retry is always visible, because it is the next step on a failed or stuck
 * row. Delete is revealed on hover and focus-within on fine pointers and always
 * visible on touch (opacity only, so nothing moves). A processing row that is
 * not stuck carries the 2 px progress line along its bottom edge. The badge
 * crossfades in place when the status changes; the first paint does not animate.
 */
export function DocumentRow({
  doc,
  now,
  stuck,
  retrying,
  showRetry,
  note,
  onRetry,
  deleteAction,
}: {
  doc: OwnDocument;
  /** The clock of the last successful read, so server and browser agree. */
  now: number;
  stuck: boolean;
  retrying: boolean;
  showRetry: boolean;
  /** The outcome of the last Retry, which explains more than the generic text. */
  note?: string;
  onRetry: () => void;
  deleteAction: ReactNode;
}) {
  // Derive "the status just changed" during render, not in an effect.
  const [shownStatus, setShownStatus] = useState(doc.status);
  const [statusChanged, setStatusChanged] = useState(false);
  if (shownStatus !== doc.status) {
    setShownStatus(doc.status);
    setStatusChanged(true);
  }

  const processing = doc.status === "processing" && !stuck;

  return (
    <li
      className={cardClasses({
        className: "group relative flex flex-col gap-1 overflow-hidden",
      })}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 font-medium wrap-break-word">{doc.title}</span>
        <Badge
          key={doc.status}
          status={doc.status}
          className={cn("shrink-0", statusChanged && "animate-fade-in")}
        />
      </div>

      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3">
        <p className="font-mono text-xs text-muted tabular-nums">
          {documentMeta(doc, now)}
        </p>
        <div className="-mr-2 flex items-center gap-1">
          {showRetry ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={retrying}
              onClick={onRetry}
              aria-label={`Retry ${doc.title}`}
              className="min-w-20"
            >
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          ) : null}
          <div className="transition-opacity duration-(--dur-fast) pointer-fine:opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
            {deleteAction}
          </div>
        </div>
      </div>

      {doc.status === "failed" ? (
        <p className="text-sm text-danger text-pretty">
          {ingestFailureMessage(doc.errorReason)}
        </p>
      ) : null}
      {/* A note from the last Retry explains more than the generic text. */}
      {stuck && doc.status !== "failed" && !retrying && !note ? (
        <p className="text-sm text-muted text-pretty">{STUCK_NOTE}</p>
      ) : null}
      {note ? (
        <p role="status" className="text-sm text-muted text-pretty">
          {note}
        </p>
      ) : null}

      {processing ? (
        <span aria-hidden="true" className="row-progress">
          <span className="row-progress__bar" />
        </span>
      ) : null}
    </li>
  );
}
