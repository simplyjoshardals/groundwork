import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: vi.fn() }));

import { peekUsage } from "@/features/limits/peek-usage";

function fakeClient(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const rpc = vi.fn(async () => result);
  return {
    client: { rpc } as unknown as SupabaseClient<Database>,
    rpc,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("peekUsage", () => {
  it("returns what is left today and calls the read-only function", async () => {
    const { client, rpc } = fakeClient({
      data: [
        {
          used_today: 6,
          daily_limit: 20,
          resets_at: "2026-11-16T00:00:00+00:00",
        },
      ],
      error: null,
    });
    const result = await peekUsage("u1", "question", { client });
    expect(rpc).toHaveBeenCalledWith("peek_usage", {
      p_user_id: "u1",
      p_kind: "question",
    });
    expect(result).toEqual({
      remaining: 14,
      dailyLimit: 20,
      resetsAt: "2026-11-16T00:00:00.000Z",
    });
  });

  it("never reports a negative remainder", async () => {
    const { client } = fakeClient({
      data: [
        { used_today: 25, daily_limit: 20, resets_at: "2026-11-16T00:00:00Z" },
      ],
      error: null,
    });
    expect((await peekUsage("u1", "question", { client }))?.remaining).toBe(0);
  });

  it.each([
    ["an rpc error", { data: null, error: { message: "boom" } }],
    ["no row (unknown user)", { data: [], error: null }],
    [
      "a malformed row",
      { data: [{ used_today: "x", daily_limit: 20, resets_at: "z" }], error: null },
    ],
  ])("returns null for %s instead of throwing", async (_name, result) => {
    const { client } = fakeClient(result);
    expect(await peekUsage("u1", "question", { client })).toBeNull();
  });

  it("returns null when the call itself throws", async () => {
    const client = {
      rpc: vi.fn(async () => {
        throw new Error("network");
      }),
    } as unknown as SupabaseClient<Database>;
    expect(await peekUsage("u1", "question", { client })).toBeNull();
  });
});
