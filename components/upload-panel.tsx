"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { ChangeEvent } from "react";
import { ingestFailureMessage } from "@/lib/ingest/failure-messages";
import { MAX_FILE_BYTES } from "@/lib/pdf/limits";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { createUploadPorts } from "@/lib/upload/create-upload-ports";
import {
  ACCEPT_ATTRIBUTE,
  MAX_DOCS_PER_USER_HINT,
} from "@/lib/upload/file-checks";
import { ingestLimitMessage } from "@/lib/upload/ingest-limit";
import { DOCUMENT_LIMIT_MESSAGE } from "@/lib/upload/limits";
import { requestIngest } from "@/lib/upload/request-ingest";
import {
  uploadDocument,
  type UploadFailureReason,
} from "@/lib/upload/upload-document";

type PanelState =
  | { status: "idle" }
  | { status: "uploading"; fileName: string }
  | { status: "processing"; fileName: string }
  | { status: "ready"; fileName: string }
  | { status: "no_op"; fileName: string }
  | { status: "ingest_failed"; fileName: string; message: string }
  | { status: "unconfirmed"; fileName: string }
  | { status: "ingest_limited"; message: string }
  | { status: "paused"; message: string }
  | { status: "error"; reason: UploadFailureReason | null; message: string };

/**
 * Upload control (Tasks 4.3 and 4.4). One file at a time, straight to Storage
 * with the user's own session, then a call to `/api/ingest`, which answers when
 * processing has finished (it can take a minute or more). The outcome is
 * reported here and the document list (Task 4.6) shows the live status; the
 * optional callbacks tell the list to refresh. A failed or unreachable ingest
 * never undoes the upload: the file stays stored and queued. Demo sessions get
 * an explanation instead of a control that RLS would refuse.
 *
 * A 429 from `/api/ingest` (Task 5.3) is shown as a distinct "uploaded, not
 * processed yet" status per limit reason, not as "unconfirmed".
 *
 * Cap and budget (Task 4.8): `atCap` (from the document list's count) disables
 * the control and says why. The global storage budget cannot be known up front
 * (clients cannot read `app_config`), so it shows as a neutral "uploads paused"
 * status after the server refuses an insert; the control stays enabled so the
 * user can try again later.
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
  const hintId = useId();
  const capId = useId();
  const [state, setState] = useState<PanelState>({ status: "idle" });
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

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Clear the input so picking the same file again fires `change` again.
    input.value = "";
    if (!file) return;

    setState({ status: "uploading", fileName: file.name });
    try {
      const result = await uploadDocument(
        file,
        createUploadPorts(createBrowserSupabase()),
      );
      if (!result.ok) {
        setState(
          result.reason === "budget_exhausted"
            ? { status: "paused", message: result.message }
            : {
                status: "error",
                reason: result.reason,
                message: result.message,
              },
        );
        return;
      }

      onUploaded?.();
      setState({ status: "processing", fileName: file.name });
      const ingest = await requestIngest(result.documentId);
      onIngestSettled?.();
      if (ingest.status === "failed") {
        setState({
          status: "ingest_failed",
          fileName: file.name,
          message: ingestFailureMessage(ingest.reason),
        });
      } else if (ingest.status === "limit") {
        // Stored and queued, but processing was refused by a usage limit.
        setState({
          status: "ingest_limited",
          message: ingestLimitMessage({
            fileName: file.name,
            reason: ingest.reason,
            resetsAt: ingest.resetsAt,
          }),
        });
      } else {
        setState({ status: ingest.status, fileName: file.name });
      }
    } catch (err) {
      console.error("[upload] unexpected failure:", err);
      setState({
        status: "error",
        reason: null,
        message: "Something went wrong. Please try again.",
      });
    }
  }

  const maxMb = MAX_FILE_BYTES / (1024 * 1024);

  return (
    <section aria-busy={busy} className="flex flex-col gap-2 text-sm">
      <label htmlFor={inputId} className="font-medium">
        Upload a document
      </label>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        disabled={busy || atCap}
        onChange={onChange}
        aria-describedby={atCap ? `${capId} ${hintId}` : hintId}
        className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-transparent file:px-3 file:py-1 disabled:opacity-60"
      />
      <p id={hintId} className="text-gray-600">
        PDF, TXT or Markdown, up to {maxMb} MB. You can keep up to{" "}
        {MAX_DOCS_PER_USER_HINT} documents.
      </p>
      {atCap ? (
        <p id={capId} role="status" className="text-amber-700">
          {DOCUMENT_LIMIT_MESSAGE}
        </p>
      ) : null}
      {state.status === "uploading" ? (
        <p role="status">Uploading {state.fileName}…</p>
      ) : null}
      {state.status === "processing" ? (
        <p role="status">
          Processing {state.fileName}… this can take a minute or more.
        </p>
      ) : null}
      {state.status === "ready" ? (
        <p role="status">{state.fileName} is ready to search.</p>
      ) : null}
      {state.status === "no_op" ? (
        <p role="status">
          {state.fileName} is already processed or is being processed.
        </p>
      ) : null}
      {state.status === "ingest_failed" ? (
        <p role="alert" className="text-red-600">
          Uploaded {state.fileName}, but it could not be processed.{" "}
          {state.message}
        </p>
      ) : null}
      {state.status === "unconfirmed" ? (
        <p role="alert" className="text-red-600">
          Uploaded {state.fileName}, but we could not confirm that processing
          finished. It may still complete. Check its status in the list below.
        </p>
      ) : null}
      {state.status === "ingest_limited" ? (
        <p role="status" className="text-amber-700">
          {state.message}
        </p>
      ) : null}
      {state.status === "paused" ? (
        <p role="status" className="text-amber-700">
          {state.message}
        </p>
      ) : null}
      {/* At the cap the notice above already says it: no second copy. */}
      {state.status === "error" &&
      !(atCap && state.reason === "limit_reached") ? (
        <p role="alert" className="text-red-600">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
