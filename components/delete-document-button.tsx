"use client";

import { useState } from "react";
import type {
  DeleteDocumentErrorBody,
  DeleteDocumentResponseBody,
} from "@/types/delete-document";

type Phase = "idle" | "confirming" | "deleting";

/**
 * Delete control for one document row (Task 4.7): a button, then an inline
 * "Delete? Yes / Cancel" step, then `DELETE /api/documents/[id]`. Works for any
 * status, including `processing` (ingestion then fails cleanly on the server).
 *
 * `onDeleted` is called when the document is gone, including a 404 (already
 * deleted elsewhere), so the list can reload. A leftover Storage file
 * (`fileRemoved: false`) is not the user's problem: the document is deleted.
 */
export function DeleteDocumentButton({
  documentId,
  documentTitle,
  onDeleted,
}: {
  documentId: string;
  documentTitle: string;
  onDeleted: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setPhase("deleting");
    setError(null);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(documentId)}`,
        { method: "DELETE" },
      );
      if (response.ok || response.status === 404) {
        // Validate the shape only on success; a 404 means it is already gone.
        if (response.ok) {
          const body = (await response.json()) as DeleteDocumentResponseBody;
          if (body.status !== "deleted") throw new Error("unexpected response");
        }
        onDeleted();
        return;
      }
      if (response.status === 401) {
        setError("Your session has ended. Sign in again to delete.");
      } else {
        const body = (await response
          .json()
          .catch(() => null)) as DeleteDocumentErrorBody | null;
        setError(body?.message ?? "Could not delete the document. Try again.");
      }
    } catch {
      setError(
        "Could not reach the server. Check your connection and try again.",
      );
    }
    setPhase("idle");
  }

  if (phase === "idle") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setPhase("confirming");
          }}
          aria-label={`Delete ${documentTitle}`}
          className="rounded-md border border-danger px-2 py-1 text-sm text-danger hover:bg-danger-soft"
        >
          Delete
        </button>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 text-sm"
      role="group"
      aria-label="Confirm delete"
    >
      <span>Delete this document?</span>
      <button
        type="button"
        onClick={confirmDelete}
        disabled={phase === "deleting"}
        className="rounded-md bg-danger px-2 py-1 text-danger-fg hover:bg-danger disabled:opacity-60"
      >
        {phase === "deleting" ? "Deleting…" : "Yes, delete"}
      </button>
      <button
        type="button"
        onClick={() => setPhase("idle")}
        disabled={phase === "deleting"}
        className="rounded-md border px-2 py-1 hover:bg-sunken disabled:opacity-60"
      >
        Cancel
      </button>
    </div>
  );
}
