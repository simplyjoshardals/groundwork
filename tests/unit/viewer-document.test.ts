import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getViewerDocument } from "@/lib/documents/get-viewer-document";
import type { Database } from "@/types/database";

const DOC = "7d1c0a52-6f43-4b0e-9a55-2f1f5f2c9a10";

interface FakeResponse {
  data: {
    id: string;
    title: string;
    storage_path: string;
    mime_type: string;
  } | null;
  error: { message: string } | null;
}

/** Records the query chain and answers `maybeSingle` with `response`. */
function fakeClient(response: FakeResponse) {
  const maybeSingle = vi.fn(async () => response);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  // The helper uses only this slice of the client.
  const client = { from } as unknown as SupabaseClient<Database>;
  return { client, from, select, eq, maybeSingle };
}

describe("getViewerDocument", () => {
  it("returns the fields the viewer needs", async () => {
    const { client, from, select, eq } = fakeClient({
      data: {
        id: DOC,
        title: "Employee Handbook",
        storage_path: "samples/handbook.pdf",
        mime_type: "application/pdf",
      },
      error: null,
    });
    await expect(getViewerDocument(client, DOC)).resolves.toEqual({
      ok: true,
      document: {
        id: DOC,
        title: "Employee Handbook",
        storagePath: "samples/handbook.pdf",
        mimeType: "application/pdf",
      },
    });
    expect(from).toHaveBeenCalledWith("documents");
    expect(select).toHaveBeenCalledWith("id, title, storage_path, mime_type");
    expect(eq).toHaveBeenCalledWith("id", DOC);
  });

  it("reports not_found when no row is visible (missing or hidden by RLS)", async () => {
    const { client } = fakeClient({ data: null, error: null });
    await expect(getViewerDocument(client, DOC)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("reports failed on a database or network error", async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: "boom" },
    });
    await expect(getViewerDocument(client, DOC)).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("does not query for a malformed id", async () => {
    const { client, from } = fakeClient({ data: null, error: null });
    await expect(getViewerDocument(client, "../etc")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(from).not.toHaveBeenCalled();
  });
});
