import { MAX_DOCS_PER_USER_HINT } from "./file-checks";

/**
 * Cap and budget handling for uploads (Task 4.8). Pure and browser-safe (no
 * `server-only`): the upload ports classify insert errors with it and the UI
 * uses the messages and the cap check.
 *
 * Both limits are enforced by the `documents` insert trigger, which raises
 * `document_limit_reached` (per-user cap) and then `storage_budget_exhausted`
 * (global budget). The checks here only decide wording and whether the control
 * is disabled; they are never the security boundary.
 */

/** Why a `documents` insert was refused, as far as the UI cares. */
export type InsertFailureReason =
  "document_limit_reached" | "storage_budget_exhausted" | "other";

export const DOCUMENT_LIMIT_MESSAGE = `You already have ${MAX_DOCS_PER_USER_HINT} documents. Delete one before uploading another.`;

/** The budget is global, so deleting your own documents may not help: say so. */
export const UPLOADS_PAUSED_MESSAGE =
  "Uploads are paused right now. Your existing documents still work. Please try again later.";

/**
 * True when the known document count is at or over the cap. `null` (not loaded
 * yet, or the load failed) is never "at the cap": the insert trigger decides.
 */
export function isAtDocumentCap(count: number | null): boolean {
  return (
    count !== null && Number.isFinite(count) && count >= MAX_DOCS_PER_USER_HINT
  );
}

/**
 * Maps a Supabase insert error to a reason by its exact message token (what
 * `raise exception '<token>'` produces). Anything else, including a missing or
 * non-string message, is `other`. The server text is never returned, so it
 * cannot reach the UI.
 */
export function classifyInsertError(
  error: { readonly message?: unknown } | null | undefined,
): InsertFailureReason {
  const message =
    error && typeof error.message === "string" ? error.message.trim() : "";
  if (message === "document_limit_reached") return "document_limit_reached";
  if (message === "storage_budget_exhausted") return "storage_budget_exhausted";
  return "other";
}
