import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getClaims = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { getClaims } }),
}));

import { getSessionCheck, getSessionState } from "@/lib/auth/session";

class FakeAuthError extends Error {
  constructor(
    name: string,
    readonly status?: number,
  ) {
    super("x");
    this.name = name;
  }
}

beforeEach(() => {
  getClaims.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("getSessionCheck (Task 5.9)", () => {
  it("reports an unreachable auth service as unavailable", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new FakeAuthError("AuthRetryableFetchError", 0),
    });
    expect(await getSessionCheck()).toEqual({ status: "unavailable" });
  });

  it("still treats an invalid session as signed out", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new FakeAuthError("AuthInvalidJwtError", 401),
    });
    expect(await getSessionCheck()).toEqual({ status: "signed_out" });
  });

  it("treats no session (no error, no claims) as signed out", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    expect(await getSessionCheck()).toEqual({ status: "signed_out" });
  });

  it("returns the signed-in state from valid claims", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u1", email: "a@b.c", is_anonymous: false } },
      error: null,
    });
    expect(await getSessionCheck()).toEqual({
      status: "signed_in",
      isAnonymous: false,
      email: "a@b.c",
    });
  });

  it("logs the error name, never a message or token", async () => {
    const error = new FakeAuthError("AuthRetryableFetchError", 0);
    error.message = "SECRET-MESSAGE";
    getClaims.mockResolvedValue({ data: null, error });
    await getSessionCheck();
    const line = String(vi.mocked(console.warn).mock.calls[0]?.[0]);
    expect(line).toContain("AuthRetryableFetchError");
    expect(line).not.toContain("SECRET-MESSAGE");
  });
});

describe("getSessionState", () => {
  it("keeps its old behaviour: unavailable counts as signed out", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new FakeAuthError("AuthRetryableFetchError", 0),
    });
    expect(await getSessionState()).toEqual({ status: "signed_out" });
  });
});
