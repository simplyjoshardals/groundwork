"use client";

import dynamic from "next/dynamic";

/**
 * Loads the PDF viewer in the browser only. `ssr: false` is allowed only in a
 * Client Component, which is why this wrapper exists; the viewer touches
 * browser APIs (workers, ResizeObserver) and must never run on the server.
 */
export type { PdfViewerProps } from "@/components/pdf-viewer";

export const PdfViewer = dynamic(
  () => import("@/components/pdf-viewer").then((module) => module.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <p role="status" className="text-sm text-neutral-600">
        Loading viewer…
      </p>
    ),
  },
);
