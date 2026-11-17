import { createContext, useContext } from "react";
import {
  listOwnDocuments,
  type ListOwnDocumentsResult,
} from "@/lib/documents/list-own-documents";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { createUploadPorts } from "@/lib/upload/create-upload-ports";
import { requestIngest, type RequestIngestResult } from "@/lib/upload/request-ingest";
import { uploadDocument, type UploadResult } from "@/lib/upload/upload-document";
import type {
  DeleteDocumentErrorBody,
  DeleteDocumentResponseBody,
} from "@/types/delete-document";

/**
 * The one seam between the documents UI and where its data comes from (U5).
 * The shelf, the upload control and the delete button all read through it, so
 * the real backend is the default and only the dev drill
 * (`/dev-states/documents/<scenario>`) ever passes another. No component
 * above this line calls Supabase or `fetch` directly.
 */

export type RemoveDocumentResult =
  | { ok: true }
  | { ok: false; kind: "session_ended" | "network" | "failed"; message: string };

export interface DocumentsSource {
  /** Never throws: a failed read is `{ ok: false }`. */
  list(): Promise<ListOwnDocumentsResult>;
  /** Validates, inserts the queued row and stores the file. Never throws. */
  upload(file: File): Promise<UploadResult>;
  /** Asks the server to process a document. Answers when processing ends. */
  ingest(documentId: string): Promise<RequestIngestResult>;
  /** `DELETE /api/documents/[id]`. A 404 counts as deleted. Never throws. */
  remove(documentId: string): Promise<RemoveDocumentResult>;
}

export const REMOVE_SESSION_ENDED_MESSAGE =
  "Your session has ended. Sign in again to delete.";
export const REMOVE_FAILED_MESSAGE = "Could not delete the document. Try again.";
export const REMOVE_NETWORK_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

export const defaultDocumentsSource: DocumentsSource = {
  async list() {
    try {
      return await listOwnDocuments(createBrowserSupabase());
    } catch (error) {
      // A missing public env var is reported like any other failed read.
      console.warn(
        "[documents] could not create the browser client:",
        error instanceof Error ? error.name : "unknown",
      );
      return { ok: false, reason: "failed" };
    }
  },

  upload(file) {
    return uploadDocument(file, createUploadPorts(createBrowserSupabase()));
  },

  ingest(documentId) {
    return requestIngest(documentId);
  },

  async remove(documentId) {
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
        return { ok: true };
      }
      if (response.status === 401) {
        return {
          ok: false,
          kind: "session_ended",
          message: REMOVE_SESSION_ENDED_MESSAGE,
        };
      }
      const body = (await response
        .json()
        .catch(() => null)) as DeleteDocumentErrorBody | null;
      return {
        ok: false,
        kind: "failed",
        message: body?.message ?? REMOVE_FAILED_MESSAGE,
      };
    } catch {
      return { ok: false, kind: "network", message: REMOVE_NETWORK_MESSAGE };
    }
  },
};

export const DocumentsSourceContext = createContext<DocumentsSource>(
  defaultDocumentsSource,
);

export function useDocumentsSource(): DocumentsSource {
  return useContext(DocumentsSourceContext);
}
