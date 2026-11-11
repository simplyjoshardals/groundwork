import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const processStorageDeletions = vi.fn();
vi.mock("@/features/storage-cleanup/process-storage-deletions", () => ({
  processStorageDeletions: (...args: unknown[]) =>
    processStorageDeletions(...args),
}));

import {
  isMaintenanceJob,
  MAINTENANCE_JOBS,
  MAX_DETAIL_LENGTH,
  runMaintenance,
} from "@/features/maintenance";
import type { Database } from "@/types/database";

interface RpcReply {
  data: unknown;
  error: { message: string } | null;
}

/** Records the rpc names and the table read; replies are set per function name. */
function fakeAdmin(options: {
  rpc?: Partial<Record<string, RpcReply>>;
  keepAlive?: {
    data: { id: string }[] | null;
    error: { message: string } | null;
  };
}) {
  const rpcCalls: string[] = [];
  const tablesRead: string[] = [];
  const admin = {
    rpc: vi.fn((fn: string) => {
      rpcCalls.push(fn);
      return Promise.resolve(options.rpc?.[fn] ?? { data: 0, error: null });
    }),
    from: vi.fn((table: string) => {
      tablesRead.push(table);
      return {
        select: () => ({
          limit: () =>
            Promise.resolve(
              options.keepAlive ?? { data: [{ id: "x" }], error: null },
            ),
        }),
      };
    }),
  } as unknown as SupabaseClient<Database>;
  return { admin, rpcCalls, tablesRead };
}

describe("runMaintenance", () => {
  beforeEach(() => {
    processStorageDeletions.mockReset();
    processStorageDeletions.mockResolvedValue({ processed: 4, failed: 0 });
  });

  it("runs every job in order and reports a count for each", async () => {
    const { admin, rpcCalls, tablesRead } = fakeAdmin({
      rpc: {
        reap_documents: { data: 2, error: null },
        purge_stale_anonymous_users: { data: 7, error: null },
        purge_old_records: { data: 31, error: null },
      },
    });

    const results = await runMaintenance(admin, MAINTENANCE_JOBS);

    expect(results).toEqual([
      { job: "reap-documents", ok: true, count: 2 },
      { job: "purge-anonymous-users", ok: true, count: 7 },
      { job: "purge-old-records", ok: true, count: 31 },
      { job: "storage-outbox", ok: true, count: 4 },
      { job: "keep-alive", ok: true, count: 1 },
    ]);
    expect(rpcCalls).toEqual([
      "reap_documents",
      "purge_stale_anonymous_users",
      "purge_old_records",
    ]);
    expect(tablesRead).toEqual(["documents"]);
  });

  it("runs only the jobs it is given", async () => {
    const { admin, rpcCalls } = fakeAdmin({});
    const results = await runMaintenance(admin, ["purge-old-records"]);
    expect(results.map((r) => r.job)).toEqual(["purge-old-records"]);
    expect(rpcCalls).toEqual(["purge_old_records"]);
    expect(processStorageDeletions).not.toHaveBeenCalled();
  });

  it("keeps going when one job fails, and reports it", async () => {
    const { admin } = fakeAdmin({
      rpc: {
        reap_documents: { data: null, error: { message: "boom" } },
        purge_old_records: { data: 5, error: null },
      },
    });

    const results = await runMaintenance(admin, MAINTENANCE_JOBS);

    expect(results[0]).toEqual({
      job: "reap-documents",
      ok: false,
      count: null,
      detail: "boom",
    });
    expect(results.slice(1).every((r) => r.ok)).toBe(true);
    expect(results[2]).toMatchObject({ job: "purge-old-records", count: 5 });
  });

  it("does not log a malformed rpc result as a count", async () => {
    const { admin } = fakeAdmin({
      rpc: { purge_old_records: { data: "many", error: null } },
    });
    const [result] = await runMaintenance(admin, ["purge-old-records"]);
    expect(result).toMatchObject({ ok: false, count: null });
    expect(result?.detail).toContain("unexpected result");
  });

  it("marks the outbox job failed when rows failed, but still reports the count", async () => {
    processStorageDeletions.mockResolvedValue({ processed: 3, failed: 2 });
    const { admin } = fakeAdmin({});
    const [result] = await runMaintenance(admin, ["storage-outbox"]);
    expect(result).toEqual({
      job: "storage-outbox",
      ok: false,
      count: 3,
      detail: "2 row(s) failed",
    });
  });

  it("turns a thrown outbox error into a failed result", async () => {
    processStorageDeletions.mockRejectedValue(new Error("cannot read outbox"));
    const { admin } = fakeAdmin({});
    const results = await runMaintenance(admin, [
      "storage-outbox",
      "keep-alive",
    ]);
    expect(results[0]).toMatchObject({ ok: false, count: null });
    expect(results[0]?.detail).toBe("cannot read outbox");
    expect(results[1]).toMatchObject({ job: "keep-alive", ok: true });
  });

  it("fails the keep-alive when the read errors", async () => {
    const { admin } = fakeAdmin({
      keepAlive: { data: null, error: { message: "project paused" } },
    });
    const [result] = await runMaintenance(admin, ["keep-alive"]);
    expect(result).toEqual({
      job: "keep-alive",
      ok: false,
      count: null,
      detail: "project paused",
    });
  });

  it("counts an empty table as a successful keep-alive read", async () => {
    const { admin } = fakeAdmin({ keepAlive: { data: [], error: null } });
    const [result] = await runMaintenance(admin, ["keep-alive"]);
    expect(result).toEqual({ job: "keep-alive", ok: true, count: 0 });
  });

  it("caps a long error message", async () => {
    const { admin } = fakeAdmin({
      rpc: {
        reap_documents: { data: null, error: { message: "x".repeat(2000) } },
      },
    });
    const [result] = await runMaintenance(admin, ["reap-documents"]);
    expect(result?.detail?.length).toBeLessThanOrEqual(MAX_DETAIL_LENGTH + 1);
  });
});

describe("isMaintenanceJob", () => {
  it("accepts the five job names and nothing else", () => {
    for (const job of MAINTENANCE_JOBS)
      expect(isMaintenanceJob(job)).toBe(true);
    expect(MAINTENANCE_JOBS).toHaveLength(5);
    expect(isMaintenanceJob("all")).toBe(false);
    expect(isMaintenanceJob("reap_documents")).toBe(false);
    expect(isMaintenanceJob("")).toBe(false);
  });
});
