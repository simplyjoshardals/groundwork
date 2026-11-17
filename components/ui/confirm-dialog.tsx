"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Banner } from "./banner";
import { Button } from "./button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** One sentence of consequence (DESIGN 5.7). */
  children: ReactNode;
  confirmLabel: string;
  /** Swapped in for `confirmLabel` while `busy`. Keep it the same width class. */
  busyLabel: string;
  cancelLabel: string;
  busy?: boolean;
  /** A failure from the last attempt. The dialog stays open so it can be retried. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Native `<dialog>` with `showModal()` (DESIGN 5.7): focus trap, inert
 * background and Escape come from the platform. Initial focus is the safe
 * action (Cancel, first in the DOM and `autoFocus`). Focus returns to the
 * element that was focused when it opened, if that element is still there.
 * `open` drives the dialog, so Escape and Cancel both end up in `onCancel` and
 * the parent stays the source of truth. There is no backdrop-click close: for
 * a destructive confirmation, a stray click should not decide anything.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusTo.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      const target = returnFocusTo.current;
      returnFocusTo.current = null;
      if (target?.isConnected) target.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        // Escape: let the parent close it, and never while a request is running.
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className="confirm-dialog m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-line bg-raised p-6 text-ink shadow-pop backdrop:bg-ink/40"
    >
      <h2 id={titleId} className="font-serif text-h3 wrap-break-word">
        {title}
      </h2>
      <p id={descriptionId} className="mt-2 text-sm text-pretty">
        {children}
      </p>
      {error ? (
        <Banner tone="danger" className="mt-4">
          {error}
        </Banner>
      ) : null}
      <div className="mt-6 flex justify-end gap-3">
        <Button
          variant="secondary"
          autoFocus
          disabled={busy}
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
        <Button
          variant="danger-solid"
          disabled={busy}
          onClick={onConfirm}
          className="min-w-36"
        >
          {busy ? busyLabel : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
