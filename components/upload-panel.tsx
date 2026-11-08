"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { ChangeEvent } from "react";
import { MAX_FILE_BYTES } from "@/lib/pdf/limits";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { createUploadPorts } from "@/lib/upload/create-upload-ports";
import {
  ACCEPT_ATTRIBUTE,
  MAX_DOCS_PER_USER_HINT,
} from "@/lib/upload/file-checks";
import { uploadDocument } from "@/lib/upload/upload-document";

type PanelState =
  | { status: "idle" }
  | { status: "uploading"; fileName: string }
  | { status: "success"; fileName: string }
  | { status: "error"; message: string };

/**
 * Upload control (Task 4.3). One file at a time, straight to Storage with the
 * user's own session. There is no document list yet (Task 4.6), so a success
 * only confirms that the file is queued. Demo sessions get an explanation
 * instead of a control that RLS would refuse.
 */
export function UploadPanel({ canUpload }: { canUpload: boolean }) {
  const inputId = useId();
  const hintId = useId();
  const [state, setState] = useState<PanelState>({ status: "idle" });
  const uploading = state.status === "uploading";

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
      setState(
        result.ok
          ? { status: "success", fileName: file.name }
          : { status: "error", message: result.message },
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
    <section aria-busy={uploading} className="flex flex-col gap-2 text-sm">
      <label htmlFor={inputId} className="font-medium">
        Upload a document
      </label>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        disabled={uploading}
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
      {state.status === "success" ? (
        <p role="status">
          Uploaded {state.fileName}. It is queued for processing.
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
