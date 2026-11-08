"use client";

import { useCallback, useState } from "react";
import { DocumentList } from "@/components/document-list";
import { UploadPanel } from "@/components/upload-panel";

/**
 * Upload control plus the document list (Task 4.6). A client wrapper because
 * `app/page.tsx` is a server component and cannot pass callbacks: the upload
 * panel bumps `refreshKey` right after the row is inserted and again when the
 * ingest call returns, and the list reloads on each bump.
 *
 * Demo (anonymous) sessions get the upload panel's "needs an account" message
 * and no list: they own no documents, and the shared samples are not theirs.
 */
export function DocumentsPanel({ canUpload }: { canUpload: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);

  return (
    <div className="flex flex-col gap-6">
      <UploadPanel
        canUpload={canUpload}
        onUploaded={refresh}
        onIngestSettled={refresh}
      />
      {canUpload ? <DocumentList refreshKey={refreshKey} /> : null}
    </div>
  );
}
