"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDocumentsSource } from "@/lib/documents/source";

type Phase = "idle" | "confirming" | "deleting";

/**
 * Delete control for one document row (Task 4.7, restyled in U5): a ghost
 * button that opens the confirm dialog (DESIGN 5.7), then `DELETE
 * /api/documents/[id]` through the documents source. Works for any status,
 * including `processing` (ingestion then fails cleanly on the server).
 *
 * A failure keeps the dialog open with the reason, so the same button retries
 * it. `onDeleted` is called when the document is gone, including a 404 (already
 * deleted elsewhere); the list removes the row, shows the toast and moves
 * focus. A leftover Storage file (`fileRemoved: false`) is not the user's
 * problem: the document is deleted.
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
  const source = useDocumentsSource();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setPhase("deleting");
    setError(null);
    const result = await source.remove(documentId);
    if (result.ok) {
      setPhase("idle");
      onDeleted();
      return;
    }
    setError(result.message);
    setPhase("confirming");
  }

  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        aria-label={`Delete ${documentTitle}`}
        onClick={() => {
          setError(null);
          setPhase("confirming");
        }}
      >
        Delete
      </Button>
      <ConfirmDialog
        open={phase !== "idle"}
        title={`Delete “${documentTitle}”?`}
        confirmLabel="Delete document"
        busyLabel="Deleting…"
        cancelLabel="Keep it"
        busy={phase === "deleting"}
        error={error}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPhase("idle")}
      >
        This removes the file and everything made from it. It can’t be undone.
      </ConfirmDialog>
    </>
  );
}
