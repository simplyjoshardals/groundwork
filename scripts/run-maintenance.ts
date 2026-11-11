/**
 * Scheduled maintenance (Task 5.6): reap documents, purge stale anonymous users,
 * purge old records, process the storage outbox, and a keep-alive read. Run by
 * `.github/workflows/maintenance.yml`; safe to run by hand any time.
 *
 *   yarn maintenance [all | <job> ...] [--allow-remote]
 *
 * Jobs: reap-documents, purge-anonymous-users, purge-old-records, storage-outbox,
 * keep-alive. Prints one line per job (a count, never document content) and
 * exits 1 if any job failed. Refuses a non-local Supabase URL without --allow-remote.
 */
import {
  isMaintenanceJob,
  MAINTENANCE_JOBS,
  runMaintenance,
  type MaintenanceJob,
} from "@/features/maintenance";
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

/** Returns the jobs to run, or an error message for an unknown name. */
function parseJobs(names: string[]): MaintenanceJob[] | string {
  if (names.length === 0 || names.includes("all")) return [...MAINTENANCE_JOBS];
  const jobs: MaintenanceJob[] = [];
  for (const name of names) {
    if (!isMaintenanceJob(name)) {
      return `Unknown job "${name.slice(0, 40)}". Use all or: ${MAINTENANCE_JOBS.join(", ")}.`;
    }
    if (!jobs.includes(name)) jobs.push(name);
  }
  return jobs;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const allowRemote = args.includes("--allow-remote");
  const jobs = parseJobs(args.filter((arg) => !arg.startsWith("--")));
  if (typeof jobs === "string") {
    console.error(jobs);
    return 1;
  }

  if (!allowRemote && !isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    console.error(
      "Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a local address. Pass --allow-remote to run against a remote project.",
    );
    return 1;
  }

  const results = await runMaintenance(createAdminSupabase(), jobs);
  for (const { job, ok, count, detail } of results) {
    const countText = count === null ? "no count" : `count ${count}`;
    const detailText = detail ? ` (${detail})` : "";
    console.info(
      `maintenance ${job}: ${ok ? "ok" : "FAILED"}, ${countText}${detailText}`,
    );
  }
  return results.every((result) => result.ok) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // Typically a missing environment variable; the message names the variable, never its value.
    console.error(
      "maintenance failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exit(1);
  },
);
