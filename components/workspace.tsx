"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { AskPanel } from "@/components/ask-panel";
import { ViewerPanel } from "@/components/viewer-panel";
import { cn } from "@/components/ui/cn";
import { useViewerLocation } from "@/lib/viewer-url/use-viewer-location";
import type { StreamSource } from "@/types/ask-stream";

/**
 * The signed-in home (DESIGN 4.2). From `xl` two columns: the ask column on the
 * left never moves, and the right column holds the shelf or, when the URL names
 * a document, the viewer. Below `xl` it is one column (ask, then shelf) and the
 * viewer is a sheet over it. A citation chip sets `?doc=<id>&page=<n>&chunk=<id>`;
 * the viewer reads it back, so the view survives a refresh and can be shared.
 *
 * The shelf stays mounted while the viewer is open (hidden from `xl` up), so its
 * polling and state survive.
 */
export function Workspace({
  shelf,
  account,
  showExamples,
}: {
  shelf: ReactNode;
  /** Show the example question chips (demo, or no documents of one's own). */
  showExamples: boolean;
  /** Shown under the shelf, below `md` only. */
  account?: ReactNode;
}) {
  const { location, open, setPage, close } = useViewerLocation();
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const viewerOpen = location.status !== "closed";

  // Give focus back to the chip that opened the viewer once it closes.
  useEffect(() => {
    const trigger = triggerRef.current;
    if (wasOpenRef.current && !viewerOpen && trigger?.isConnected) {
      trigger.focus();
    }
    wasOpenRef.current = viewerOpen;
  }, [viewerOpen]);

  function onOpenSource(source: StreamSource, trigger: HTMLElement) {
    triggerRef.current = trigger;
    open({
      documentId: source.documentId,
      page: source.page,
      chunkId: String(source.chunkId),
    });
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl items-start gap-8 xl:max-w-none xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <AskPanel
          onOpenSource={onOpenSource}
          openChunkId={location.status === "open" ? location.chunkId : null}
          showExamples={showExamples}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-6 xl:sticky xl:top-20">
        <div
          className={cn(
            "flex flex-col gap-6 xl:-mx-1 xl:max-h-[calc(100dvh-6.5rem)] xl:overflow-y-auto xl:px-1",
            viewerOpen && "xl:hidden",
          )}
        >
          {shelf}
        </div>
        {location.status === "closed" ? null : (
          <ViewerPanel
            location={location}
            onPageChange={setPage}
            onClose={close}
          />
        )}
        {account}
      </div>
    </div>
  );
}
