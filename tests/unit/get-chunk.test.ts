import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getChunk } from "@/lib/documents/get-chunk";
import type { Database } from "@/types/database";

const DOC = "7d1c0a52-6f43-4b0e-9a55-2f1f5f2c9a10";

interface FakeResponse {
  data: {
    id: number;
    document_id: string;
    page_number: number;
    char_start: number;
    char_end: number;
    content: string;
  } | null;
  error: { message: string } | null;
}

/** Records the query chain and answers `maybeSingle` with `response`. */
function fakeClient(response: FakeResponse) {
  const maybeSingle = vi.fn(async () => response);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn((columns: string) => ({ eq, columns }));
  const from = vi.fn(() => ({ select }));
  // The helper uses only this slice of the client.
  const client = { from } as unknown as SupabaseClient<Database>;
  return { client, from, select, eq };
}

describe("getChunk", () => {
  it("returns the passage, text and offsets for a visible chunk", async () => {
    const { client, from, select, eq } = fakeClient({
      data: {
        id: 42,
        document_id: DOC,
        page_number: 3,
        char_start: 120,
        char_end: 305,
        content: "Remote employees must be reachable during core hours.",
      },
      error: null,
    });
    await expect(getChunk(client, "42")).resolves.toEqual({
      ok: true,
      chunk: {
        id: "42",
        documentId: DOC,
        pageNumber: 3,
        charStart: 120,
        charEnd: 305,
        content: "Remote employees must be reachable during core hours.",
      },
    });
    expect(from).toHaveBeenCalledWith("chunks");
    expect(eq).toHaveBeenCalledWith("id", 42);
    // Explicit columns, and never the embedding vector.
    const columns = String(select.mock.calls[0]?.[0]);
    expect(columns).toBe(
      "id, document_id, page_number, char_start, char_end, content",
    );
    expect(columns).not.toContain("embedding");
  });

  it("reports not_found when no row is visible (missing or hidden by RLS)", async () => {
    const { client } = fakeClient({ data: null, error: null });
    await expect(getChunk(client, "42")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("reports failed on a database or network error", async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: "boom" },
    });
    await expect(getChunk(client, "42")).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it.each([
    "",
    "0",
    "007",
    "-1",
    "1.5",
    "1e3",
    "abc",
    "42 OR 1=1",
    "1".repeat(16),
  ])("does not query for a malformed id (%j)", async (id) => {
    const { client, from } = fakeClient({ data: null, error: null });
    await expect(getChunk(client, id)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(from).not.toHaveBeenCalled();
  });
});
