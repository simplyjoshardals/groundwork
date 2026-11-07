import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Signed URLs for files in the private `documents` bucket (Task 3.1).
 *
 * No `server-only` marker on purpose: ARCHITECTURE Flow 3 has the browser ask
 * for the URL, so this runs with either the browser or the server-as-user
 * client. Never pass the admin client here, because the service role bypasses
 * the storage policies this helper relies on. Access is decided by the
 * `documents_objects_select` policy (migration 0007), not by this code; the
 * checks below only stop malformed paths from being sent at all.
 */

/** Storage bucket created by migration 0007 (DATA_MODEL 2.7). */
export const DOCUMENTS_BUCKET = "documents";

/**
 * Short on purpose. PDF.js may fetch byte ranges lazily, so a very short life
 * could break page navigation in a long session; Task 3.2 should request a
 * fresh URL if a range request fails.
 */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 900;
export const MAX_SIGNED_URL_TTL_SECONDS = 3600;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FILE_NAME = "[A-Za-z0-9._-]{1,100}";

/** Same two shapes as the `documents_storage_path_shape` constraint (DATA_MODEL 2.3). */
const STORAGE_PATH_PATTERN = new RegExp(
  `^(?:samples/${FILE_NAME}|${UUID}/${UUID}/${FILE_NAME})$`,
);

/**
 * True when `value` has the shape of a document storage path. Stricter than
 * the database constraint in one way: a file name made only of dots (`.`,
 * `..`) is rejected, so a path can never be read as a traversal.
 */
export function isDocumentStoragePath(value: string): boolean {
  if (!STORAGE_PATH_PATTERN.test(value)) return false;
  const fileName = value.slice(value.lastIndexOf("/") + 1);
  return !/^\.+$/.test(fileName);
}

export type SignedUrlFailureReason =
  | "invalid_path" // malformed; no request was sent
  | "not_found" // missing, or not readable by this session (storage does not say which)
  | "failed"; // network or storage error; worth a retry

export type SignedUrlResult =
  | { ok: true; url: string; expiresAt: Date }
  | { ok: false; reason: SignedUrlFailureReason; message: string };

/**
 * The slice of the Supabase client this helper uses. Real clients satisfy it,
 * and tests can pass a small fake without casts.
 */
export interface SignedUrlClient {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{
        data: { signedUrl: string } | null;
        error: { message: string; status?: number } | null;
      }>;
    };
  };
}

// Compile-time proof that the real client fits the narrow interface.
type _RealClientFits =
  SupabaseClient<Database> extends SignedUrlClient ? true : never;
const _realClientFits: _RealClientFits = true;
void _realClientFits;

export interface SignedUrlOptions {
  /** Lifetime in whole seconds, 1 to MAX_SIGNED_URL_TTL_SECONDS. */
  expiresIn?: number;
}

/**
 * Asks Storage for a signed URL for one document file, using the session the
 * client carries. Storage answers "not found" both for a missing object and
 * for one the policy hides, so another user's path looks exactly like a
 * missing one (no existence leak).
 *
 * Expected failures come back as `{ ok: false }` so callers must handle them.
 * A bad `expiresIn` is a programming error and throws `RangeError`.
 * The returned URL is a bearer credential: do not log it.
 */
export async function createDocumentSignedUrl(
  client: SignedUrlClient,
  storagePath: string,
  options: SignedUrlOptions = {},
): Promise<SignedUrlResult> {
  const expiresIn = options.expiresIn ?? DEFAULT_SIGNED_URL_TTL_SECONDS;
  if (
    !Number.isInteger(expiresIn) ||
    expiresIn < 1 ||
    expiresIn > MAX_SIGNED_URL_TTL_SECONDS
  ) {
    throw new RangeError(
      `expiresIn must be a whole number from 1 to ${MAX_SIGNED_URL_TTL_SECONDS} seconds`,
    );
  }

  if (!isDocumentStoragePath(storagePath)) {
    return {
      ok: false,
      reason: "invalid_path",
      message: "Not a valid document storage path.",
    };
  }

  const issuedAt = Date.now();
  let response: Awaited<
    ReturnType<
      ReturnType<SignedUrlClient["storage"]["from"]>["createSignedUrl"]
    >
  >;
  try {
    response = await client.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(storagePath, expiresIn);
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      message: error instanceof Error ? error.message : "Request failed.",
    };
  }

  const { data, error } = response;
  if (error) {
    const notFound =
      error.status === 400 ||
      error.status === 404 ||
      /not found/i.test(error.message);
    return {
      ok: false,
      reason: notFound ? "not_found" : "failed",
      message: error.message,
    };
  }
  if (!data?.signedUrl) {
    return {
      ok: false,
      reason: "failed",
      message: "Storage returned no signed URL.",
    };
  }

  return {
    ok: true,
    url: data.signedUrl,
    expiresAt: new Date(issuedAt + expiresIn * 1000),
  };
}
