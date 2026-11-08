import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** Longest `last_error` we store. Storage errors are short; this is a safety cap. */
export const MAX_LAST_ERROR_LENGTH = 500;
/** Rows handled per run, so one run cannot grow without bound. The script can be run again. */
export const DEFAULT_BATCH_LIMIT = 200;

export interface ProcessStorageDeletionsOptions {
  /** Only handle outbox rows for this exact path (the delete route passes the deleted row's path). */
  path?: string;
  /** Only handle outbox rows for this bucket. Default: any bucket. */
  bucket?: string;
  limit?: number;
}

export interface ProcessStorageDeletionsResult {
  /** Rows marked processed (the file was removed, or was already gone). */
  processed: number;
  /** Rows left pending, with `attempts` and `last_error` updated. */
  failed: number;
}

/** Reading the pending list failed. Individual row failures never throw. */
export class StorageCleanupError extends Error {
  constructor(detail: string) {
    super(`storage cleanup failed: ${detail}`);
    this.name = "StorageCleanupError";
  }
}

/** A missing object is the goal state, so it counts as success (e.g. a failed upload's leftover row). */
function isAlreadyGone(message: string): boolean {
  return /not.?found|no such object|does not exist/i.test(message);
}

function truncate(message: string): string {
  return message.length > MAX_LAST_ERROR_LENGTH
    ? `${message.slice(0, MAX_LAST_ERROR_LENGTH)}…`
    : message;
}

/**
 * Removes the Storage files queued in `storage_deletions` (Task 4.7).
 *
 * The client MUST be the service-role client: only that role can read or write
 * the outbox. It is passed in, as with `createSupabaseIngestStore`.
 *
 * Safe to repeat and to run twice at once: removing a missing file is not an
 * error, and marking a row processed twice changes nothing, so no claim step is
 * needed. A failing row gets `attempts + 1` and `last_error` and stays pending
 * for the next run; it never stops the other rows. There is no retry cap
 * (decision for Task 4.7): `attempts` and `last_error` are the visible signal.
 */
export async function processStorageDeletions(
  client: SupabaseClient<Database>,
  options: ProcessStorageDeletionsOptions = {},
): Promise<ProcessStorageDeletionsResult> {
  let query = client
    .from("storage_deletions")
    .select("id, bucket, path, attempts")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(options.limit ?? DEFAULT_BATCH_LIMIT);
  if (options.path !== undefined) query = query.eq("path", options.path);
  if (options.bucket !== undefined) query = query.eq("bucket", options.bucket);

  const { data: rows, error } = await query;
  if (error) throw new StorageCleanupError(error.message);

  const result: ProcessStorageDeletionsResult = { processed: 0, failed: 0 };

  for (const row of rows) {
    let removeError: string | null = null;
    try {
      const { error: storageError } = await client.storage
        .from(row.bucket)
        .remove([row.path]);
      if (storageError && !isAlreadyGone(storageError.message)) {
        removeError = storageError.message;
      }
    } catch (thrown) {
      removeError = thrown instanceof Error ? thrown.message : "unknown error";
    }

    const update =
      removeError === null
        ? { processed_at: new Date().toISOString(), last_error: null }
        : { attempts: row.attempts + 1, last_error: truncate(removeError) };

    const { error: updateError } = await client
      .from("storage_deletions")
      .update(update)
      .eq("id", row.id);

    // If recording the result fails, the row stays pending and is retried next
    // run. Removing the file again is harmless, so this counts as a failure.
    if (removeError === null && !updateError) result.processed += 1;
    else result.failed += 1;
  }

  return result;
}
