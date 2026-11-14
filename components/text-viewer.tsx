"use client";

import { useEffect, useMemo, useRef } from "react";
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
import type { HighlightStatus } from "@/lib/pdf-highlight/plan";

export type { TextPassage } from "@/lib/text-viewer/pages";

const BUTTON_CLASS =
  "rounded-md border border-control px-3 py-1.5 text-sm font-medium disabled:opacity-50";

export interface TextViewerProps {
  storagePath: string;
  /** 1-based virtual page, controlled by the URL. Clamped to the file's pages. */
  page: number;
  onPageChange: (page: number) => void;
  /** The cited passage, or `null` (none in the link, or another document's). */
  passage: TextPassage | null;
  onHighlightStatus: (status: HighlightStatus) => void;
}

/**
 * Viewer for `.txt` and `.md` files (Task 3.7). The file is shown as inert
 * text: React text nodes only, so Markdown is never parsed or rendered and
 * HTML inside a file can never run. The cited range is highlighted by its
 * stored offsets, but only after the exactness check in `planTextHighlight`.
 */
export function TextViewer({
  storagePath,
  page,
  onPageChange,
  passage,
  onHighlightStatus,
}: TextViewerProps) {
  const { state, retry } = useTextPages(storagePath);
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

  // Scroll the highlight into view each time it appears, but not on every
  // re-render, so a resize or an unrelated update does not keep jumping.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLElement | null>(null);
  const scrolledFor = useRef<string | null>(null);
  const highlighted = plan?.status === "highlight";
  const passageId = passage?.id ?? null;
  useEffect(() => {
    if (!highlighted || passageId === null) {
      // Not drawn (another page, a decline): scroll again when it returns.
      scrolledFor.current = null;
      return;
    }
    if (scrolledFor.current === passageId) return;
    const container = containerRef.current;
    const mark = markRef.current;
    if (container === null || mark === null) return;
    scrolledFor.current = passageId;
    // Scroll only the text box (not the whole window): centre the mark, or
    // align its top when it is taller than the box.
    const markRect = mark.getBoundingClientRect();
    const boxRect = container.getBoundingClientRect();
    const spare = Math.max(0, (container.clientHeight - markRect.height) / 2);
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({
      top: container.scrollTop + (markRect.top - boxRect.top) - spare,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [highlighted, passageId]);

  if (state.state === "loading") {
    return (
      <p role="status" className="text-sm text-muted">
        Loading the document…
      </p>
    );
  }
  if (state.state === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm">
        <p className="text-danger">{describeTextFileFailure(state.reason)}</p>
        {isRetryableTextFailure(state.reason) ? (
          <button type="button" onClick={retry} className={BUTTON_CLASS}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  if (state.pages.length === 0) {
    return (
      <p role="status" className="text-sm text-muted">
        This document has no text to show.
      </p>
    );
  }

  const pageCount = state.pages.length;
  const pageText = state.pages[shownPage - 1] ?? "";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <button
          type="button"
          onClick={() => onPageChange(shownPage - 1)}
          disabled={shownPage <= 1}
          className={BUTTON_CLASS}
        >
          Previous
        </button>
        <p aria-live="polite" className="text-ink">
          Page {shownPage} of {pageCount}
        </p>
        <button
          type="button"
          onClick={() => onPageChange(shownPage + 1)}
          disabled={shownPage >= pageCount}
          className={BUTTON_CLASS}
        >
          Next
        </button>
      </div>
      {/* Focusable so keyboard users can scroll the text. */}
      <div
        ref={containerRef}
        tabIndex={0}
        role="region"
        aria-label={`Document text, page ${shownPage}`}
        className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line p-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {plan !== null && plan.status === "highlight" ? (
          <>
            {plan.before}
            <mark
              ref={markRef}
              className="rounded-sm bg-highlight-soft text-ink"
            >
              {plan.match}
            </mark>
            {plan.after}
          </>
        ) : (
          pageText
        )}
      </div>
    </div>
  );
}
