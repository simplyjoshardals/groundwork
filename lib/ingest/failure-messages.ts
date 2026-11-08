import type { IngestFailureReason } from "@/features/ingestion/types";
import { MAX_FILE_BYTES, MAX_PAGES } from "@/lib/pdf/limits";

/**
 * Friendly text for each `documents.error_reason` code (Task 4.5).
 *
 * Pure and client-safe (no `server-only`): the upload panel uses it now and the
 * document list (Task 4.6) will use it for the `error_reason` read from the
 * database. Every message is a fixed string. Nothing from the server, the file
 * or a provider is ever interpolated, so no stack trace, file name or provider
 * text can reach the browser through here.
 *
 * Typed as a `Record` over the failure-reason union, so adding a reason
 * without a message is a compile error. Each message says whether another
 * attempt can help: file problems need a different file, while
 * `provider_unavailable` and `internal_error` are worth retrying.
 */
const MAX_MB = MAX_FILE_BYTES / (1024 * 1024);

export const GENERIC_INGEST_FAILURE_MESSAGE =
  "Something went wrong on our side while processing this document. Please try again.";

export const INGEST_FAILURE_MESSAGES: Record<IngestFailureReason, string> = {
  scanned_pdf:
    "This PDF looks like a scan with no selectable text. Upload a version with real text, or a TXT or Markdown file.",
  too_many_pages: `This document has more than ${MAX_PAGES} pages. Upload a shorter one.`,
  file_too_large: `This file is larger than ${MAX_MB} MB. Upload a smaller one.`,
  unsupported_type:
    "This file is not a valid PDF, TXT or Markdown file. Check the file and upload it again.",
  corrupt_file:
    "This PDF could not be read. It may be damaged. Try saving or exporting it again.",
  encrypted_file:
    "This PDF is password-protected. Remove the password and upload it again.",
  empty_document: "This document has no text to search.",
  provider_unavailable:
    "Our search service is busy or unavailable right now. Please try again in a few minutes.",
  internal_error: GENERIC_INGEST_FAILURE_MESSAGE,
};

/**
 * Own-property check on purpose: `"toString" in messages` would be true, and a
 * value read from the network or the database is not trusted to be one of ours.
 */
export function isIngestFailureReason(
  value: unknown,
): value is IngestFailureReason {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(INGEST_FAILURE_MESSAGES, value)
  );
}

/** Message for a reason; anything unknown, missing or malformed gets the generic one. */
export function ingestFailureMessage(
  reason: string | null | undefined,
): string {
  return isIngestFailureReason(reason)
    ? INGEST_FAILURE_MESSAGES[reason]
    : GENERIC_INGEST_FAILURE_MESSAGE;
}
