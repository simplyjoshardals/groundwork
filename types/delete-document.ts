/** Bodies of `DELETE /api/documents/[id]` (Task 4.7). Shared by the route and the button. */
export interface DeleteDocumentResponseBody {
  status: "deleted";
  /** False when the row is gone but the Storage file is still queued for cleanup. */
  fileRemoved: boolean;
}

export interface DeleteDocumentErrorBody {
  error: "invalid_request" | "unauthorized" | "not_found" | "internal_error";
  message?: string;
}
