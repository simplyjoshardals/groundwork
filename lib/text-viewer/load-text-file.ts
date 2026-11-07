import {
  createDocumentSignedUrl,
  type SignedUrlClient,
  type SignedUrlFailureReason,
} from "@/lib/storage/documents";
import { decodeTextFile } from "./pages";

/**
 * Downloads a text or Markdown file from the private `documents` bucket with
 * the session the client carries (Task 3.7). No `server-only`: the browser
 * calls it. Never pass the admin client: the storage policy decides access.
 *
 * Never throws: every failure is a result. The signed URL is a bearer
 * credential, so it is never put into a result or a log.
 */

/** Same cap as upload and the bucket (5 MiB). A larger file is refused. */
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

export type TextFileFailureReason =
  SignedUrlFailureReason | "too_large" | "invalid_text";

export type TextFileResult =
  { ok: true; text: string } | { ok: false; reason: TextFileFailureReason };

export interface LoadTextFileOptions {
  signal?: AbortSignal;
  /** For tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export async function loadTextFile(
  client: SignedUrlClient,
  storagePath: string,
  options: LoadTextFileOptions = {},
): Promise<TextFileResult> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const signed = await createDocumentSignedUrl(client, storagePath);
  if (!signed.ok) return { ok: false, reason: signed.reason };

  let bytes: Uint8Array;
  try {
    const response = await fetchImpl(signed.url, { signal: options.signal });
    if (!response.ok) {
      return {
        ok: false,
        reason: response.status === 404 ? "not_found" : "failed",
      };
    }
    // Refuse early when the size is declared; checked again after reading.
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_TEXT_FILE_BYTES) {
      return { ok: false, reason: "too_large" };
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    // Network error or abort. Nothing from the error is kept: its message
    // could contain the signed URL.
    return { ok: false, reason: "failed" };
  }

  if (bytes.byteLength > MAX_TEXT_FILE_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  const decoded = decodeTextFile(bytes);
  return decoded.ok
    ? { ok: true, text: decoded.text }
    : { ok: false, reason: decoded.reason };
}
