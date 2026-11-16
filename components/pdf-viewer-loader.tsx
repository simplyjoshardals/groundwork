"use client";

import dynamic from "next/dynamic";
import { PaperSheet } from "@/components/paper-sheet";
import { ViewerSkeleton } from "@/components/viewer-skeleton";

/**
 * Loads the PDF viewer in the browser only. `ssr: false` is allowed only in a
 * Client Component, which is why this wrapper exists; the viewer touches
 * browser APIs (workers, ResizeObserver) and must never run on the server.
 * While the code chunk loads, the paper skeleton holds the page's place.
 */
export type { HighlightPassage, PdfViewerProps } from "@/components/pdf-viewer";

export const PdfViewer = dynamic(
  () => import("@/components/pdf-viewer").then((module) => module.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="mx-4 my-3 rounded-lg bg-sunken p-3 sm:p-4">
        <PaperSheet>
          <ViewerSkeleton />
        </PaperSheet>
        <p role="status" className="sr-only">
          Loading the viewer…
        </p>
      </div>
    ),
  },
);
