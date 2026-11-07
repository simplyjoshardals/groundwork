"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import {
  PAGE_RENDER_ERROR_MESSAGE,
  describeLoadError,
  describeSignedUrlFailure,
} from "@/lib/pdf-viewer/messages";
import {
  clampPage,
  keyToNavigation,
  pageForAction,
} from "@/lib/pdf-viewer/navigation";
import {
  createDocumentSignedUrl,
  type SignedUrlResult,
} from "@/lib/storage/documents";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// The worker must be configured in the same module that renders <Document>.
// This `new URL(..., import.meta.url)` form is the one Turbopack bundles, and
// it was verified with `next build` + `next start` in spike 0.7.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/**
 * Fetch the whole file in one request instead of lazy byte ranges. Files are
 * capped at 5 MiB, and this way the short-lived signed URL cannot expire
 * halfway through a long session (see `DEFAULT_SIGNED_URL_TTL_SECONDS`). Kept
 * as a module constant: react-pdf reloads the document when `options` changes
 * identity.
 */
const DOCUMENT_OPTIONS = { disableRange: true, disableStream: true };

const MAX_PAGE_WIDTH = 900;

const BUTTON_CLASS =
  "rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:opacity-60";

export interface PdfViewerProps {
  /** Path in the private `documents` bucket, for example `samples/x.pdf`. */
  storagePath: string;
  /** Page to show, 1-based. The parent owns it; out-of-range values clamp. */
  page: number;
  /** Called when the viewer wants another page (buttons, keys, clamping). */
  onPageChange: (page: number) => void;
}

/** Asks for a signed URL with the browser (user) session; never throws. */
async function fetchSignedUrl(storagePath: string): Promise<SignedUrlResult> {
  try {
    return await createDocumentSignedUrl(createBrowserSupabase(), storagePath);
  } catch (error) {
    // Name only: messages could carry configuration details.
    console.error(
      "[pdf-viewer] signed URL request failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return {
      ok: false,
      reason: "failed",
      message: "Could not request a signed URL.",
    };
  }
}

/**
 * Client-only PDF viewer with page navigation (Task 3.2). Load it through
 * `components/pdf-viewer-loader.tsx`, never import it from a Server Component.
 *
 * Results are stored together with the request they belong to, so a Retry or a
 * new `storagePath` starts clean without resetting state inside an effect.
 */
export function PdfViewer({ storagePath, page, onPageChange }: PdfViewerProps) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${storagePath}#${attempt}`;

  const [urlResult, setUrlResult] = useState<{
    key: string;
    result: SignedUrlResult;
  } | null>(null);
  const [loaded, setLoaded] = useState<{
    key: string;
    numPages: number;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const pageAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSignedUrl(storagePath).then((result) => {
      if (!cancelled) setUrlResult({ key: requestKey, result });
    });
    return () => {
      cancelled = true;
    };
  }, [storagePath, requestKey]);

  useEffect(() => {
    const element = pageAreaRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(Math.floor(next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const currentUrl =
    urlResult?.key === requestKey ? urlResult.result : null;
  const numPages = loaded?.key === requestKey ? loaded.numPages : null;
  const currentFailure = failure?.key === requestKey ? failure.message : null;

  const shownPage = clampPage(page, numPages ?? Number.POSITIVE_INFINITY);

  // A `page` beyond the document (or below 1) is corrected once the count is known.
  useEffect(() => {
    if (numPages !== null && page !== shownPage) onPageChange(shownPage);
  }, [numPages, page, shownPage, onPageChange]);

  function goTo(next: number) {
    if (next !== shownPage) onPageChange(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (numPages === null) return;
    const action = keyToNavigation(event);
    if (!action) return;
    event.preventDefault();
    goTo(pageForAction(action, shownPage, numPages));
  }

  function retry() {
    setAttempt((value) => value + 1);
  }

  const errorMessage =
    currentUrl && !currentUrl.ok
      ? describeSignedUrlFailure(currentUrl.reason)
      : currentFailure;
  const retryable =
    !(currentUrl && !currentUrl.ok && currentUrl.reason === "invalid_path");
  const ready = numPages !== null && errorMessage === null;
  const pageWidth = Math.min(width ?? MAX_PAGE_WIDTH, MAX_PAGE_WIDTH);

  return (
    <section
      aria-label="PDF viewer"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Previous page"
          disabled={!ready || shownPage <= 1}
          onClick={() => goTo(pageForAction("previous", shownPage, numPages ?? 1))}
          className={BUTTON_CLASS}
        >
          Previous
        </button>
        <p aria-live="polite" className="text-sm text-neutral-600">
          {numPages === null
            ? "Page " + shownPage
            : `Page ${shownPage} of ${numPages}`}
        </p>
        <button
          type="button"
          aria-label="Next page"
          disabled={!ready || numPages === null || shownPage >= numPages}
          onClick={() => goTo(pageForAction("next", shownPage, numPages ?? 1))}
          className={BUTTON_CLASS}
        >
          Next
        </button>
      </div>

      <div ref={pageAreaRef} className="overflow-auto">
        {errorMessage !== null ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm">
            <p className="text-red-600">{errorMessage}</p>
            {retryable ? (
              <button type="button" onClick={retry} className={BUTTON_CLASS}>
                Retry
              </button>
            ) : null}
          </div>
        ) : currentUrl === null ? (
          <p role="status" className="text-sm text-neutral-600">
            Loading PDF…
          </p>
        ) : currentUrl.ok ? (
          <Document
            file={currentUrl.url}
            options={DOCUMENT_OPTIONS}
            suspense={false}
            loading={
              <p role="status" className="text-sm text-neutral-600">
                Loading PDF…
              </p>
            }
            error={null}
            onLoadSuccess={({ numPages: count }) =>
              setLoaded({ key: requestKey, numPages: count })
            }
            onLoadError={(error) => {
              // Name only: the message can contain the signed URL.
              console.error("[pdf-viewer] load failed:", error.name);
              setFailure({
                key: requestKey,
                message: describeLoadError(error.name),
              });
            }}
          >
            <Page
              pageNumber={shownPage}
              width={pageWidth}
              suspense={false}
              renderAnnotationLayer={false}
              loading={
                <p role="status" className="text-sm text-neutral-600">
                  Loading page…
                </p>
              }
              error={null}
              onRenderError={(error) => {
                console.error("[pdf-viewer] render failed:", error.name);
                setFailure({
                  key: requestKey,
                  message: PAGE_RENDER_ERROR_MESSAGE,
                });
              }}
            />
          </Document>
        ) : null}
      </div>

      {ready ? (
        <p className="text-xs text-neutral-500">
          Focus the viewer and use the left and right arrow keys to change page.
        </p>
      ) : null}
    </section>
  );
}
