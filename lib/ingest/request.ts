/**
 * Validation of the `POST /api/ingest` body (Task 4.4). Pure, so it can be
 * tested without a request. Unknown extra keys are ignored.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedIngestRequest =
  { ok: true; data: { documentId: string } } | { ok: false; message: string };

export function parseIngestRequest(body: unknown): ParsedIngestRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "The request body must be a JSON object." };
  }
  const documentId = (body as Record<string, unknown>).documentId;
  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) {
    return { ok: false, message: "documentId must be a UUID string." };
  }
  // Lowercased so the same id is always logged and compared the same way.
  return { ok: true, data: { documentId: documentId.toLowerCase() } };
}
