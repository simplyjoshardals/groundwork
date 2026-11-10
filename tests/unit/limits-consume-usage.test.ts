import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: vi.fn() }));

import { consumeUsage, refundUsage } from "@/features/limits/consume-usage";
import {
  limitInfoFor,
  UsageCheckError,
  type DeniedUsage,
} from "@/features/limits/types";
import type { Database } from "@/types/database";

const RESET = "2026-11-10T00:00:00+00:00";
const RESET_ISO = "2026-11-10T00:00:00.000Z";

const row = (overrides: Record<string, unknown> = {}) => ({
  allowed: true,
  reason: "ok",
  used_today: 3,
  daily_limit: 20,
  resets_at: RESET,
  ...overrides,
});

function fakeClient(result: unknown) {
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

describe("consumeUsage", () => {
  it("calls consume_usage with the user id and kind", async () => {
    const { client, rpc } = fakeClient({ data: [row()], error: null });
    await consumeUsage("u1", "question", { client });
    expect(rpc).toHaveBeenCalledWith("consume_usage", {
      p_user_id: "u1",
      p_kind: "question",
    });
  });

  it("maps an allowed row to camelCase with an ISO reset time", async () => {
    const { client } = fakeClient({ data: [row()], error: null });
    expect(await consumeUsage("u1", "ingest", { client })).toEqual({
      allowed: true,
      usedToday: 3,
      dailyLimit: 20,
      resetsAt: RESET_ISO,
    });
  });

  it.each(["user_limit", "cooldown", "global_limit", "not_allowed", "unknown_user"])(
    "maps a %s denial",
    async (reason) => {
      const { client } = fakeClient({
        data: [row({ allowed: false, reason })],
        error: null,
      });
      expect(await consumeUsage("u1", "question", { client })).toEqual({
        allowed: false,
        reason,
        usedToday: 3,
        dailyLimit: 20,
        resetsAt: RESET_ISO,
      });
    },
  );

  describe("fails closed with UsageCheckError", () => {
    it("on an RPC error, without echoing user data", async () => {
      const { client } = fakeClient({
        data: null,
        error: { message: "connection refused" },
      });
      const failure = consumeUsage("user-secret-id", "question", { client });
      await expect(failure).rejects.toBeInstanceOf(UsageCheckError);
      await expect(failure).rejects.not.toThrow(/user-secret-id/);
    });

    it.each([
      ["no rows", { data: [], error: null }],
      ["null data", { data: null, error: null }],
      ["a non-array", { data: row(), error: null }],
      ["a missing field", { data: [row({ used_today: undefined })], error: null }],
      ["a negative count", { data: [row({ used_today: -1 })], error: null }],
      ["a fractional count", { data: [row({ daily_limit: 1.5 })], error: null }],
      ["an invalid reset time", { data: [row({ resets_at: "soon" })], error: null }],
      [
        "an unknown denial reason",
        { data: [row({ allowed: false, reason: "vip" })], error: null },
      ],
      [
        "an allowed row with a denial reason",
        { data: [row({ allowed: true, reason: "cooldown" })], error: null },
      ],
      [
        "a prototype name as reason",
        { data: [row({ allowed: false, reason: "toString" })], error: null },
      ],
    ])("on %s", async (_label, result) => {
      const { client } = fakeClient(result);
      await expect(
        consumeUsage("u1", "question", { client }),
      ).rejects.toBeInstanceOf(UsageCheckError);
    });

    it("when the client itself throws", async () => {
      const client = {
        rpc: vi.fn(async () => {
          throw new Error("network down");
        }),
      } as unknown as SupabaseClient<Database>;
      await expect(consumeUsage("u1", "question", { client })).rejects.toThrow(
        "network down",
      );
    });
  });
});

describe("refundUsage", () => {
  it("calls refund_usage with the user id and kind", async () => {
    const { client, rpc } = fakeClient({ data: null, error: null });
    await refundUsage("u1", "ingest", { client });
    expect(rpc).toHaveBeenCalledWith("refund_usage", {
      p_user_id: "u1",
      p_kind: "ingest",
    });
  });

  it("never throws on an RPC error, and logs only the message", async () => {
    const { client } = fakeClient({ data: null, error: { message: "db down" } });
    await expect(refundUsage("user-secret-id", "question", { client })).resolves
      .toBeUndefined();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("db down");
    expect(logged).not.toContain("user-secret-id");
  });

  it("never throws when the client throws, and logs only name and message", async () => {
    const client = {
      rpc: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    } as unknown as SupabaseClient<Database>;
    await expect(refundUsage("u1", "question", { client })).resolves
      .toBeUndefined();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain(
      "TypeError: fetch failed",
    );
  });
});

describe("limitInfoFor", () => {
  const denied = (reason: DeniedUsage["reason"]): DeniedUsage => ({
    allowed: false,
    reason,
    usedToday: 0,
    dailyLimit: 0,
    resetsAt: RESET_ISO,
  });

  it.each([
    ["user_limit", { scope: "user", reason: "user_limit" }],
    ["cooldown", { scope: "user", reason: "cooldown" }],
    ["global_limit", { scope: "global", reason: "global_limit" }],
    // A limit configured as 0 is a kill switch and shows as the "resting" state.
    ["not_allowed", { scope: "global", reason: "global_limit" }],
  ] as const)("maps %s", (reason, expected) => {
    expect(limitInfoFor(denied(reason))).toEqual({
      ...expected,
      resetsAt: RESET_ISO,
    });
  });

  it("returns null for unknown_user, which callers answer with 401", () => {
    expect(limitInfoFor(denied("unknown_user"))).toBeNull();
  });
});
