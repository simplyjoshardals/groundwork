"use client";

import { useCallback, useEffect, useRef } from "react";

/** Marker and card buttons carry `data-citation-chunk="<chunk id>"`. */
export const CITATION_CHUNK_ATTRIBUTE = "data-citation-chunk";

function findCitation(chunkId: string | null): HTMLElement | null {
  // Digits only: the id goes into a selector.
  if (chunkId === null || !/^\d+$/.test(chunkId)) return null;
  return document.querySelector<HTMLElement>(
    `[${CITATION_CHUNK_ATTRIBUTE}="${chunkId}"]`,
  );
}

/**
 * Gives focus back to the citation that opened the viewer once it closes
 * (DESIGN 4.3). Call the returned function with the button and its chunk id
 * when a citation is opened. If that button is gone by then (the answer was
 * asked again, a list re-rendered), focus goes to the marker or card for the
 * same chunk instead, and to nothing if there is none.
 */
export function useRestoreFocus(
  open: boolean,
): (trigger: HTMLElement, chunkId: string | null) => void {
  const triggerRef = useRef<{ element: HTMLElement; chunkId: string | null } | null>(
    null,
  );
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (wasOpenRef.current && !open && trigger !== null) {
      const target = trigger.element.isConnected
        ? trigger.element
        : findCitation(trigger.chunkId);
      target?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  return useCallback((element: HTMLElement, chunkId: string | null) => {
    triggerRef.current = { element, chunkId };
  }, []);
}
