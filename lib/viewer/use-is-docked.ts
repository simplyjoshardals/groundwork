"use client";

import { useSyncExternalStore } from "react";

/** Tailwind's `xl`. From here the viewer is docked in the right column (DESIGN 4.3). */
const DOCKED_QUERY = "(min-width: 80rem)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DOCKED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True when the viewer is a docked panel, false when it is a sheet. The server
 * snapshot is `false` (sheet): a closed `<dialog>` draws nothing, so a phone
 * never flashes a docked panel before hydration.
 */
export function useIsDocked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DOCKED_QUERY).matches,
    () => false,
  );
}
