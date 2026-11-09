"use client";

import { useCallback, useState } from "react";
import { DocumentList } from "@/components/document-list";
import { UploadPanel } from "@/components/upload-panel";
import { isAtDocumentCap } from "@/lib/upload/limits";

/**
 * Upload control plus the document list (Task 4.6). A client wrapper because
 * `app/page.tsx` is a server component and cannot pass callbacks: the upload
 * panel bumps `refreshKey` right after the row is inserted and again when the
 * ingest call returns, and the list reloads on each bump.
 *
 * The list reports how many documents the user has; at the cap the upload
 * control is disabled (Task 4.8). The count is `null` until the first load, so
 * nothing is disabled on a guess and the insert trigger stays the real cap.
 *
 * Demo (anonymous) sessions get the upload panel's "needs an account" message
 * and no list: they own no documents, and the shared samples are not theirs.
 */
export function DocumentsPanel({ canUpload }: { canUpload: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  const [documentCount, setDocumentCount] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <UploadPanel
        canUpload={canUpload}
        atCap={isAtDocumentCap(documentCount)}
        onUploaded={refresh}
        onIngestSettled={refresh}
      />
      {canUpload ? (
        <DocumentList
          refreshKey={refreshKey}
          onCountChange={setDocumentCount}
        />
      ) : null}
    </div>
  );
}
