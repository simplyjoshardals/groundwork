"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { PdfViewer } from "@/components/pdf-viewer-loader";
import type { HighlightPassage } from "@/components/pdf-viewer-loader";
import {
  getViewerDocument,
  type ViewerDocumentResult,
} from "@/lib/documents/get-viewer-document";
import { describeHighlightStatus } from "@/lib/pdf-highlight/messages";
import type { HighlightStatus } from "@/lib/pdf-highlight/plan";
import { useChunkPassage } from "@/lib/pdf-highlight/use-chunk-passage";
import { describeSignedUrlFailure } from "@/lib/pdf-viewer/messages";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { ViewerLocation } from "@/lib/viewer-url/location";

const PDF_MIME_TYPE = "application/pdf";

const BUTTON_CLASS =
  "rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium";

/** Looks the document up with the browser (user) session; never throws. */
async function lookUpDocument(
  documentId: string,
): Promise<ViewerDocumentResult> {
  try {
    return await getViewerDocument(createBrowserSupabase(), documentId);
  } catch (error) {
    // Name only: messages could carry configuration details.
    console.error(
      "[viewer-panel] document lookup failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, reason: "failed" };
  }
}

/**
 * Resolves a document id to its record. `result` is `null` while the lookup
 * for the current id (and retry attempt) is running. The result is keyed, so
 * a late answer for an earlier id can never be shown for the current one.
 */
function useViewerDocument(documentId: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    key: string;
    result: ViewerDocumentResult;
  } | null>(null);
  const key = documentId === null ? null : `${documentId}#${attempt}`;

  useEffect(() => {
    if (key === null || documentId === null) return;
    let cancelled = false;
    void lookUpDocument(documentId).then((result) => {
      if (!cancelled) setSettled({ key, result });
    });
    return () => {
      cancelled = true;
    };
  }, [key, documentId]);

  return {
    result: settled !== null && settled.key === key ? settled.result : null,
    retry: () => setAttempt((count) => count + 1),
  };
}

export interface ViewerPanelProps {
  location: Exclude<ViewerLocation, { status: "closed" }>;
  onPageChange: (page: number) => void;
  onClose: () => void;
}

/**
 * Side panel (a full-height sheet on small screens) that shows the document
 * named by the URL. Every state is explicit: loading, malformed link, not
 * found, lookup error with Retry, a file type with no viewer yet, and the PDF.
 */
export function ViewerPanel({
  location,
  onPageChange,
  onClose,
}: ViewerPanelProps) {
  const documentId = location.status === "open" ? location.documentId : null;
  const { result, retry } = useViewerDocument(documentId);
  const panelRef = useRef<HTMLElement | null>(null);

  const viewerDocument = result?.ok === true ? result.document : null;
  const isPdf = viewerDocument?.mimeType === PDF_MIME_TYPE;
  const chunkId = location.status === "open" ? location.chunkId : null;
  const { state: chunkState, retry: retryChunk } = useChunkPassage(
    isPdf ? chunkId : null,
  );
  const chunk = chunkState.state === "ready" ? chunkState.chunk : null;
  // The chunk id comes from the URL, so a well-formed link can name a chunk
  // of another document: that never highlights.
  const sameDocument = chunk !== null && chunk.documentId === viewerDocument?.id;
  const passage = useMemo<HighlightPassage | null>(
    () =>
      chunk !== null && sameDocument
        ? { id: chunk.id, pageNumber: chunk.pageNumber, text: chunk.content }
        : null,
    [chunk, sameDocument],
  );

  // What the viewer last reported, with the chunk it was about.
  const [reported, setReported] = useState<{
    chunkId: string;
    status: HighlightStatus;
  } | null>(null);
  const passageId = passage?.id ?? null;
  const onHighlightStatus = useCallback(
    (status: HighlightStatus) => {
      if (passageId !== null) setReported({ chunkId: passageId, status });
    },
    [passageId],
  );

  let highlightStatus: HighlightStatus;
  if (chunkState.state === "ready") {
    highlightStatus = !sameDocument
      ? { state: "declined", reason: "other_document", pageNumber: null }
      : reported?.chunkId === passageId
        ? reported.status
        : { state: "loading" };
  } else {
    highlightStatus = chunkState;
  }
  const note = isPdf ? describeHighlightStatus(highlightStatus) : null;

  // Move focus into the panel when it opens or switches document, so keyboard
  // and screen-reader users land on it (it is a sheet on small screens).
  useEffect(() => {
    panelRef.current?.focus();
  }, [documentId]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") onClose();
  }

  const title = result?.ok === true ? result.document.title : "Document viewer";

  let body: ReactNode;
  if (location.status === "invalid") {
    body = (
      <p role="alert" className="text-sm text-red-600">
        This citation link is not valid.
      </p>
    );
  } else if (result === null) {
    body = (
      <p role="status" className="text-sm text-neutral-600">
        Opening the document…
      </p>
    );
  } else if (!result.ok && result.reason === "not_found") {
    body = (
      <p role="alert" className="text-sm text-red-600">
        {describeSignedUrlFailure("not_found")}
      </p>
    );
  } else if (!result.ok) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm">
        <p className="text-red-600">{describeSignedUrlFailure("failed")}</p>
        <button type="button" onClick={retry} className={BUTTON_CLASS}>
          Retry
        </button>
      </div>
    );
  } else if (result.document.mimeType !== PDF_MIME_TYPE) {
    // Text and Markdown files get their own viewer in Task 3.7.
    body = (
      <p role="status" className="text-sm text-neutral-600">
        Preview for text and Markdown files is not available yet. The
        document&apos;s title is shown above.
      </p>
    );
  } else {
    body = (
      <PdfViewer
        key={result.document.id}
        storagePath={result.document.storagePath}
        page={location.status === "open" ? location.page : 1}
        onPageChange={onPageChange}
        passage={passage}
        onHighlightStatus={onHighlightStatus}
      />
    );
  }

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label="Document viewer"
      onKeyDown={onKeyDown}
      className="fixed inset-x-0 bottom-0 top-12 z-20 flex flex-col gap-3 overflow-y-auto rounded-t-xl border border-neutral-200 bg-white p-4 shadow-xl outline-none lg:sticky lg:top-6 lg:z-auto lg:max-h-[calc(100vh-3rem)] lg:rounded-xl lg:shadow-none"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 break-words text-sm font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className={BUTTON_CLASS}>
          Close
        </button>
      </div>
      {note === null ? null : (
        <div
          role={note.tone === "error" ? "alert" : "status"}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <p
            className={
              note.tone === "error" ? "text-red-600" : "text-neutral-600"
            }
          >
            {note.text}
          </p>
          {note.retryable ? (
            <button type="button" onClick={retryChunk} className={BUTTON_CLASS}>
              Retry
            </button>
          ) : null}
        </div>
      )}
      {body}
    </aside>
  );
}
