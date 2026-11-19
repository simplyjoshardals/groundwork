"use client";

import { useEffect, useRef, useState } from "react";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Lets a file be dropped anywhere on the page, not only on the upload control
 * (U5). Returns `true` while a file is being dragged over the window, so the
 * control can show "Drop to shelve it".
 *
 * Two things matter here. A file dropped on a page that does not handle it is
 * opened by the browser, which throws the person out of the app, so every file
 * drag has its default cancelled. And while a modal dialog is open, or when
 * uploads are unavailable (`disabled`), a drop is refused with
 * `dropEffect = "none"` rather than ignored in silence. Only drags that carry
 * files are touched; text and links dragged around the page are left alone.
 */
export function useFileDrop(
  onFiles: (files: File[]) => void,
  disabled: boolean,
): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ onFiles, disabled });
  useEffect(() => {
    latest.current = { onFiles, disabled };
  });

  useEffect(() => {
    // dragenter and dragleave fire for every element crossed; count them.
    let depth = 0;
    const refused = () =>
      latest.current.disabled || document.querySelector("dialog[open]") !== null;

    function enter(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth += 1;
      if (!refused()) setDragging(true);
    }
    function over(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = refused() ? "none" : "copy";
      }
    }
    function leave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    }
    function drop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (refused()) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) latest.current.onFiles(files);
    }

    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return dragging && !disabled;
}
