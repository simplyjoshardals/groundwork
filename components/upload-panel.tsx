"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { PendingUpload } from "@/components/pending-row";
import { ShelfStrip } from "@/components/shelf-strip";
import { cn } from "@/components/ui/cn";
import { UploadIcon } from "@/components/ui/icons";
import { useFileDrop } from "@/components/use-file-drop";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import type { OwnDocument } from "@/lib/documents/list-own-documents";
import { isPendingShown, shelfCaption } from "@/lib/documents/shelf";
import { useDocumentsSource } from "@/lib/documents/source";
import { ingestFailureMessage } from "@/lib/ingest/failure-messages";
import { useOnlineStatus } from "@/lib/net/use-online-status";
import { MAX_FILE_BYTES } from "@/lib/pdf/limits";
import {
  ACCEPT_ATTRIBUTE,
  MAX_DOCS_PER_USER_HINT,
} from "@/lib/upload/file-checks";
import { ingestLimitMessage } from "@/lib/upload/ingest-limit";
import { DOCUMENT_LIMIT_MESSAGE } from "@/lib/upload/limits";
import type { UploadFailureReason } from "@/lib/upload/upload-document";

/** DESIGN section 8. */
export const PRIVACY_NOTE =
  "Don’t upload sensitive documents. Their text is sent to AI providers to answer questions.";
export const OFFLINE_UPLOAD_NOTE = "Uploads need a connection.";

/**
 * What the panel is doing, and the last outcome that needs a banner. Success
 * (`ready`, `no_op`) is a toast and leaves the panel idle, because it leaves
 * nothing else to read.
 */
type PanelState =
  | { status: "idle" }
  | { status: "uploading"; fileName: string }
  | { status: "processing"; fileName: string }
  | { status: "ingest_failed"; fileName: string; message: string }
  | { status: "unconfirmed"; fileName: string }
  | { status: "ingest_limited"; message: string }
  | { status: "paused"; message: string }
  | { status: "error"; reason: UploadFailureReason | null; message: string };

/**
 * Upload control (Tasks 4.3 and 4.4, restyled in U5). One file at a time,
 * straight to Storage with the user's own session, then a call to
 * `/api/ingest`, which answers when processing has finished (it can take a
 * minute or more). A failed or unreachable ingest never undoes the upload: the
 * file stays stored and queued.
 *
 * Where each outcome shows (DESIGN 5.2, 5.6, 5.8, 6.5): progress lives in the
 * upload slot (whose height does not change) and as a row for the new
 * document on the shelf (`onPendingChange`); success is a toast; failures,
 * the cap and a paused budget are banners under the privacy note. The
 * document list below shows the live status of every row either way.
 *
 * Cap (Task 4.8): `atCap` disables the zone and shows a warn banner. The global
 * storage budget cannot be known up front (clients cannot read `app_config`),
 * so it shows as an "uploads are paused" banner after the server refuses an
 * insert; the zone stays enabled so the user can try again later. Offline
 * disables the zone with a note.
 *
 * Demo sessions get an explanation instead of a control that RLS would refuse.
 */
export function UploadPanel({
  canUpload,
  atCap = false,
  onUploaded,
  onIngestSettled,
  onPendingChange,
  shelf = null,
  pending = null,
  activeId = null,
}: {
  canUpload: boolean;
  /** The user already owns the maximum number of documents. */
  atCap?: boolean;
  /** Called once the document row exists (status `queued`), before ingest starts. */
  onUploaded?: () => void;
  /** Called when the ingest call returns, whatever its outcome. */
  onIngestSettled?: () => void;
  /** The file being added (shown on the shelf as a row), or null when none is. */
  onPendingChange?: (pending: PendingUpload | null) => void;
  /** The shelf's documents, for the shelf strip; null while they load. */
  shelf?: readonly OwnDocument[] | null;
  /** The file being added, which the strip shows landing in its slot. */
  pending?: PendingUpload | null;
  /** The document whose row is hovered or focused. */
  activeId?: string | null;
}) {
  const inputId = useId();
  const privacyId = useId();
  const noteId = useId();
  const source = useDocumentsSource();
  const toast = useToast();
  const online = useOnlineStatus();
  const [state, setState] = useState<PanelState>({ status: "idle" });
  const [skipped, setSkipped] = useState(0);
  const [pointingAtUpload, setPointingAtUpload] = useState(false);
  const busy = state.status === "uploading" || state.status === "processing";
  const disabled = !canUpload || busy || atCap || !online;
  const dragging = useFileDrop((files) => void onFiles(files), disabled);

  if (!canUpload) {
    return (
      <section aria-labelledby={inputId} className="text-sm">
        <h2 id={inputId} className="font-medium">
          Your documents
        </h2>
        <p className="mt-1">
          Uploading needs an account.{" "}
          <Link href="/sign-up" className="underline">
            Create an account
          </Link>{" "}
          to add your own documents.
        </p>
      </section>
    );
  }

  async function onFiles(files: File[]) {
    const file = files[0];
    if (!file || busy || atCap || !online) return;
    setSkipped(files.length - 1);

    setState({ status: "uploading", fileName: file.name });
    onPendingChange?.({ fileName: file.name, documentId: null });
    try {
      const result = await source.upload(file);
      if (!result.ok) {
        setState(
          result.reason === "budget_exhausted"
            ? { status: "paused", message: result.message }
            : { status: "error", reason: result.reason, message: result.message },
        );
        return;
      }

      onPendingChange?.({ fileName: file.name, documentId: result.documentId });
      onUploaded?.();
      setState({ status: "processing", fileName: file.name });
      const ingest = await source.ingest(result.documentId);
      onIngestSettled?.();
      switch (ingest.status) {
        case "ready":
          toast.show(`${file.name} is ready to search.`);
          setState({ status: "idle" });
          break;
        case "no_op":
          toast.show(`${file.name} is already processed or is being processed.`);
          setState({ status: "idle" });
          break;
        case "failed":
          setState({
            status: "ingest_failed",
            fileName: file.name,
            message: ingestFailureMessage(ingest.reason),
          });
          break;
        case "limit":
          // Stored and queued, but processing was refused by a usage limit.
          setState({
            status: "ingest_limited",
            message: ingestLimitMessage({
              fileName: file.name,
              reason: ingest.reason,
              resetsAt: ingest.resetsAt,
            }),
          });
          break;
        case "unconfirmed":
          setState({ status: "unconfirmed", fileName: file.name });
          break;
      }
    } catch (err) {
      console.error("[upload] unexpected failure:", err);
      setState({
        status: "error",
        reason: null,
        message: "Something went wrong. Please try again.",
      });
    } finally {
      setSkipped(0);
      onPendingChange?.(null);
    }
  }

  const maxMb = MAX_FILE_BYTES / (1024 * 1024);

  const arriving = isPendingShown(pending, shelf);
  const count = (shelf?.length ?? 0) + (arriving ? 1 : 0);
  const hintLineId = `${inputId}-hint`;

  // What the line under the button says: what is happening, else the rules.
  let hintLines: string[];
  if (state.status === "uploading") {
    hintLines = [
      `Uploading ${state.fileName}…`,
      skipped > 0
        ? "One file at a time. The others were skipped."
        : "Keep this tab open.",
    ];
  } else if (state.status === "processing") {
    hintLines = [
      `Processing ${state.fileName}…`,
      "This can take a minute or more.",
    ];
  } else if (dragging) {
    hintLines = ["Drop to shelve it."];
  } else if (!online) {
    // At the cap the banner below already says why, so the line keeps the rules.
    hintLines = [OFFLINE_UPLOAD_NOTE];
  } else {
    hintLines = [
      `PDF, TXT or Markdown, up to ${maxMb} MB. You can keep up to ${MAX_DOCS_PER_USER_HINT} documents.`,
    ];
  }
  const liveText =
    state.status === "uploading"
      ? `Uploading ${state.fileName}…`
      : state.status === "processing"
        ? `Processing ${state.fileName}… this can take a minute or more.`
        : "";

  return (
    <div aria-busy={busy} className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-6">
        <div className="flex w-full max-w-80 flex-col gap-2">
          <ShelfStrip
            documents={shelf}
            arriving={arriving}
            dragging={dragging}
            previewNext={pointingAtUpload && !disabled}
            activeId={activeId}
          />
          <p className="min-h-4 font-mono text-xs text-muted tabular-nums">
            {shelf === null ? "" : shelfCaption(count)}
          </p>
        </div>
        {/* The picker: a real file input under a label made to look like a
            button, so the keyboard and screen-reader path is the native one. */}
        <div
          onMouseEnter={() => setPointingAtUpload(true)}
          onMouseLeave={() => setPointingAtUpload(false)}
          onFocus={() => setPointingAtUpload(true)}
          onBlur={() => setPointingAtUpload(false)}
          className="relative rounded-lg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
        >
          <input
            id={inputId}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            disabled={disabled}
            onChange={(event) => {
              const input = event.currentTarget;
              const files = Array.from(input.files ?? []);
              // Clear it so choosing the same file again fires `change` again.
              input.value = "";
              if (files.length > 0) void onFiles(files);
            }}
            aria-describedby={`${hintLineId} ${atCap ? `${noteId} ` : ""}${privacyId}`}
            className="sr-only"
          />
          <label
            htmlFor={inputId}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors duration-(--dur-fast) pointer-coarse:h-11",
              disabled
                ? "cursor-not-allowed border-line bg-sunken text-muted"
                : "cursor-pointer border-control bg-surface text-ink hover:bg-sunken",
            )}
          >
            <UploadIcon />
            Upload a document
          </label>
        </div>
      </div>

      {/* Two lines on a phone and one from `sm` up, with the room reserved, so
          nothing moves when the text changes. */}
      <p
        id={hintLineId}
        aria-hidden={busy || undefined}
        className="min-h-8 text-xs text-pretty sm:min-h-4"
      >
        {hintLines.map((line, i) => (
          <span
            key={line}
            className={cn(
              "block sm:inline",
              i > 0 && "sm:ml-1",
              i === 0 && (busy || dragging) ? "text-ink" : "text-muted",
            )}
          >
            {line}
          </span>
        ))}
      </p>
      <span role="status" className="sr-only">
        {liveText}
      </span>
      {/* Always there, directly under the control (DESIGN 6.5). */}
      <p id={privacyId} className="text-xs text-muted text-pretty">
        {PRIVACY_NOTE}
      </p>

      {atCap ? (
        <Banner tone="warn" id={noteId}>
          {DOCUMENT_LIMIT_MESSAGE}
        </Banner>
      ) : null}
      {state.status === "paused" ? (
        <Banner tone="warn">{state.message}</Banner>
      ) : null}
      {state.status === "ingest_limited" ? (
        <Banner tone="warn">{state.message}</Banner>
      ) : null}
      {state.status === "unconfirmed" ? (
        <Banner tone="warn">
          Uploaded {state.fileName}, but we could not confirm that processing
          finished. It may still complete. Check its status in the list below.
        </Banner>
      ) : null}
      {state.status === "ingest_failed" ? (
        <Banner tone="danger">
          Uploaded {state.fileName}, but it could not be processed. The reason
          is on its row below.
        </Banner>
      ) : null}
      {/* At the cap the banner above already says it: no second copy. */}
      {state.status === "error" &&
      !(atCap && state.reason === "limit_reached") ? (
        <Banner tone="danger">{state.message}</Banner>
      ) : null}
    </div>
  );
}
