import { isIngestFailureReason } from "@/lib/ingest/failure-messages";
import type { IngestResponseBody } from "@/types/ingest";

/**
 * Browser-side call to `POST /api/ingest` (Task 4.4), made by the upload panel
 * after a successful upload. Never throws: every outcome is a value, so a
 * failed or unreachable ingest cannot turn a stored upload into an error.
 *
 * `unconfirmed` means the answer is unknown (network error, timeout, a non-OK
 * status or a malformed body). Ingestion may still finish on the server.
 */
export type RequestIngestResult =
  IngestResponseBody | { status: "unconfirmed" };

const UNCONFIRMED: RequestIngestResult = { status: "unconfirmed" };

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Narrows an untrusted response body to the shared contract. */
function parseBody(body: unknown): IngestResponseBody | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.status === "no_op") return { status: "no_op" };
  if (record.status === "failed" && typeof record.reason === "string") {
    // An unknown code still means "failed"; it is shown as an internal error.
    return {
      status: "failed",
      reason: isIngestFailureReason(record.reason)
        ? record.reason
        : "internal_error",
    };
  }
  if (
    record.status === "ready" &&
    isNonNegativeInteger(record.pageCount) &&
    isNonNegativeInteger(record.chunkCount)
  ) {
    return {
      status: "ready",
      pageCount: record.pageCount,
      chunkCount: record.chunkCount,
    };
  }
  return null;
}

export async function requestIngest(
  documentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RequestIngestResult> {
  try {
    const response = await fetchImpl("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId }),
    });
    if (!response.ok) {
      console.warn(`[upload] ingest request returned HTTP ${response.status}`);
      return UNCONFIRMED;
    }
    const parsed = parseBody(await response.json());
    if (parsed === null) {
      console.warn("[upload] ingest request returned an unexpected body");
      return UNCONFIRMED;
    }
    return parsed;
  } catch (error) {
    console.warn("[upload] ingest request did not complete:", error);
    return UNCONFIRMED;
  }
}
