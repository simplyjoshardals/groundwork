import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import {
  processStorageDeletions,
  type ProcessStorageDeletionsResult,
} from "./process-storage-deletions";

export interface DeleteOwnedDocumentInput {
  /** The caller's own client (session cookies, RLS applies). Never the admin client. */
  supabase: SupabaseClient<Database>;
  /** The authenticated user's id (`sub` claim). */
  userId: string;
  documentId: string;
}

export type DeleteOwnedDocumentOutcome =
  | { status: "not_found" }
  /** The row (and its chunks) are gone. `fileRemoved` says whether the Storage file went too. */
  | { status: "deleted"; fileRemoved: boolean; cleanupError?: unknown };

/** The row delete itself failed, so nothing was deleted. */
export class DeleteDocumentError extends Error {
  constructor(detail: string) {
    super(`delete document failed: ${detail}`);
    this.name = "DeleteDocumentError";
  }
}

/** Replaceable in tests. The default is the real admin client. */
export interface DeleteOwnedDocumentDeps {
  cleanup?: (path: string) => Promise<ProcessStorageDeletionsResult>;
}

/**
 * Deletes a document the caller owns, then removes its file (Task 4.7).
 *
 * Row first, file second (DATA_MODEL 5): the row is deleted as the user, with
 * an explicit `owner_id` and `is_public = false` filter. RLS alone would let a
 * user match a shared sample they can see but not own. Chunks cascade, and the
 * `documents_ad_outbox` trigger queues the file in `storage_deletions`. Someone
 * else's id and a missing id look the same (`not_found`).
 *
 * The file is then removed through the outbox, for that one path only, taken
 * from the deleted row and never from the client. A cleanup failure does not
 * undo or fail the delete: the row is already gone and the leftover outbox row
 * is picked up by `yarn cleanup:storage`. The admin client lives here, never
 * in a route.
 *
 * Throws `DeleteDocumentError` only when the row delete itself fails.
 */
export async function deleteOwnedDocument(
  input: DeleteOwnedDocumentInput,
  deps: DeleteOwnedDocumentDeps = {},
): Promise<DeleteOwnedDocumentOutcome> {
  const { supabase, userId, documentId } = input;

  const { data, error } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("owner_id", userId)
    .eq("is_public", false)
    .select("storage_path");
  if (error) throw new DeleteDocumentError(error.message);
  if (data.length === 0) return { status: "not_found" };

  const path = data[0].storage_path;
  const cleanup =
    deps.cleanup ??
    ((p: string) =>
      processStorageDeletions(createAdminSupabase(), { path: p }));

  try {
    const { processed, failed } = await cleanup(path);
    return { status: "deleted", fileRemoved: processed > 0 && failed === 0 };
  } catch (cleanupError) {
    return { status: "deleted", fileRemoved: false, cleanupError };
  }
}
