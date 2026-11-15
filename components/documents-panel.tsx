"use client";

import { useCallback, useState } from "react";
import {
  DocumentList,
  type InitialDocuments,
} from "@/components/document-list";
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
 * Signed-in (non-demo) sessions only: demo sessions get `SampleShelf` instead
 * (U2). `initial` is the server's first read of the list.
 */
export function DocumentsPanel({ initial }: { initial: InitialDocuments }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  const [documentCount, setDocumentCount] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <UploadPanel
        canUpload
        atCap={isAtDocumentCap(documentCount)}
        onUploaded={refresh}
        onIngestSettled={refresh}
      />
      <DocumentList
        refreshKey={refreshKey}
        onCountChange={setDocumentCount}
        initial={initial}
      />
    </div>
  );
}
