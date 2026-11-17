"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DeleteDocumentButton } from "@/components/delete-document-button";
import { DocumentRow } from "@/components/document-row";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  canRetry,
  isInFlight,
  isStuck,
  pollDelayMs,
  statusSignature,
} from "@/lib/documents/document-status";
import type { OwnDocument } from "@/lib/documents/list-own-documents";
import { useDocumentsSource } from "@/lib/documents/source";
import { useOnlineStatus } from "@/lib/net/use-online-status";
import { retryLimitMessage } from "@/lib/upload/ingest-limit";

/** What the server read before the page was sent (U2). */
export type InitialDocuments =
  | { ok: true; documents: OwnDocument[]; fetchedAt: number }
  | { ok: false };

const HEADING_ID = "documents-heading";

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
  initial,
  aboveList,
}: {
  refreshKey: number;
  /** Called with the number of documents after each successful load (Task 4.8). */
  onCountChange?: (count: number) => void;
  /**
   * The server's first read (U2), so the shelf has no loading flash. `ok`
   * documents seed the list and the first client read waits for the poll
   * schedule; a failed server read shows the error state until Try again.
   * Omit it to load on mount, as before.
   */
  initial?: InitialDocuments;
  /**
   * Rendered between the heading and the list (U5): the upload control, so the
   * shelf reads heading, dropzone, documents, and the dropzone never moves.
   */
  aboveList?: ReactNode;
}) {
  const source = useDocumentsSource();
  const toast = useToast();
  const online = useOnlineStatus();
  /** Set by a delete; the focus moves to the heading once the row is gone. */
  const focusHeadingRef = useRef(false);
  const [documents, setDocuments] = useState<OwnDocument[] | null>(
    initial?.ok ? initial.documents : null,
  );
  /** Time of the last successful read: the clock the stuck rules use. */
  const [now, setNow] = useState(initial?.ok ? initial.fetchedAt : 0);
  const [loadFailed, setLoadFailed] = useState(initial?.ok === false);
  const [retryToken, setRetryToken] = useState(0);
  /** True from a click on "Try again" until that read finishes. */
  const [reloading, setReloading] = useState(false);
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  // Read by the polling loop, which must not restart when a retry starts.
  const retryingRef = useRef<ReadonlySet<string>>(new Set());
  const hasLoadedRef = useRef(initial?.ok === true);
  // The server's read stands in for the first client read, once.
  const initialRef = useRef(initial);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let lastSignature: string | null = null;

    async function tick() {
      const result = await source.list();
      if (cancelled) return;
      setReloading(false);

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

    const seed = initialRef.current;
    initialRef.current = undefined;
    if (seed !== undefined) {
      if (!seed.ok) return; // The error state is showing; Try again reloads.
      lastSignature = statusSignature(seed.documents);
      const moving = seed.documents.some((d) => isInFlight(d, seed.fetchedAt));
      if (moving) {
        timer = setTimeout(() => void tick(), pollDelayMs(attempt));
        attempt += 1;
      }
    } else {
      void tick();
    }
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [refreshKey, retryToken, source]);

  useEffect(() => {
    if (documents !== null) onCountChange?.(documents.length);
  }, [documents, onCountChange]);

  useEffect(() => {
    // The delete button went away with its row: keep the keyboard user's place.
    if (!focusHeadingRef.current) return;
    focusHeadingRef.current = false;
    document.getElementById(HEADING_ID)?.focus();
  }, [documents]);

  function onDeleted(documentId: string) {
    // Remove the row now and reconcile with a read, so the shelf never shows a
    // document the person just deleted while that read is in flight.
    setDocuments((prev) =>
      prev === null ? prev : prev.filter((d) => d.id !== documentId),
    );
    focusHeadingRef.current = true;
    toast.show("Document deleted");
    setRetryToken((n) => n + 1);
  }

  function reload() {
    setReloading(true);
    setRetryToken((n) => n + 1);
  }

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

    const result = await source.ingest(documentId);

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

  const stale = documents !== null && (loadFailed || !online);
  const tryAgain = (
    <Button
      variant="secondary"
      size="sm"
      disabled={reloading}
      onClick={reload}
      className="min-w-24"
    >
      {reloading ? "Trying…" : "Try again"}
    </Button>
  );

  return (
    <section
      aria-labelledby={HEADING_ID}
      aria-busy={documents === null && !loadFailed}
      className="flex flex-col gap-4 text-sm"
    >
      <h2 id={HEADING_ID} tabIndex={-1} className="font-serif text-h3">
        Your documents
      </h2>

      {aboveList}

      {documents === null && !loadFailed ? (
        <div role="status">
          <span className="sr-only">Loading your documents</span>
          {/* Same structure as a real row, so nothing jumps when they arrive. */}
          <ul aria-hidden="true" className="flex flex-col gap-2">
            {[0, 1, 2].map((n) => (
              <li
                key={n}
                className={cardClasses({ className: "flex flex-col gap-1" })}
              >
                <div className="flex h-6 items-center justify-between gap-3">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton shape="pill" className="h-5 w-16" />
                </div>
                <div className="flex min-h-8 items-center">
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {documents === null && loadFailed ? (
        <Banner tone="danger" action={tryAgain}>
          We couldn&apos;t load your documents.
        </Banner>
      ) : null}

      {stale ? (
        <Banner tone="warn" action={tryAgain}>
          Couldn&apos;t refresh. Showing the last list we have.
        </Banner>
      ) : null}

      {documents !== null && documents.length === 0 ? (
        <div className={cardClasses({ padding: "roomy" })}>
          <p className="font-serif text-h3">Nothing on the shelf yet.</p>
          <p className="mt-1 text-muted text-pretty">
            Add a PDF, text, or Markdown file. Answers will cite the exact page.
          </p>
        </div>
      ) : null}

      {documents !== null && documents.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => {
            const isRetrying = retrying.has(doc.id);
            return (
              <DocumentRow
                key={doc.id}
                doc={doc}
                now={now}
                stuck={isStuck(doc, now)}
                retrying={isRetrying}
                showRetry={canRetry(doc, now) || isRetrying}
                note={doc.status === "ready" ? undefined : notes[doc.id]}
                onRetry={() => void onRetry(doc.id)}
                deleteAction={
                  <DeleteDocumentButton
                    documentId={doc.id}
                    documentTitle={doc.title}
                    onDeleted={() => onDeleted(doc.id)}
                  />
                }
              />
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}