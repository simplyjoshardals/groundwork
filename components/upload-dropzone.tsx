"use client";

import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { cn } from "@/components/ui/cn";
import { UploadIcon } from "@/components/ui/icons";
import { ACCEPT_ATTRIBUTE } from "@/lib/upload/file-checks";

export type DropzoneActivity =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "processing"; fileName: string };

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/**
 * The file dropzone (DESIGN 5.2): a dashed zone over a real `<input type="file">`
 * that keyboard and screen-reader users operate. The label "Upload a document"
 * is stretched over the whole zone (`after:inset-0`), so a click anywhere opens
 * the picker, and the hint lines stay outside the label and are linked with
 * `aria-describedby`.
 *
 * Three lines of text in every state (label, status or helper, hint), so
 * busy, idle and disabled have the same height and nothing shifts. A drop
 * does not go through `accept`, so the caller still validates the file.
 * `disabledNote` is shown instead of the helper while the zone is unavailable.
 */
export function UploadDropzone({
  inputId,
  describedBy,
  activity,
  disabled,
  disabledNote,
  skipped,
  hint,
  onFiles,
}: {
  inputId: string;
  /** Ids of notes outside the zone (the privacy note, the cap banner). */
  describedBy: string;
  activity: DropzoneActivity;
  /** Cap, offline or busy: the input is disabled. */
  disabled: boolean;
  /** Why it is unavailable (cap, offline). Ignored while busy. */
  disabledNote?: string;
  /** Files dropped beyond the first, which were not taken. */
  skipped: number;
  hint: string;
  onFiles: (files: File[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  // dragenter and dragleave fire for every child element; count them.
  const depth = useRef(0);
  const hintLineId = `${inputId}-hint`;
  const busy = activity.kind !== "idle";
  const unavailable = disabled && !busy;

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    // Clear the input so picking the same file again fires `change` again.
    input.value = "";
    if (files.length > 0) onFiles(files);
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth.current += 1;
    if (!disabled) setDragging(true);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    // Always cancel the default, or a refused drop would open the file in the tab.
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? "none" : "copy";
  }

  function onDragLeave() {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  }

  // Line 2 says what is happening or what to do; line 3 is the hint, or what
  // to know while busy. Three lines in every state keeps the height still.
  let line2: string;
  let line3: string;
  if (activity.kind === "uploading") {
    line2 = `Uploading ${activity.fileName}…`;
    line3 =
      skipped > 0
        ? "One file at a time. The others were skipped."
        : "Keep this tab open.";
  } else if (activity.kind === "processing") {
    line2 = `Processing ${activity.fileName}…`;
    line3 = "This can take a minute or more.";
  } else {
    line2 =
      unavailable && disabledNote
        ? disabledNote
        : "Drag a file here or choose one.";
    line3 = hint;
  }

  const liveText =
    activity.kind === "uploading"
      ? `Uploading ${activity.fileName}…`
      : activity.kind === "processing"
        ? `Processing ${activity.fileName}… this can take a minute or more.`
        : "";

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-dragging={dragging || undefined}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center transition-colors duration-(--dur-fast) ease-(--ease-settle) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
        unavailable
          ? "border-line bg-sunken text-muted"
          : dragging
            ? "border-accent bg-accent-soft text-ink"
            : busy
              ? "border-control bg-surface text-ink"
              : "border-control bg-surface text-ink hover:border-accent hover:bg-accent-soft",
      )}
    >
      <input
        id={inputId}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        disabled={disabled}
        onChange={onChange}
        aria-describedby={`${hintLineId} ${describedBy}`}
        className="sr-only"
      />
      <label
        htmlFor={inputId}
        className={cn(
          "inline-flex items-center gap-2 text-sm font-medium after:absolute after:inset-0 after:content-['']",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        <UploadIcon />
        Upload a document
      </label>
      <p
        aria-hidden={busy || undefined}
        className={cn(
          "max-w-full truncate text-sm",
          unavailable ? "text-muted" : "text-ink",
        )}
      >
        {line2}
      </p>
      <p id={hintLineId} className="text-xs text-pretty text-muted">
        {line3}
      </p>
      <span role="status" className="sr-only">
        {liveText}
      </span>
    </div>
  );
}
