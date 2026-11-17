"use client";

import { useCallback, useState } from "react";
import {
  DocumentList,
  type InitialDocuments,
} from "@/components/document-list";
import { UploadPanel } from "@/components/upload-panel";
import {
  DocumentsSourceContext,
  defaultDocumentsSource,
  type DocumentsSource,
} from "@/lib/documents/source";
import { isAtDocumentCap } from "@/lib/upload/limits";

/**
 * Upload control plus the document list (Task 4.6). From U5 the upload control
 * sits between the shelf heading and the rows (`aboveList`), and the documents
 * source (`lib/documents/source.ts`) is provided here.
 *
 * Originally: upload control plus the document list (Task 4.6). A client wrapper because
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
export function DocumentsPanel({
  initial,
  source = defaultDocumentsSource,
}: {
  initial?: InitialDocuments;
  /** Where documents come from. Only the dev drill passes one; the app never does. */
  source?: DocumentsSource;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  const [documentCount, setDocumentCount] = useState<number | null>(null);

  return (
    <DocumentsSourceContext value={source}>
      <DocumentList
        refreshKey={refreshKey}
        onCountChange={setDocumentCount}
        initial={initial}
        aboveList={
          <UploadPanel
            canUpload
            atCap={isAtDocumentCap(documentCount)}
            onUploaded={refresh}
            onIngestSettled={refresh}
          />
        }
      />
    </DocumentsSourceContext>
  );
}
