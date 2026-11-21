"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import {
  releaseScrollbarWidth,
  reserveScrollbarWidth,
} from "@/lib/viewer/scrollbar-lock";

/** Longest the exit transition may take to report back (`--dur-slow` is 280 ms). */
const EXIT_FALLBACK_MS = 450;
const LABEL = "Document viewer";

export interface ViewerShellProps {
  /** Whether the viewer is wanted. The shell may stay mounted a moment after `false`. */
  open: boolean;
  /** Docked panel (`xl` and up) or modal sheet (below). */
  docked: boolean;
  /** Changes when another document is shown, so focus moves to its title again. */
  focusKey: string;
  onClose: () => void;
  /** The shell has finished leaving; the host may unmount the content now. */
  onExited: () => void;
  children: ReactNode;
}

/** The title is the focus target on open: it names what just appeared. */
function focusTitle(root: HTMLElement | null): void {
  root?.querySelector<HTMLElement>("[data-viewer-title]")?.focus();
}

/**
 * Non-modal panel in the right column (DESIGN 4.3). Escape closes it from
 * anywhere inside it. Its height is fixed, so skeleton to page never resizes it.
 */
function DockedShell({
  open,
  focusKey,
  onClose,
  onExited,
  children,
}: Omit<ViewerShellProps, "docked">) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    // No exit animation here: the shelf takes the column back at once.
    if (!open) onExited();
  }, [open, onExited]);

  useEffect(() => {
    if (open) focusTitle(ref.current);
  }, [open, focusKey]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") onClose();
  }

  if (!open) return null;
  return (
    <aside
      ref={ref}
      aria-label={LABEL}
      onKeyDown={onKeyDown}
      className="animate-fade-in flex h-[calc(100dvh-6.5rem)] flex-col overflow-hidden rounded-xl border border-line bg-surface"
    >
      {children}
    </aside>
  );
}

/**
 * Native modal `<dialog>` (DESIGN 4.3): `showModal()` gives the focus trap and
 * the inert background; Escape, a click on the backdrop and the Close button
 * all go through `onClose`, so the URL stays the one source of truth. The
 * open and close motion is CSS (`dialog.viewer-sheet` in globals.css); on
 * close the shell calls `dialog.close()` and reports `onExited` when the exit
 * transition ends (or after a fallback timer), and only then is the content
 * unmounted. The page scroll is locked in CSS while the dialog is modal, without an
 * undimmed band where the scrollbar was (see `scrollbar-lock.ts`).
 */
function SheetShell({
  open,
  focusKey,
  onClose,
  onExited,
  children,
}: Omit<ViewerShellProps, "docked">) {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  const pressedOnBackdropRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open) {
      if (!dialog.open) {
        // Measure before the page scroll is locked: afterwards the scrollbar is gone.
        reserveScrollbarWidth();
        dialog.showModal();
      }
      return;
    }
    if (dialog.open) dialog.close();
    releaseScrollbarWidth();

    let done = false;
    function finish() {
      if (done) return;
      done = true;
      dialog?.removeEventListener("transitionend", onTransitionEnd);
      clearTimeout(timer);
      onExited();
    }
    function onTransitionEnd(event: TransitionEvent) {
      if (event.target === dialog && event.propertyName === "opacity") finish();
    }
    dialog.addEventListener("transitionend", onTransitionEnd);
    const timer = setTimeout(finish, EXIT_FALLBACK_MS);
    // Opened again before the exit ended: cancel it.
    return () => {
      done = true;
      dialog.removeEventListener("transitionend", onTransitionEnd);
      clearTimeout(timer);
    };
  }, [open, onExited]);

  // A sheet removed while it is open must not leave the width behind.
  useEffect(() => releaseScrollbarWidth, []);

  useEffect(() => {
    if (open) focusTitle(ref.current);
  }, [open, focusKey]);

  // Only a press that starts on the backdrop and ends there closes: dragging
  // a text selection out of the sheet must not.
  function onPointerDown(event: PointerEvent<HTMLDialogElement>) {
    pressedOnBackdropRef.current = event.target === event.currentTarget;
  }

  return (
    <dialog
      ref={ref}
      aria-label={LABEL}
      className="viewer-sheet"
      onCancel={(event) => {
        // Escape. The URL decides, so keep the dialog open until it says so.
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        // Closed by the browser (a second Escape skips `cancel`).
        if (openRef.current) onClose();
      }}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedOnBackdropRef.current) {
          onClose();
        }
      }}
    >
      {children}
    </dialog>
  );
}

export function ViewerShell({ docked, ...props }: ViewerShellProps) {
  return docked ? <DockedShell {...props} /> : <SheetShell {...props} />;
}
