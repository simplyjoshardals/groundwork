"use client";

import { useEffect, useMemo, useRef } from "react";
import { PaperSheet } from "@/components/paper-sheet";
import { Banner } from "@/components/ui/banner";
import { ViewerFailure } from "@/components/viewer-failure";
import { ViewerSkeleton } from "@/components/viewer-skeleton";
import { ViewerToolbar } from "@/components/viewer-toolbar";
import {
  describeTextFileFailure,
  isRetryableTextFailure,
} from "@/lib/text-viewer/messages";
import {
  clampPage,
  planTextHighlight,
  toHighlightStatus,
  type TextPassage,
} from "@/lib/text-viewer/pages";
import { useTextPages } from "@/lib/text-viewer/use-text-pages";
import { scrollViewerToTop } from "@/lib/viewer/scroll-to-passage";
import { realViewerSource, type ViewerSource } from "@/lib/viewer/source";
import { useHighlightReveal } from "@/lib/viewer/use-highlight-reveal";
import type { HighlightStatus } from "@/lib/pdf-highlight/plan";

export type { TextPassage } from "@/lib/text-viewer/pages";

export interface TextViewerProps {
  storagePath: string;
  /** 1-based virtual page, controlled by the URL. Clamped to the file's pages. */
  page: number;
  onPageChange: (page: number) => void;
  /** The cited passage, or `null` (none in the link, or another document's). */
  passage: TextPassage | null;
  onHighlightStatus: (status: HighlightStatus) => void;
  /** Where the file comes from. Defaults to the real backend. */
  source?: ViewerSource;
}

/**
 * Viewer for `.txt` and `.md` files (Task 3.7). The file is shown as inert
 * text: React text nodes only, so Markdown is never parsed or rendered and
 * HTML inside a file can never run. It sits on the same paper sheet and desk
 * as a PDF page, so the highlight (`mark[data-hl]`) and its wipe are defined
 * once. The cited range is highlighted by its stored offsets, but only after
 * the exactness check in `planTextHighlight`.
 */
export function TextViewer({
  storagePath,
  page,
  onPageChange,
  passage,
  onHighlightStatus,
  source = realViewerSource,
}: TextViewerProps) {
  const { state, retry } = useTextPages(storagePath, source.loadText);
  const pages = state.state === "ready" ? state.pages : null;
  const shownPage = clampPage(page, pages?.length ?? 0);

  const plan = useMemo(
    () =>
      pages === null ? null : planTextHighlight(pages, shownPage, passage),
    [pages, shownPage, passage],
  );

  // Tell the panel what happened. While loading nothing is reported (the
  // panel shows "finding the passage"). A file that failed to load is
  // reported as `none`: the viewer shows its own error with its own Retry,
  // and the panel's note would only repeat it.
  const failed = state.state === "error";
  useEffect(() => {
    if (plan !== null) onHighlightStatus(toHighlightStatus(plan));
    else if (failed) onHighlightStatus({ state: "none" });
  }, [plan, failed, onHighlightStatus]);

  // The wipe (DESIGN 7): scroll the region to the mark once it appears, then
  // let it grow. Not on every re-render, so a resize does not keep jumping.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLElement | null>(null);
  const revealedFor = useRef<string | null>(null);
  const highlighted = plan?.status === "highlight";
  const passageId = passage?.id ?? null;
  const { phase, reveal } = useHighlightReveal(
    highlighted ? passageId : null,
  );
  useEffect(() => {
    if (!highlighted || passageId === null) {
      // Not drawn (another page, a decline): reveal again when it returns.
      revealedFor.current = null;
      return;
    }
    if (revealedFor.current === passageId) return;
    const mark = markRef.current;
    if (mark === null) return;
    revealedFor.current = passageId;
    void reveal([mark], passageId);
  }, [highlighted, passageId, reveal]);

  const pageCount = pages?.length ?? null;
  const emptyFile = pages !== null && pages.length === 0;

  function goTo(next: number) {
    if (next === shownPage) return;
    scrollViewerToTop(sheetRef.current);
    onPageChange(next);
  }

  if (state.state === "error") {
    return (
      <div className="px-4 pt-3">
        <ViewerFailure
          message={describeTextFileFailure(state.reason)}
          transient={state.reason === "failed"}
          onRetry={isRetryableTextFailure(state.reason) ? retry : undefined}
        />
      </div>
    );
  }
  if (emptyFile) {
    return (
      <div className="px-4 pt-3">
        <Banner tone="info">This document has no text to show.</Banner>
      </div>
    );
  }

  const pageText = pages?.[shownPage - 1] ?? "";

  return (
    <div className="flex flex-col">
      <ViewerToolbar
        page={shownPage}
        total={pageCount}
        previousDisabled={pages === null || shownPage <= 1}
        nextDisabled={pages === null || shownPage >= (pageCount ?? 1)}
        onPrevious={() => goTo(shownPage - 1)}
        onNext={() => goTo(shownPage + 1)}
      />
      <div className="mx-4 my-3 rounded-lg bg-sunken p-3 sm:p-4">
        <PaperSheet ref={sheetRef} data-wipe={phase}>
          {pages === null ? (
            <>
              <ViewerSkeleton />
              <p role="status" className="sr-only">
                Loading the document…
              </p>
            </>
          ) : (
            // Focusable so keyboard users can reach and scroll the text.
            <div
              tabIndex={0}
              role="region"
              aria-label={`Document text, page ${shownPage}`}
              className="rounded-sm p-4 font-serif text-base leading-7 break-words whitespace-pre-wrap text-paper-ink focus-visible:-outline-offset-2"
            >
              {plan !== null && plan.status === "highlight" ? (
                <>
                  {plan.before}
                  <mark ref={markRef} data-hl="">
                    {plan.match}
                  </mark>
                  {plan.after}
                </>
              ) : (
                pageText
              )}
            </div>
          )}
        </PaperSheet>
      </div>
    </div>
  );
}
