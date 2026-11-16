"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PaperSheet } from "@/components/paper-sheet";
import { PassageFallback } from "@/components/passage-fallback";
import { PdfViewer } from "@/components/pdf-viewer-loader";
import type { HighlightPassage } from "@/components/pdf-viewer-loader";
import { TextViewer, type TextPassage } from "@/components/text-viewer";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ViewerFailure } from "@/components/viewer-failure";
import { ViewerSkeleton } from "@/components/viewer-skeleton";
import { ViewerToolbar } from "@/components/viewer-toolbar";
import type { ViewerDocumentResult } from "@/lib/documents/get-viewer-document";
import { selectFallbackPassage } from "@/lib/pdf-highlight/fallback";
import { describeHighlightStatus } from "@/lib/pdf-highlight/messages";
import type { HighlightStatus } from "@/lib/pdf-highlight/plan";
import { useChunkPassage } from "@/lib/pdf-highlight/use-chunk-passage";
import { describeSignedUrlFailure } from "@/lib/pdf-viewer/messages";
import { isTextMimeType } from "@/lib/text-viewer/pages";
import { VIEWER_UNAVAILABLE_MESSAGE } from "@/lib/viewer/messages";
import { realViewerSource, type ViewerSource } from "@/lib/viewer/source";
import type { ViewerLocation } from "@/lib/viewer-url/location";

const PDF_MIME_TYPE = "application/pdf";

/** Looks the document up with the source (the user session); never throws. */
async function lookUpDocument(
  source: ViewerSource,
  documentId: string,
): Promise<ViewerDocumentResult> {
  try {
    return await source.loadDocument(documentId);
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
function useViewerDocument(documentId: string | null, source: ViewerSource) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    key: string;
    result: ViewerDocumentResult;
  } | null>(null);
  const key = documentId === null ? null : `${documentId}#${attempt}`;

  useEffect(() => {
    if (key === null || documentId === null) return;
    let cancelled = false;
    void lookUpDocument(source, documentId).then((result) => {
      if (!cancelled) setSettled({ key, result });
    });
    return () => {
      cancelled = true;
    };
  }, [key, documentId, source]);

  return {
    result: settled !== null && settled.key === key ? settled.result : null,
    retry: () => setAttempt((count) => count + 1),
  };
}

/** Banner text sits in the scroll region, inset like the toolbar. */
function Inset({ children }: { children: ReactNode }) {
  return <div className="px-4 pt-3">{children}</div>;
}

export interface ViewerPanelProps {
  location: Exclude<ViewerLocation, { status: "closed" }>;
  onPageChange: (page: number) => void;
  onClose: () => void;
  /** Where the data comes from. Defaults to the real backend. */
  source?: ViewerSource;
}

/**
 * The inside of the viewer (DESIGN 6.6): a pinned header (title, Close) and one
 * scroll region holding the highlight note or fallback passage, the page
 * toolbar (sticky) and the page on its desk. The shell (docked aside or modal
 * sheet) is `ViewerShell`. Every state is explicit: loading (the paper
 * skeleton), malformed link, not found, lookup error with Retry, a file type
 * with no viewer, and the PDF or text page.
 */
export function ViewerPanel({
  location,
  onPageChange,
  onClose,
  source = realViewerSource,
}: ViewerPanelProps) {
  const documentId = location.status === "open" ? location.documentId : null;
  const { result, retry } = useViewerDocument(documentId, source);

  const viewerDocument = result?.ok === true ? result.document : null;
  const isPdf = viewerDocument?.mimeType === PDF_MIME_TYPE;
  const isText =
    viewerDocument !== null && isTextMimeType(viewerDocument.mimeType);
  // Documents with a viewer (PDF, text, Markdown) load the cited chunk.
  const hasViewer = isPdf || isText;
  const chunkId = location.status === "open" ? location.chunkId : null;
  const { state: chunkState, retry: retryChunk } = useChunkPassage(
    hasViewer ? chunkId : null,
    source.loadChunk,
  );
  const chunk = chunkState.state === "ready" ? chunkState.chunk : null;
  // The chunk id comes from the URL, so a well-formed link can name a chunk
  // of another document: that never highlights.
  const sameDocument =
    chunk !== null && chunk.documentId === viewerDocument?.id;
  const passage = useMemo<HighlightPassage | null>(
    () =>
      chunk !== null && sameDocument
        ? { id: chunk.id, pageNumber: chunk.pageNumber, text: chunk.content }
        : null,
    [chunk, sameDocument],
  );
  // The text viewer also needs the offsets (Task 3.7).
  const textPassage = useMemo<TextPassage | null>(
    () =>
      chunk !== null && sameDocument
        ? {
            id: chunk.id,
            pageNumber: chunk.pageNumber,
            text: chunk.content,
            charStart: chunk.charStart,
            charEnd: chunk.charEnd,
          }
        : null,
    [chunk, sameDocument],
  );

  // What the viewer last reported, with the chunk it was about.
  const [reported, setReported] = useState<{
    chunkId: string;
    status: HighlightStatus;
  } | null>(null);
  const passageId = passage?.id ?? null;
  const onHighlightStatus = useMemo(
    () => (status: HighlightStatus) => {
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
  const note = hasViewer ? describeHighlightStatus(highlightStatus) : null;
  // When the passage could not be pinpointed on its page, show it as text
  // above the page (Task 3.6). `passage` is null for another document's chunk.
  const fallback = hasViewer
    ? selectFallbackPassage(highlightStatus, passage)
    : null;
  // The fallback card says why itself; showing the note too would say it twice.
  const shownNote = fallback === null ? note : null;
  // A link with a chunk will have a note: keep its line reserved from the
  // start so the toolbar below does not move when it arrives.
  const expectsNote = chunkId !== null;

  const page = location.status === "open" ? location.page : 1;

  let body: ReactNode;
  if (location.status === "invalid") {
    body = (
      <Inset>
        <Banner tone="danger">This citation link isn’t valid.</Banner>
      </Inset>
    );
  } else if (result === null) {
    body = (
      <>
        <ViewerToolbar
          page={page}
          total={null}
          previousDisabled
          nextDisabled
          onPrevious={() => {}}
          onNext={() => {}}
        />
        <div className="mx-4 my-3 rounded-lg bg-sunken p-3 sm:p-4">
          <PaperSheet>
            <ViewerSkeleton />
          </PaperSheet>
        </div>
        <p role="status" className="sr-only">
          Opening the document…
        </p>
      </>
    );
  } else if (!result.ok && result.reason === "not_found") {
    // Missing and not-yours look the same on purpose (DESIGN 6.6, D).
    body = (
      <Inset>
        <Banner tone="warn">{VIEWER_UNAVAILABLE_MESSAGE}</Banner>
      </Inset>
    );
  } else if (!result.ok) {
    body = (
      <Inset>
        <ViewerFailure
          message={describeSignedUrlFailure("failed")}
          transient
          onRetry={retry}
        />
      </Inset>
    );
  } else if (isText) {
    body = (
      <TextViewer
        key={result.document.id}
        storagePath={result.document.storagePath}
        page={page}
        onPageChange={onPageChange}
        passage={textPassage}
        onHighlightStatus={onHighlightStatus}
        source={source}
      />
    );
  } else if (!isPdf) {
    body = (
      <Inset>
        <Banner tone="info">
          A preview isn’t available for this file type.
        </Banner>
      </Inset>
    );
  } else {
    body = (
      <PdfViewer
        key={result.document.id}
        storagePath={result.document.storagePath}
        page={page}
        onPageChange={onPageChange}
        passage={passage}
        onHighlightStatus={onHighlightStatus}
        source={source}
      />
    );
  }

  let noteSlot: ReactNode = null;
  if (fallback !== null) {
    noteSlot = <PassageFallback passage={fallback} />;
  } else if (shownNote !== null && shownNote.tone === "error") {
    noteSlot = (
      <ViewerFailure
        message={shownNote.text}
        transient={shownNote.retryable}
        onRetry={shownNote.retryable ? retryChunk : undefined}
      />
    );
  } else if (shownNote !== null || expectsNote) {
    noteSlot = (
      <p role="status" className="min-h-5 text-sm text-muted">
        {shownNote?.text}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
        <h2
          tabIndex={-1}
          data-viewer-title
          className="min-w-0 rounded-sm py-0.5 font-serif text-h3 font-semibold wrap-break-word pointer-coarse:py-2"
        >
          {result === null && location.status === "open" ? (
            <>
              {/* A span, not <Skeleton>: a <div> may not sit inside a heading. */}
              <span
                aria-hidden="true"
                className="skeleton my-1 block h-5 w-48 max-w-full rounded-sm"
              />
              <span className="sr-only">Opening the document</span>
            </>
          ) : (
            (viewerDocument?.title ?? "Document viewer")
          )}
        </h2>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>
      <div
        data-viewer-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {noteSlot === null ? null : <Inset>{noteSlot}</Inset>}
        {body}
      </div>
    </div>
  );
}