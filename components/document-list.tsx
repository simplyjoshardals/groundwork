"use client";

import { useEffect, useRef, useState } from "react";
import { DeleteDocumentButton } from "@/components/delete-document-button";
import {
  canRetry,
  isInFlight,
  isStuck,
  pollDelayMs,
  statusSignature,
  type DocumentStatus,
} from "@/lib/documents/document-status";
import {
  listOwnDocuments,
  type ListOwnDocumentsResult,
  type OwnDocument,
} from "@/lib/documents/list-own-documents";
import { ingestFailureMessage } from "@/lib/ingest/failure-messages";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { retryLimitMessage } from "@/lib/upload/ingest-limit";
import { requestIngest } from "@/lib/upload/request-ingest";

const BADGE_LABEL: Record<DocumentStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

const BADGE_CLASS: Record<DocumentStatus, string> = {
  queued: "border-control text-ink",
  processing: "border-accent text-accent",
  ready: "border-accent text-accent",
  failed: "border-danger text-danger",
};

/** Never throws: a missing public env var is reported like any other failed read. */
async function load(): Promise<ListOwnDocumentsResult> {
  try {
    return await listOwnDocuments(createBrowserSupabase());
  } catch (error) {
    console.warn(
      "[documents] could not create the browser client:",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, reason: "failed" };
  }
}

/**
 * The signed-in user's documents with live status (Task 4.6). Reads through the
 * browser client, so RLS decides what is visible. While any row can still
 * change by itself it polls with the backoff in `document-status.ts`, one
 * request at a time, and it stops once everything is `ready`, `failed` or
 * stuck (a stuck row shows Retry instead of polling forever).
 *
 * `refreshKey` is bumped by the parent (after an upload and after its ingest
 * call returns): a new value restarts the schedule and reloads at once.
 */
export function DocumentList({
  refreshKey,
  onCountChange,
}: {
  refreshKey: number;
  /** Called with the number of documents after each successful load (Task 4.8). */
  onCountChange?: (count: number) => void;
}) {
  const [documents, setDocuments] = useState<OwnDocument[] | null>(null);
  /** Time of the last successful read: the clock the stuck rules use. */
  const [now, setNow] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  // Read by the polling loop, which must not restart when a retry starts.
  const retryingRef = useRef<ReadonlySet<string>>(new Set());
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let lastSignature: string | null = null;

    async function tick() {
      const result = await load();
      if (cancelled) return;

      if (result.ok) {
        const readAt = Date.now();
        hasLoadedRef.current = true;
        setDocuments(result.documents);
        setNow(readAt);
        setLoadFailed(false);

        const signature = statusSignature(result.documents);
        // Any status change means something is moving: poll quickly again.
        if (lastSignature !== null && signature !== lastSignature) attempt = 0;
        lastSignature = signature;

        const moving =
          result.documents.some((d) => isInFlight(d, readAt)) ||
          retryingRef.current.size > 0;
        if (!moving) return;
      } else {
        setLoadFailed(true);
        // Nothing to show and nothing known to be moving: wait for the user.
        if (!hasLoadedRef.current) return;
      }

      timer = setTimeout(() => void tick(), pollDelayMs(attempt));
      attempt += 1;
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [refreshKey, retryToken]);

  useEffect(() => {
    if (documents !== null) onCountChange?.(documents.length);
  }, [documents, onCountChange]);

  function setRetryingIds(next: ReadonlySet<string>) {
    retryingRef.current = next;
    setRetrying(next);
  }

  async function onRetry(documentId: string) {
    if (retryingRef.current.has(documentId)) return;
    setRetryingIds(new Set(retryingRef.current).add(documentId));
    setNotes((prev) => {
      const rest = { ...prev };
      delete rest[documentId];
      return rest;
    });
    // Restart the schedule now: the row turns `processing` once the server
    // claims it, and the request below only answers when processing ends.
    setRetryToken((n) => n + 1);

    const result = await requestIngest(documentId);

    const next = new Set(retryingRef.current);
    next.delete(documentId);
    setRetryingIds(next);

    if (result.status === "no_op") {
      setNotes((prev) => ({
        ...prev,
        [documentId]: "This document is still being processed.",
      }));
    } else if (result.status === "unconfirmed") {
      setNotes((prev) => ({
        ...prev,
        [documentId]:
          "We could not confirm the retry went through. It may still complete.",
      }));
    } else if (result.status === "limit") {
      // Refused by a usage limit (Task 5.3): nothing was claimed, so say why
      // and when instead of leaving the stale-row text alone.
      setNotes((prev) => ({
        ...prev,
        [documentId]: retryLimitMessage({
          reason: result.reason,
          resetsAt: result.resetsAt,
        }),
      }));
    }
    setRetryToken((n) => n + 1);
  }

  return (
    <section aria-labelledby="documents-heading" className="text-sm">
      <h2 id="documents-heading" className="font-medium">
        Your documents
      </h2>

      {documents === null && !loadFailed ? (
        <p role="status" className="mt-2 text-muted">
          Loading your documents…
        </p>
      ) : null}

      {documents === null && loadFailed ? (
        <div role="alert" className="mt-2 text-danger">
          <p>We could not load your documents.</p>
          <button
            type="button"
            onClick={() => setRetryToken((n) => n + 1)}
            className="mt-1 underline"
          >
            Try again
          </button>
        </div>
      ) : null}

      {documents !== null && loadFailed ? (
        <p role="status" className="mt-2 text-warn">
          Could not refresh. Showing the last list we have.{" "}
          <button
            type="button"
            onClick={() => setRetryToken((n) => n + 1)}
            className="underline"
          >
            Try again
          </button>
        </p>
      ) : null}

      {documents !== null && documents.length === 0 ? (
        <p className="mt-2 text-muted">
          No documents yet. Upload a PDF, TXT or Markdown file to get started.
        </p>
      ) : null}

      {documents !== null && documents.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {documents.map((doc) => {
            const isRetrying = retrying.has(doc.id);
            const stuck = isStuck(doc, now);
            const showRetry = canRetry(doc, now) || isRetrying;
            const note = doc.status === "ready" ? undefined : notes[doc.id];
            return (
              <li
                key={doc.id}
                className="rounded-md border border-line p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 wrap-break-word font-medium">
                    {doc.title}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${BADGE_CLASS[doc.status]}`}
                  >
                    {BADGE_LABEL[doc.status]}
                  </span>
                  {doc.status === "ready" && doc.pageCount !== null ? (
                    <span className="text-xs text-muted">
                      {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
                    </span>
                  ) : null}
                </div>

                {doc.status === "failed" ? (
                  <p className="mt-1 text-danger">
                    {ingestFailureMessage(doc.errorReason)}
                  </p>
                ) : null}
                {/* A note from the last Retry explains more than the generic text. */}
                {stuck && doc.status !== "failed" && !isRetrying && !note ? (
                  <p className="mt-1 text-ink">
                    This is taking longer than expected. You can retry it.
                  </p>
                ) : null}
                {note ? (
                  <p role="status" className="mt-1 text-ink">
                    {note}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {showRetry ? (
                    <button
                      type="button"
                      disabled={isRetrying}
                      onClick={() => void onRetry(doc.id)}
                      className="rounded-md border border-control px-3 py-1 disabled:opacity-60"
                    >
                      {isRetrying ? "Retrying…" : "Retry"}
                    </button>
                  ) : null}
                  {/* Any status, including processing: ingestion then fails cleanly (Task 4.7). */}
                  <DeleteDocumentButton
                    documentId={doc.id}
                    documentTitle={doc.title}
                    onDeleted={() => setRetryToken((n) => n + 1)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
