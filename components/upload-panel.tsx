"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { UploadDropzone } from "@/components/upload-dropzone";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { useDocumentsSource } from "@/lib/documents/source";
import { ingestFailureMessage } from "@/lib/ingest/failure-messages";
import { useOnlineStatus } from "@/lib/net/use-online-status";
import { MAX_FILE_BYTES } from "@/lib/pdf/limits";
import { MAX_DOCS_PER_USER_HINT } from "@/lib/upload/file-checks";
import { ingestLimitMessage } from "@/lib/upload/ingest-limit";
import { DOCUMENT_LIMIT_MESSAGE } from "@/lib/upload/limits";
import type { UploadFailureReason } from "@/lib/upload/upload-document";

/** DESIGN section 8. */
export const PRIVACY_NOTE =
  "Don’t upload sensitive documents. Their text is sent to AI providers to answer questions.";
export const OFFLINE_UPLOAD_NOTE = "Uploads need a connection.";
export const CAP_UPLOAD_NOTE = "The shelf is full.";

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
 * Where each outcome shows (DESIGN 5.2, 5.6, 5.8, 6.5): progress lives inside
 * the dropzone, whose height does not change; success is a toast; failures,
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
}: {
  canUpload: boolean;
  /** The user already owns the maximum number of documents. */
  atCap?: boolean;
  /** Called once the document row exists (status `queued`), before ingest starts. */
  onUploaded?: () => void;
  /** Called when the ingest call returns, whatever its outcome. */
  onIngestSettled?: () => void;
}) {
  const inputId = useId();
  const privacyId = useId();
  const noteId = useId();
  const source = useDocumentsSource();
  const toast = useToast();
  const online = useOnlineStatus();
  const [state, setState] = useState<PanelState>({ status: "idle" });
  const [skipped, setSkipped] = useState(0);
  const busy = state.status === "uploading" || state.status === "processing";

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
    }
  }

  const maxMb = MAX_FILE_BYTES / (1024 * 1024);
  const disabled = busy || atCap || !online;
  const disabledNote = !online ? OFFLINE_UPLOAD_NOTE : CAP_UPLOAD_NOTE;

  return (
    <div aria-busy={busy} className="flex flex-col gap-3 text-sm">
      <UploadDropzone
        inputId={inputId}
        describedBy={atCap ? `${noteId} ${privacyId}` : privacyId}
        activity={
          state.status === "uploading" || state.status === "processing"
            ? { kind: state.status, fileName: state.fileName }
            : { kind: "idle" }
        }
        disabled={disabled}
        disabledNote={disabledNote}
        skipped={skipped}
        hint={`PDF, TXT or Markdown, up to ${maxMb} MB. You can keep up to ${MAX_DOCS_PER_USER_HINT} documents.`}
        onFiles={(files) => void onFiles(files)}
      />
      {/* Always there, directly under the zone (DESIGN 6.5). */}
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
          Uploaded {state.fileName}, but it could not be processed.{" "}
          {state.message}
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
