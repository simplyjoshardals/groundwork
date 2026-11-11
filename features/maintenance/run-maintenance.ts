import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { processStorageDeletions } from "@/features/storage-cleanup/process-storage-deletions";

/**
 * Scheduled maintenance (Task 5.6). Each job runs with the service-role client,
 * which is passed in (as with `processStorageDeletions`), and reports a result
 * instead of throwing, so one failing job never stops the others.
 */
export const MAINTENANCE_JOBS = [
  "reap-documents",
  "purge-anonymous-users",
  "purge-old-records",
  "storage-outbox",
  "keep-alive",
] as const;

export type MaintenanceJob = (typeof MAINTENANCE_JOBS)[number];

export interface MaintenanceResult {
  job: MaintenanceJob;
  ok: boolean;
  /** Rows removed (or, for keep-alive, rows read). Null when the job failed outright. */
  count: number | null;
  /** Short note for the log: an error message, or the number of failed outbox rows. */
  detail?: string;
}

/** Longest error text we log per job; database errors are short, this is a safety cap. */
export const MAX_DETAIL_LENGTH = 300;

export function isMaintenanceJob(value: string): value is MaintenanceJob {
  return (MAINTENANCE_JOBS as readonly string[]).includes(value);
}

type Admin = SupabaseClient<Database>;

type JobOutcome = { count: number; detail?: string; ok?: boolean };

/** The three SQL functions return the number of rows they removed. */
async function callCountFunction(
  admin: Admin,
  fn: "reap_documents" | "purge_stale_anonymous_users" | "purge_old_records",
): Promise<JobOutcome> {
  const { data, error } = await admin.rpc(fn);
  if (error) throw new Error(error.message);
  // The generated type says `number`, but a wrong shape must not be logged as a count.
  if (typeof data !== "number" || !Number.isInteger(data) || data < 0) {
    throw new Error(`${fn} returned an unexpected result`);
  }
  return { count: data };
}

async function runStorageOutbox(admin: Admin): Promise<JobOutcome> {
  const { processed, failed } = await processStorageDeletions(admin);
  return failed > 0
    ? { count: processed, ok: false, detail: `${failed} row(s) failed` }
    : { count: processed };
}

/**
 * A tiny real read through the API. Supabase pauses a free project that sees too
 * little database activity over 7 days; a query like this counts (Task 5.6 notes).
 */
async function runKeepAlive(admin: Admin): Promise<JobOutcome> {
  const { data, error } = await admin.from("documents").select("id").limit(1);
  if (error) throw new Error(error.message);
  return { count: data.length };
}

const RUNNERS: Record<MaintenanceJob, (admin: Admin) => Promise<JobOutcome>> = {
  "reap-documents": (admin) => callCountFunction(admin, "reap_documents"),
  "purge-anonymous-users": (admin) =>
    callCountFunction(admin, "purge_stale_anonymous_users"),
  "purge-old-records": (admin) => callCountFunction(admin, "purge_old_records"),
  "storage-outbox": runStorageOutbox,
  "keep-alive": runKeepAlive,
};

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";
  return message.length > MAX_DETAIL_LENGTH
    ? `${message.slice(0, MAX_DETAIL_LENGTH)}…`
    : message;
}

/** Runs the jobs one after another, in the order given. Never throws. */
export async function runMaintenance(
  admin: Admin,
  jobs: readonly MaintenanceJob[],
): Promise<MaintenanceResult[]> {
  const results: MaintenanceResult[] = [];
  for (const job of jobs) {
    try {
      const outcome = await RUNNERS[job](admin);
      results.push({
        job,
        ok: outcome.ok ?? true,
        count: outcome.count,
        ...(outcome.detail ? { detail: outcome.detail } : {}),
      });
    } catch (error) {
      results.push({
        job,
        ok: false,
        count: null,
        detail: describeError(error),
      });
    }
  }
  return results;
}
