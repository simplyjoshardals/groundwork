import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.fn();
const createServerSupabase = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: () => createServerSupabase(),
}));

import { GET } from "@/app/auth/callback/route";

function call(search: string) {
  return GET(new NextRequest(`http://localhost:3000/auth/callback${search}`));
}

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  createServerSupabase.mockReset();
  createServerSupabase.mockResolvedValue({ auth: { exchangeCodeForSession } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /auth/callback", () => {
  it("exchanges the code and redirects to a safe next path", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await call("?code=abc&next=%2F%3Fdoc%3D1");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(res.headers.get("location")).toBe("http://localhost:3000/?doc=1");
  });

  it("ignores an external next and goes home", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await call("?code=abc&next=https%3A%2F%2Fevil.example");
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
    const res2 = await call("?code=abc&next=%2F%2Fevil.example");
    expect(res2.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("sends a missing or oversized code to sign-in without calling Supabase", async () => {
    for (const search of ["", `?code=${"a".repeat(600)}`]) {
      const res = await call(search);
      expect(res.headers.get("location")).toBe(
        "http://localhost:3000/sign-in?error=callback",
      );
    }
    expect(createServerSupabase).not.toHaveBeenCalled();
  });

  it("sends a failed exchange to sign-in and does not leak the reason", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: { name: "AuthApiError", message: "secret detail" },
    });
    const res = await call("?code=abc");
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/sign-in?error=callback",
    );
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).not.toContain(
      "secret detail",
    );
  });

  it("handles a thrown error the same way", async () => {
    createServerSupabase.mockRejectedValue(new Error("boom"));
    const res = await call("?code=abc");
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/sign-in?error=callback",
    );
  });
});
