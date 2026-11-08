import type { IngestFailureReason } from "@/features/ingestion/types";
import { isIngestFailureReason } from "@/lib/ingest/failure-messages";

/**
 * Pure rules for the document list (Task 4.6): which rows are still moving,
 * which are stuck, which may be retried, and how fast to poll. Every function
 * that depends on time takes `now` (epoch milliseconds), so tests control the
 * clock. No `server-only`: the browser list uses this.
 */

export type DocumentStatus = "queued" | "processing" | "ready" | "failed";

const STATUSES: readonly string[] = ["queued", "processing", "ready", "failed"];

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return typeof value === "string" && STATUSES.includes(value);
}

/**
 * Mirrors `app_config.stale_processing_minutes`. Clients cannot read
 * `app_config`, so this is a hint (same pattern as `MAX_DOCS_PER_USER_HINT`).
 * `claim_document_for_ingest` stays the authority: if the hint is wrong, the
 * server answers `no_op` and the UI says the document is still being processed.
 */
export const STALE_PROCESSING_MINUTES_HINT = 10;

/**
 * PROVISIONAL (Task 4.6 plan): a row still `queued` this long after upload was
 * never ingested (the tab closed between upload and ingest, or a failure
 * before the claim), so nothing will move it on its own.
 */
export const STALE_QUEUED_SECONDS_HINT = 60;

/** The fields these rules read from a document row. */
export interface DocumentStateFields {
  status: DocumentStatus;
  errorReason: string | null;
  createdAt: string;
  processingStartedAt: string | null;
}

/** Milliseconds since `timestamp`, or null when it is missing or not a date. */
function ageMs(timestamp: string | null, now: number): number | null {
  if (timestamp === null) return null;
  const time = Date.parse(timestamp);
  return Number.isNaN(time) ? null : now - time;
}

/**
 * Nothing will change this row on its own. The server's claim only re-takes a
 * `processing` row that is strictly older than the stale window, so the
 * comparison is strict too. A timestamp we cannot read counts as stuck: the
 * user gets a Retry and the server decides.
 */
export function isStuck(doc: DocumentStateFields, now: number): boolean {
  if (doc.status === "processing") {
    const age = ageMs(doc.processingStartedAt, now);
    return age === null || age > STALE_PROCESSING_MINUTES_HINT * 60_000;
  }
  if (doc.status === "queued") {
    const age = ageMs(doc.createdAt, now);
    return age === null || age > STALE_QUEUED_SECONDS_HINT * 1000;
  }
  return false;
}

/** Still expected to change by itself, so the list keeps polling. */
export function isInFlight(doc: DocumentStateFields, now: number): boolean {
  return (
    (doc.status === "queued" || doc.status === "processing") &&
    !isStuck(doc, now)
  );
}

/**
 * Whether another attempt can help. File-caused failures are not retryable
 * (the same file fails the same way, as the Task 4.5 notes say). A
 * `Record` over the reason union, so a new reason that nobody classified does
 * not compile.
 */
export const RETRYABLE_REASONS: Record<IngestFailureReason, boolean> = {
  scanned_pdf: false,
  too_many_pages: false,
  file_too_large: false,
  unsupported_type: false,
  corrupt_file: false,
  encrypted_file: false,
  empty_document: false,
  provider_unavailable: true,
  internal_error: true,
};

export function canRetry(doc: DocumentStateFields, now: number): boolean {
  switch (doc.status) {
    case "failed":
      // An unknown or null reason is shown as a generic error, so it is retryable.
      return isIngestFailureReason(doc.errorReason)
        ? RETRYABLE_REASONS[doc.errorReason]
        : true;
    case "queued":
    case "processing":
      return isStuck(doc, now);
    case "ready":
      return false;
  }
}

/**
 * PROVISIONAL polling schedule: 2 s for the first 5 polls, 5 s for the next 6,
 * then 10 s. It resets on upload, on Retry and whenever a status changes.
 */
export const POLL_SCHEDULE: readonly { delayMs: number; polls: number }[] = [
  { delayMs: 2_000, polls: 5 },
  { delayMs: 5_000, polls: 6 },
];
export const POLL_MAX_DELAY_MS = 10_000;

/** Delay before poll number `attempt` (0-based) since the schedule last reset. */
export function pollDelayMs(attempt: number): number {
  let remaining = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  for (const step of POLL_SCHEDULE) {
    if (remaining < step.polls) return step.delayMs;
    remaining -= step.polls;
  }
  return POLL_MAX_DELAY_MS;
}

/** Changes when any row is added, removed or changes status. */
export function statusSignature(
  documents: readonly { id: string; status: DocumentStatus }[],
): string {
  return documents.map((d) => `${d.id}:${d.status}`).join("|");
}
