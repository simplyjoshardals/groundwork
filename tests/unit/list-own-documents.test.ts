import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listOwnDocuments } from "@/lib/documents/list-own-documents";
import type { Database } from "@/types/database";

type QueryResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

/** Records the query chain and resolves with `result` (or rejects when it is an Error). */
function fakeClient(result: QueryResult | Error) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder = {
    select: (...args: unknown[]) => {
      calls.push({ method: "select", args });
      return builder;
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: "eq", args });
      return builder;
    },
    order: async (...args: unknown[]) => {
      calls.push({ method: "order", args });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  const from = vi.fn((table: string) => {
    calls.push({ method: "from", args: [table] });
    return builder;
  });
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    calls,
  };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Report",
  original_filename: "report.pdf",
  status: "ready",
  error_reason: null,
  page_count: 3,
  chunk_count: 7,
  created_at: "2026-11-08T10:00:00.000Z",
  processing_started_at: null,
  ...overrides,
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("listOwnDocuments", () => {
  it("queries own, non-public documents newest first with explicit columns", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await listOwnDocuments(client);

    expect(calls[0]).toEqual({ method: "from", args: ["documents"] });
    const select = calls.find((c) => c.method === "select");
    expect(select?.args[0]).not.toMatch(/\*/);
    expect(calls).toContainEqual({ method: "eq", args: ["is_public", false] });
    expect(calls).toContainEqual({
      method: "order",
      args: ["created_at", { ascending: false }],
    });
  });

  it("maps rows to camelCase documents", async () => {
    const { client } = fakeClient({ data: [row()], error: null });
    expect(await listOwnDocuments(client)).toEqual({
      ok: true,
      documents: [
        {
          id: "123e4567-e89b-42d3-a456-426614174000",
          title: "Report",
          originalFilename: "report.pdf",
          status: "ready",
          errorReason: null,
          pageCount: 3,
          chunkCount: 7,
          createdAt: "2026-11-08T10:00:00.000Z",
          processingStartedAt: null,
        },
      ],
    });
  });

  it("returns an empty list as a successful result", async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await listOwnDocuments(client)).toEqual({ ok: true, documents: [] });
  });

  it("keeps a failed row's reason and a processing row's start time", async () => {
    const { client } = fakeClient({
      data: [
        row({
          status: "failed",
          error_reason: "scanned_pdf",
          page_count: null,
        }),
        row({
          id: "223e4567-e89b-42d3-a456-426614174000",
          status: "processing",
          processing_started_at: "2026-11-08T10:01:00.000Z",
          page_count: null,
          chunk_count: 0,
        }),
      ],
      error: null,
    });
    const result = await listOwnDocuments(client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.documents[0]).toMatchObject({
      status: "failed",
      errorReason: "scanned_pdf",
    });
    expect(result.documents[1]).toMatchObject({
      status: "processing",
      processingStartedAt: "2026-11-08T10:01:00.000Z",
    });
  });

  it("returns an explicit error when the query fails, without leaking its message", async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: "PGRST301", message: "secret internal detail" },
    });
    expect(await listOwnDocuments(client)).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(
      /secret/,
    );
  });

  it("returns an explicit error when the call throws", async () => {
    const { client } = fakeClient(new TypeError("Failed to fetch"));
    expect(await listOwnDocuments(client)).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("returns invalid_data when data is not an array", async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await listOwnDocuments(client)).toEqual({
      ok: false,
      reason: "invalid_data",
    });
  });

  it.each([
    ["an unknown status", { status: "weird" }],
    ["a missing id", { id: "" }],
    ["a non-string title", { title: 5 }],
    ["a negative chunk count", { chunk_count: -1 }],
    ["a non-integer page count", { page_count: 1.5 }],
    ["a non-string error reason", { error_reason: 4 }],
    ["a missing created_at", { created_at: null }],
    ["a numeric processing_started_at", { processing_started_at: 1 }],
  ])(
    "returns invalid_data for a row with %s, not a silent partial list",
    async (_n, bad) => {
      const { client } = fakeClient({
        data: [row(), row(bad)],
        error: null,
      });
      expect(await listOwnDocuments(client)).toEqual({
        ok: false,
        reason: "invalid_data",
      });
    },
  );
});
