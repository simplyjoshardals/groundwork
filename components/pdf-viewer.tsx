"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PageTextItem } from "@/lib/pdf-highlight/match";
import "react-pdf/dist/Page/TextLayer.css";
import {
  PAGE_RENDER_ERROR_MESSAGE,
  describeLoadError,
  describeSignedUrlFailure,
} from "@/lib/pdf-viewer/messages";
import {
  marksMatchPassage,
  planHighlight,
  renderPlannedItem,
  toPageTextItems,
  type HighlightPlan,
  type HighlightStatus,
} from "@/lib/pdf-highlight/plan";
import {
  clampPage,
  keyToNavigation,
  pageForAction,
} from "@/lib/pdf-viewer/navigation";
import type { SignedUrlResult } from "@/lib/storage/documents";
import { scrollViewerToTop } from "@/lib/viewer/scroll-to-passage";
import { realViewerSource, type ViewerSource } from "@/lib/viewer/source";
import { useHighlightReveal } from "@/lib/viewer/use-highlight-reveal";
import { PaperSheet } from "@/components/paper-sheet";
import { ViewerFailure } from "@/components/viewer-failure";
import { ViewerSkeleton } from "@/components/viewer-skeleton";
import { ViewerToolbar } from "@/components/viewer-toolbar";

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

/**
 * The canvas is filled with paper, not white, so the page matches the sheet
 * around it. Must equal `--paper` (a CSS variable cannot go to PDF.js).
 */
const PAPER_CANVAS = "#fcfaf4";

/** PDF.js errors that trying again cannot fix. */
const PERMANENT_LOAD_ERRORS = new Set([
  "PasswordException",
  "InvalidPDFException",
  "MissingPDFException",
]);

export interface PdfViewerProps {
  /** Path in the private `documents` bucket, for example `samples/x.pdf`. */
  storagePath: string;
  /** Page to show, 1-based. The parent owns it; out-of-range values clamp. */
  page: number;
  /** Called when the viewer wants another page (buttons, keys, clamping). */
  onPageChange: (page: number) => void;
  /**
   * The cited passage to highlight (Task 3.5), or `null` for none. Keep the
   * object stable between renders: a new identity restarts the matching.
   */
  passage?: HighlightPassage | null;
  /** Reports what happened to the highlight; see `HighlightStatus`. */
  onHighlightStatus?: (status: HighlightStatus) => void;
  /** Where the signed URL comes from. Defaults to the real backend. */
  source?: ViewerSource;
}

export interface HighlightPassage {
  /** `chunks.id`, only to tell one passage from another. */
  id: string;
  /** 1-based page the chunk was cut from; the highlight shows only there. */
  pageNumber: number;
  /** The chunk's text, matched against the page's text layer. */
  text: string;
}

/** Asks the source for a file URL; never throws. */
async function fetchSignedUrl(
  source: ViewerSource,
  storagePath: string,
): Promise<SignedUrlResult> {
  try {
    return await source.createPdfUrl(storagePath);
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
export function PdfViewer({
  storagePath,
  page,
  onPageChange,
  passage = null,
  onHighlightStatus,
  source = realViewerSource,
}: PdfViewerProps) {
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
    /** The PDF.js error name; decides whether Retry can help. */
    name: string;
    message: string;
  } | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  // Height of the last page drawn: kept while the next page loads, so turning
  // a page does not collapse the sheet and jump the scroll position.
  const [renderedHeight, setRenderedHeight] = useState<number | null>(null);
  const pageAreaRef = useRef<HTMLDivElement>(null);
  // Text items of the page on screen, and the result of checking the rendered
  // highlight. Both are keyed, so an answer for another page or passage never
  // counts for the current one.
  const [pageText, setPageText] = useState<{
    key: string;
    items: PageTextItem[];
  } | null>(null);
  const [checked, setChecked] = useState<{ key: string; ok: boolean } | null>(
    null,
  );
  const scrolledKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSignedUrl(source, storagePath).then((result) => {
      if (!cancelled) setUrlResult({ key: requestKey, result });
    });
    return () => {
      cancelled = true;
    };
  }, [source, storagePath, requestKey]);

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

  const currentUrl = urlResult?.key === requestKey ? urlResult.result : null;
  const numPages = loaded?.key === requestKey ? loaded.numPages : null;
  const currentFailure = failure?.key === requestKey ? failure.message : null;

  const shownPage = clampPage(page, numPages ?? Number.POSITIVE_INFINITY);

  // A `page` beyond the document (or below 1) is corrected once the count is known.
  useEffect(() => {
    if (numPages !== null && page !== shownPage) onPageChange(shownPage);
  }, [numPages, page, shownPage, onPageChange]);

  const textKey = `${requestKey}|${shownPage}`;
  const planKey = `${textKey}|${passage?.id ?? ""}`;
  const items = pageText?.key === textKey ? pageText.items : null;

  // Only a unique match highlights (see `findPassage`); everything else declines.
  const plan = useMemo<HighlightPlan | null>(
    () =>
      passage !== null && items !== null && passage.pageNumber === shownPage
        ? planHighlight(items, passage.text)
        : null,
    [passage, items, shownPage],
  );
  const checkedHere = checked?.key === planKey ? checked : null;
  // A highlight the browser did not draw as planned is withdrawn: wrong is
  // worse than none.
  const ranges =
    plan?.status === "highlight" && checkedHere?.ok !== false
      ? plan.ranges
      : null;
  // The wipe: the highlight is drawn hidden, the region scrolls to it, then it
  // grows once (DESIGN 7).
  const { phase, reveal } = useHighlightReveal(
    ranges !== null ? planKey : null,
  );
  const customTextRenderer = useMemo(
    () =>
      ranges === null
        ? undefined
        : (item: { str: string; itemIndex: number }) =>
            renderPlannedItem(ranges, item),
    [ranges],
  );

  // What the text-layer callback needs, kept in a ref so the callback handed
  // to react-pdf stays the same function.
  const latestRef = useRef({ expecting: false, passageText: "", planKey });
  useEffect(() => {
    latestRef.current = {
      expecting: ranges !== null,
      passageText: passage?.text ?? "",
      planKey,
    };
  }, [ranges, passage, planKey]);

  const onTextLayerRendered = useCallback(() => {
    const { expecting, passageText, planKey: key } = latestRef.current;
    if (!expecting) return;
    const marks = Array.from(
      pageAreaRef.current?.querySelectorAll("mark[data-hl]") ?? [],
    );
    const ok = marksMatchPassage(
      passageText,
      marks.map((mark) => mark.textContent ?? ""),
    );
    setChecked((previous) =>
      previous?.key === key && previous.ok === ok ? previous : { key, ok },
    );
    if (ok && scrolledKeyRef.current !== key) {
      scrolledKeyRef.current = key;
      void reveal(marks as HTMLElement[], key);
    }
  }, [reveal]);

  const failed =
    currentFailure !== null || (currentUrl !== null && !currentUrl.ok);
  const status = useMemo<HighlightStatus>(() => {
    if (passage === null || failed) return { state: "none" };
    if (passage.pageNumber !== shownPage) {
      return {
        state: "declined",
        reason: "other_page",
        pageNumber: passage.pageNumber,
      };
    }
    if (plan === null) return { state: "loading" };
    if (plan.status === "declined") {
      return {
        state: "declined",
        reason: plan.reason,
        pageNumber: passage.pageNumber,
      };
    }
    if (checkedHere === null) return { state: "loading" };
    return checkedHere.ok
      ? { state: "highlighted" }
      : {
          state: "declined",
          reason: "render_mismatch",
          pageNumber: passage.pageNumber,
        };
  }, [passage, failed, shownPage, plan, checkedHere]);

  useEffect(() => {
    onHighlightStatus?.(status);
  }, [status, onHighlightStatus]);

  function goTo(next: number) {
    if (next === shownPage) return;
    scrollViewerToTop(pageAreaRef.current);
    onPageChange(next);
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
  const retryable = !(
    currentUrl &&
    !currentUrl.ok &&
    currentUrl.reason === "invalid_path"
  );
  const transient =
    currentUrl && !currentUrl.ok
      ? currentUrl.reason === "failed"
      : !PERMANENT_LOAD_ERRORS.has(
          failure?.key === requestKey ? failure.name : "",
        );
  const ready = numPages !== null && errorMessage === null;
  const pageWidth = Math.min(width ?? MAX_PAGE_WIDTH, MAX_PAGE_WIDTH);

  return (
    <section
      aria-label="PDF viewer"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col focus-visible:-outline-offset-2"
    >
      <ViewerToolbar
        page={shownPage}
        total={numPages}
        previousDisabled={!ready || shownPage <= 1}
        nextDisabled={!ready || numPages === null || shownPage >= numPages}
        onPrevious={() =>
          goTo(pageForAction("previous", shownPage, numPages ?? 1))
        }
        onNext={() => goTo(pageForAction("next", shownPage, numPages ?? 1))}
      />

      {errorMessage !== null ? (
        <div className="px-4 pt-3">
          <ViewerFailure
            message={errorMessage}
            transient={transient}
            onRetry={retryable ? retry : undefined}
          />
        </div>
      ) : (
        <div className="mx-4 my-3 rounded-lg bg-sunken p-3 sm:p-4">
          <div ref={pageAreaRef} className="flex flex-col items-center">
            <PaperSheet
              data-wipe={phase}
              className="w-fit max-w-full"
              style={
                renderedHeight === null
                  ? undefined
                  : { minHeight: renderedHeight }
              }
            >
              {currentUrl === null || !currentUrl.ok ? (
                <ViewerSkeleton width={pageWidth} />
              ) : (
                <Document
                  file={currentUrl.url}
                  options={DOCUMENT_OPTIONS}
                  suspense={false}
                  loading={<ViewerSkeleton width={pageWidth} />}
                  error={null}
                  onLoadSuccess={({ numPages: count }) =>
                    setLoaded({ key: requestKey, numPages: count })
                  }
                  onLoadError={(error) => {
                    // Name only: the message can contain the signed URL.
                    console.error("[pdf-viewer] load failed:", error.name);
                    setFailure({
                      key: requestKey,
                      name: error.name,
                      message: describeLoadError(error.name),
                    });
                  }}
                >
                  <Page
                    pageNumber={shownPage}
                    width={pageWidth}
                    suspense={false}
                    canvasBackground={PAPER_CANVAS}
                    renderAnnotationLayer={false}
                    customTextRenderer={customTextRenderer}
                    onGetTextSuccess={(textContent) => {
                      setPageText({
                        key: textKey,
                        items: toPageTextItems(textContent.items),
                      });
                      setChecked(null);
                    }}
                    onRenderSuccess={(rendered: { height: number }) =>
                      setRenderedHeight(Math.round(rendered.height))
                    }
                    onRenderTextLayerSuccess={onTextLayerRendered}
                    loading={<ViewerSkeleton width={pageWidth} />}
                    error={null}
                    onRenderError={(error) => {
                      console.error("[pdf-viewer] render failed:", error.name);
                      setFailure({
                        key: requestKey,
                        name: error.name,
                        message: PAGE_RENDER_ERROR_MESSAGE,
                      });
                    }}
                  />
                </Document>
              )}
            </PaperSheet>
          </div>
          {ready ? (
            <p className="mt-3 text-xs text-muted">
              Focus the viewer and use the left and right arrow keys to change
              page.
            </p>
          ) : (
            <p role="status" className="sr-only">
              Loading the PDF…
            </p>
          )}
        </div>
      )}
    </section>
  );
}
