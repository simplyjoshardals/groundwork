"use client";

import { useCallback, useState } from "react";
import { ViewerPanel } from "@/components/viewer-panel";
import { ViewerShell } from "@/components/viewer-shell";
import { useIsDocked } from "@/lib/viewer/use-is-docked";
import type { ViewerSource } from "@/lib/viewer/source";
import type { ViewerLocation } from "@/lib/viewer-url/location";

type OpenLocation = Exclude<ViewerLocation, { status: "closed" }>;

/**
 * Puts the viewer in the right shell for the screen (docked panel from `xl`,
 * modal sheet below) and keeps the last open location while the sheet animates
 * out. The URL closes the viewer the moment it changes, which would unmount it
 * before the exit transition could play; this keeps the content mounted until
 * the shell says it has left.
 *
 * Crossing `xl` while open (rotating, resizing) swaps shells, which reloads the
 * page once. That is rare, so it is accepted.
 */
export function ViewerHost({
  location,
  onPageChange,
  onClose,
  source,
}: {
  location: ViewerLocation;
  onPageChange: (page: number) => void;
  onClose: () => void;
  source?: ViewerSource;
}) {
  const docked = useIsDocked();
  const [shown, setShown] = useState<OpenLocation | null>(null);
  // Derived state: remember the latest open location (set while rendering,
  // the pattern React documents for this).
  if (location.status !== "closed" && location !== shown) setShown(location);
  const clear = useCallback(() => setShown(null), []);

  if (shown === null) return null;
  return (
    <ViewerShell
      open={location.status !== "closed"}
      docked={docked}
      focusKey={shown.status === "open" ? shown.documentId : "invalid"}
      onClose={onClose}
      onExited={clear}
    >
      <ViewerPanel
        location={shown}
        onPageChange={onPageChange}
        onClose={onClose}
        source={source}
      />
    </ViewerShell>
  );
}
