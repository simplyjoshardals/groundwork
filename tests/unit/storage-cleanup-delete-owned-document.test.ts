import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: vi.fn() }));

import {
  DeleteDocumentError,
  deleteOwnedDocument,
} from "@/features/storage-cleanup/delete-owned-document";
import type { Database } from "@/types/database";

const ID = "123e4567-e89b-42d3-a456-426614174000";

function fakeClient(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const eq = vi.fn();
  const chain = {
    delete: vi.fn(),
    eq,
    select: vi.fn(async () => result),
  };
  chain.delete.mockReturnValue(chain);
  eq.mockReturnValue(chain);
  const from = vi.fn(() => chain);
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    eq,
    select: chain.select,
  };
}

const input = (client: SupabaseClient<Database>) => ({
  supabase: client,
  userId: "u1",
  documentId: ID,
});

describe("deleteOwnedDocument", () => {
  it("deletes as the user with explicit owner and private filters", async () => {
    const { client, from, eq, select } = fakeClient({
      data: [{ storage_path: "u1/d/a.pdf" }],
      error: null,
    });
    await deleteOwnedDocument(input(client), {
      cleanup: async () => ({ processed: 1, failed: 0 }),
    });
    expect(from).toHaveBeenCalledWith("documents");
    expect(eq.mock.calls).toEqual([
      ["id", ID],
      ["owner_id", "u1"],
      ["is_public", false],
    ]);
    expect(select).toHaveBeenCalledWith("storage_path");
  });

  it("returns not_found and does no cleanup when no row matched", async () => {
    const { client } = fakeClient({ data: [], error: null });
    const cleanup = vi.fn();
    expect(await deleteOwnedDocument(input(client), { cleanup })).toEqual({
      status: "not_found",
    });
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("cleans up only the deleted row's path", async () => {
    const { client } = fakeClient({
      data: [{ storage_path: "u1/d/a.pdf" }],
      error: null,
    });
    const cleanup = vi.fn(async () => ({ processed: 1, failed: 0 }));
    const outcome = await deleteOwnedDocument(input(client), { cleanup });
    expect(cleanup).toHaveBeenCalledWith("u1/d/a.pdf");
    expect(outcome).toEqual({ status: "deleted", fileRemoved: true });
  });

  it("reports fileRemoved false when the cleanup left a row pending", async () => {
    const { client } = fakeClient({
      data: [{ storage_path: "p" }],
      error: null,
    });
    expect(
      await deleteOwnedDocument(input(client), {
        cleanup: async () => ({ processed: 0, failed: 1 }),
      }),
    ).toEqual({ status: "deleted", fileRemoved: false });
  });

  it("does not throw when the cleanup throws; it returns the error", async () => {
    const { client } = fakeClient({
      data: [{ storage_path: "p" }],
      error: null,
    });
    const boom = new Error("boom");
    const outcome = await deleteOwnedDocument(input(client), {
      cleanup: async () => {
        throw boom;
      },
    });
    expect(outcome).toEqual({
      status: "deleted",
      fileRemoved: false,
      cleanupError: boom,
    });
  });

  it("throws DeleteDocumentError when the row delete fails, without cleanup", async () => {
    const { client } = fakeClient({ data: null, error: { message: "rls" } });
    const cleanup = vi.fn();
    await expect(
      deleteOwnedDocument(input(client), { cleanup }),
    ).rejects.toBeInstanceOf(DeleteDocumentError);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
