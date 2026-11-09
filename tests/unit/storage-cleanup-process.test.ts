import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MAX_LAST_ERROR_LENGTH,
  StorageCleanupError,
  processStorageDeletions,
} from "@/features/storage-cleanup/process-storage-deletions";
import type { Database } from "@/types/database";

interface Row {
  id: number;
  bucket: string;
  path: string;
  attempts: number;
}

/** Records the select filters, storage removes and outbox updates. */
function fakeClient(options: {
  rows: Row[];
  selectError?: string;
  remove?: (
    bucket: string,
    path: string,
  ) => Promise<{ error: { message: string } | null }>;
  updateError?: boolean;
}) {
  const filters: [string, unknown][] = [];
  const updates: { id: unknown; values: Record<string, unknown> }[] = [];
  const removed: [string, string][] = [];

  const select = {
    is: vi.fn(
      (col: string, v: unknown) => (filters.push([`is:${col}`, v]), select),
    ),
    order: vi.fn(() => select),
    limit: vi.fn(() => select),
    eq: vi.fn((col: string, v: unknown) => (filters.push([col, v]), select)),
    then: (resolve: (v: unknown) => unknown) =>
      resolve(
        options.selectError
          ? { data: null, error: { message: options.selectError } }
          : { data: options.rows, error: null },
      ),
  };
  const from = vi.fn(() => ({
    select: vi.fn(() => select),
    update: vi.fn((values: Record<string, unknown>) => ({
      eq: vi.fn(async (_col: string, id: unknown) => {
        updates.push({ id, values });
        return { error: options.updateError ? { message: "x" } : null };
      }),
    })),
  }));
  const storage = {
    from: vi.fn((bucket: string) => ({
      remove: vi.fn(async (paths: string[]) => {
        removed.push([bucket, paths[0]]);
        return (options.remove ?? (async () => ({ error: null })))(
          bucket,
          paths[0],
        );
      }),
    })),
  };
  return {
    client: { from, storage } as unknown as SupabaseClient<Database>,
    filters,
    updates,
    removed,
  };
}

const row = (id: number, path = `u/d${id}/a.pdf`): Row => ({
  id,
  bucket: "documents",
  path,
  attempts: 0,
});

describe("processStorageDeletions", () => {
  it("removes each file and marks the row processed", async () => {
    const f = fakeClient({ rows: [row(1), row(2)] });
    const result = await processStorageDeletions(f.client);
    expect(result).toEqual({ processed: 2, failed: 0 });
    expect(f.removed).toEqual([
      ["documents", "u/d1/a.pdf"],
      ["documents", "u/d2/a.pdf"],
    ]);
    expect(f.updates).toHaveLength(2);
    expect(f.updates[0].values.processed_at).toEqual(expect.any(String));
    expect(f.updates[0].values.last_error).toBeNull();
    expect(f.filters).toContainEqual(["is:processed_at", null]);
  });

  it("applies the path and bucket filters when given", async () => {
    const f = fakeClient({ rows: [] });
    await processStorageDeletions(f.client, {
      path: "u/d/a.pdf",
      bucket: "documents",
    });
    expect(f.filters).toContainEqual(["path", "u/d/a.pdf"]);
    expect(f.filters).toContainEqual(["bucket", "documents"]);
  });

  it("records attempts and a truncated last_error on failure, and keeps going", async () => {
    const f = fakeClient({
      rows: [{ ...row(1), attempts: 2 }, row(2)],
      remove: async (_b, path) =>
        path.includes("d1")
          ? { error: { message: "x".repeat(MAX_LAST_ERROR_LENGTH + 100) } }
          : { error: null },
    });
    const result = await processStorageDeletions(f.client);
    expect(result).toEqual({ processed: 1, failed: 1 });
    const failed = f.updates.find((u) => u.id === 1)!;
    expect(failed.values.attempts).toBe(3);
    expect(failed.values).not.toHaveProperty("processed_at");
    expect((failed.values.last_error as string).length).toBe(
      MAX_LAST_ERROR_LENGTH + 1,
    );
    expect(f.updates.find((u) => u.id === 2)!.values.processed_at).toEqual(
      expect.any(String),
    );
  });

  it("treats a thrown storage call as a failed row, not a crash", async () => {
    const f = fakeClient({
      rows: [row(1)],
      remove: async () => {
        throw new Error("network down");
      },
    });
    expect(await processStorageDeletions(f.client)).toEqual({
      processed: 0,
      failed: 1,
    });
    expect(f.updates[0].values.last_error).toBe("network down");
  });

  it("counts a missing object as processed", async () => {
    const f = fakeClient({
      rows: [row(1)],
      remove: async () => ({ error: { message: "Object not found" } }),
    });
    expect(await processStorageDeletions(f.client)).toEqual({
      processed: 1,
      failed: 0,
    });
  });

  it("counts a row as failed when its result cannot be recorded", async () => {
    const f = fakeClient({ rows: [row(1)], updateError: true });
    expect(await processStorageDeletions(f.client)).toEqual({
      processed: 0,
      failed: 1,
    });
  });

  it("throws StorageCleanupError when the pending list cannot be read", async () => {
    const f = fakeClient({ rows: [], selectError: "permission denied" });
    await expect(processStorageDeletions(f.client)).rejects.toBeInstanceOf(
      StorageCleanupError,
    );
  });
});
