"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { AskPanel } from "@/components/ask-panel";
import { ViewerPanel } from "@/components/viewer-panel";
import { useViewerLocation } from "@/lib/viewer-url/use-viewer-location";
import type { StreamSource } from "@/types/ask-stream";

/**
 * The signed-in home: the ask UI, plus the document viewer when the URL names
 * one. A citation chip sets `?doc=<id>&page=<n>&chunk=<id>`; the viewer reads
 * it back, so the view survives a refresh and can be shared.
 */
export function Workspace({ children }: { children?: ReactNode }) {
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
    <div
      className={
        viewerOpen
          ? "grid items-start gap-6 lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]"
          : undefined
      }
    >
      <div
        className={
          viewerOpen
            ? "flex min-w-0 flex-col gap-6"
            : "mx-auto flex w-full max-w-2xl flex-col gap-6"
        }
      >
        {children}
        <AskPanel onOpenSource={onOpenSource} />
      </div>
      {location.status === "closed" ? null : (
        <ViewerPanel
          location={location}
          onPageChange={setPage}
          onClose={close}
        />
      )}
    </div>
  );
}
