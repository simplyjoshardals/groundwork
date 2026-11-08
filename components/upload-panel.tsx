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
import { requestIngest } from "@/lib/upload/request-ingest";
import { uploadDocument } from "@/lib/upload/upload-document";

type PanelState =
  | { status: "idle" }
  | { status: "uploading"; fileName: string }
  | { status: "processing"; fileName: string }
  | { status: "ready"; fileName: string }
  | { status: "no_op"; fileName: string }
  | { status: "ingest_failed"; fileName: string; message: string }
  | { status: "unconfirmed"; fileName: string }
  | { status: "error"; message: string };

/**
 * Upload control (Tasks 4.3 and 4.4). One file at a time, straight to Storage
 * with the user's own session, then a call to `/api/ingest`, which answers when
 * processing has finished (it can take a minute or more). There is no document
 * list yet (Task 4.6), so the outcome is reported here. A failed or unreachable
 * ingest never undoes the upload: the file stays stored and queued. Demo
 * sessions get an explanation instead of a control that RLS would refuse.
 */
export function UploadPanel({ canUpload }: { canUpload: boolean }) {
  const inputId = useId();
  const hintId = useId();
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
        setState({ status: "error", message: result.message });
        return;
      }

      setState({ status: "processing", fileName: file.name });
      const ingest = await requestIngest(result.documentId);
      setState(
        ingest.status === "failed"
          ? {
              status: "ingest_failed",
              fileName: file.name,
              message: ingestFailureMessage(ingest.reason),
            }
          : { status: ingest.status, fileName: file.name },
      );
    } catch (err) {
      console.error("[upload] unexpected failure:", err);
      setState({
        status: "error",
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
        disabled={busy}
        onChange={onChange}
        aria-describedby={hintId}
        className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-transparent file:px-3 file:py-1 disabled:opacity-60"
      />
      <p id={hintId} className="text-gray-600">
        PDF, TXT or Markdown, up to {maxMb} MB. You can keep up to{" "}
        {MAX_DOCS_PER_USER_HINT} documents.
      </p>
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
          finished. It may still complete. Reload the page later.
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="text-red-600">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
