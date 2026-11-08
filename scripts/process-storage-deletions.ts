/**
 * Removes Storage files left in the `storage_deletions` outbox (Task 4.7):
 * files whose delete request failed after the row was gone, and rows queued by a
 * failed upload's cleanup. Safe to run any time and as often as needed.
 *
 *   yarn cleanup:storage [--allow-remote]
 *
 * Prints counts only. Refuses a non-local Supabase URL without --allow-remote.
 */
import { processStorageDeletions } from "@/features/storage-cleanup";
import { createAdminSupabase } from "@/lib/supabase/admin";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLocalUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const allowRemote = process.argv.includes("--allow-remote");
  if (!allowRemote && !isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    console.error(
      "Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a local address. Pass --allow-remote to clean a remote project.",
    );
    return 1;
  }

  const { processed, failed } = await processStorageDeletions(
    createAdminSupabase(),
  );
  console.info(`storage cleanup: ${processed} removed, ${failed} failed`);
  if (failed > 0) {
    console.info(
      "Failed rows stay pending with attempts and last_error set in storage_deletions.",
    );
  }
  return failed > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      "storage cleanup failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exit(1);
  },
);
