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
 * Retry and Delete are always visible: Retry is the next step on a failed or
 * stuck row, and a hidden Delete is hard to find and was not reliable across
 * devices. The actions sit at the right end of the meta line and drop to their
 * own right-aligned line when it is too long (360 px). A processing row that is
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
  onActiveChange,
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
  /** Pointer or keyboard focus is on the row: the shelf strip lifts its spine. */
  onActiveChange?: (active: boolean) => void;
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
      onMouseEnter={() => onActiveChange?.(true)}
      onMouseLeave={() => onActiveChange?.(false)}
      onFocus={() => onActiveChange?.(true)}
      onBlur={() => onActiveChange?.(false)}
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

      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p className="flex h-6 items-center font-mono text-xs text-muted tabular-nums">
          {documentMeta(doc, now)}
        </p>
        {/* 24 px tall like the meta line, so the line is the same height with or
            without actions beside it; the 32 px buttons overflow it evenly. */}
          <div className="-mr-2 ml-auto flex h-6 items-center gap-1">
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
          {deleteAction}
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
