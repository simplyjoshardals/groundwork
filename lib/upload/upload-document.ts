import { isDocumentStoragePath } from "@/lib/storage/documents";
import {
  MAX_DOCS_PER_USER_HINT,
  cleanOriginalFilename,
  safeStorageFileName,
  titleFromFileName,
  validateUploadFile,
  type FileRejectionReason,
} from "./file-checks";

/**
 * Direct-to-Storage upload (Task 4.3), in the order DATA_MODEL 6 fixes:
 * insert the `queued` row, then upload the file to the exact path of that row.
 * The storage insert policy only accepts a path that has a queued row you own,
 * and the row insert already passed the cap triggers, so every stored byte is
 * tied to a counted document. Ingestion is NOT called here: the upload panel
 * calls `/api/ingest` after a successful upload (`request-ingest.ts`, Task 4.4),
 * so a failed ingest never turns a stored upload into a failure.
 *
 * All I/O goes through `UploadPorts` (real implementation:
 * `create-upload-ports.ts`), so the order of operations is unit-testable.
 * Ports never throw; expected failures come back as `{ ok: false }`.
 */

export type NewDocumentRow = {
  id: string;
  owner_id: string;
  title: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
};

export type UploadSession =
  | { status: "signed_in"; userId: string; isAnonymous: boolean }
  | { status: "signed_out" }
  | { status: "failed" };

export interface UploadPorts {
  getSession(): Promise<UploadSession>;
  /** Number of private documents the current user owns (RLS decides which rows count). */
  countOwnDocuments(): Promise<{ ok: true; count: number } | { ok: false }>;
  insertDocument(row: NewDocumentRow): Promise<{ ok: boolean }>;
  uploadFile(
    path: string,
    body: Blob,
    contentType: string,
  ): Promise<{ ok: boolean }>;
  /** Removes the row as the user (RLS: delete own). */
  deleteDocument(id: string): Promise<{ ok: boolean }>;
  newId(): string;
}

/** A `File` satisfies this; tests can build one without a browser. */
export type UploadableFile = Blob & { readonly name: string };

export type UploadFailureReason =
  | FileRejectionReason
  | "signed_out"
  | "demo_session"
  | "limit_reached"
  | "unavailable"
  | "insert_failed"
  | "upload_failed"
  | "internal_error";

export type UploadResult =
  | { ok: true; documentId: string; storagePath: string; title: string }
  | { ok: false; reason: UploadFailureReason; message: string };

function fail(reason: UploadFailureReason, message: string): UploadResult {
  return { ok: false, reason, message };
}

export async function uploadDocument(
  file: UploadableFile,
  ports: UploadPorts,
): Promise<UploadResult> {
  // 1. Local checks first: a bad file never causes a request.
  const check = validateUploadFile(file);
  if (!check.ok) return fail(check.reason, check.message);

  // 2. Who is uploading. Anonymous demo sessions are refused by RLS anyway.
  const session = await ports.getSession();
  if (session.status === "failed") {
    return fail(
      "unavailable",
      "Could not check your session. Check your connection and try again.",
    );
  }
  if (session.status === "signed_out") {
    return fail(
      "signed_out",
      "Your session has expired. Reload the page and sign in again.",
    );
  }
  if (session.isAnonymous) {
    return fail(
      "demo_session",
      "Uploading needs an account. Create one to add your own documents.",
    );
  }

  // 3. Document-count hint. A failed count is not fatal: the insert trigger is
  // the real cap, and a dead connection will fail the insert with its own message.
  const count = await ports.countOwnDocuments();
  if (count.ok && count.count >= MAX_DOCS_PER_USER_HINT) {
    return fail(
      "limit_reached",
      `You already have ${MAX_DOCS_PER_USER_HINT} documents. Delete one before uploading another.`,
    );
  }

  // 4. The client generates the id, so the path can be built before the insert.
  const documentId = ports.newId();
  const storagePath = `${session.userId}/${documentId}/${safeStorageFileName(file.name)}`;
  if (!isDocumentStoragePath(storagePath)) {
    // Not reachable with real UUIDs; stops a malformed path before any request.
    return fail(
      "internal_error",
      "Something went wrong preparing the upload. Please try again.",
    );
  }
  const title = titleFromFileName(file.name);

  const inserted = await ports.insertDocument({
    id: documentId,
    owner_id: session.userId,
    title,
    original_filename: cleanOriginalFilename(file.name),
    mime_type: check.mimeType,
    size_bytes: file.size,
    storage_path: storagePath,
  });
  if (!inserted.ok) {
    return fail("insert_failed", "Could not start the upload. Please try again.");
  }

  // 5. Upload. The body is re-wrapped in a Blob with the intended type: for a
  // Blob body the storage client can send the Blob's own type (empty or
  // `application/octet-stream` for `.md`) instead of the `contentType` option,
  // and the bucket would then reject the file. The option is passed as well.
  const body = new Blob([file], { type: check.mimeType });
  const uploaded = await ports.uploadFile(storagePath, body, check.mimeType);
  if (!uploaded.ok) {
    // Best effort: do not leave a queued row without a file. If this also
    // fails, `reap_documents` removes stale queued rows (DATA_MODEL 2.8).
    const removed = await ports.deleteDocument(documentId);
    if (!removed.ok) {
      console.warn("[upload] could not remove the row after a failed upload");
    }
    return fail("upload_failed", "The upload failed. Please try again.");
  }

  return { ok: true, documentId, storagePath, title };
}
