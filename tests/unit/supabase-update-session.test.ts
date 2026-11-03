import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type SetAll = (
  cookies: { name: string; value: string; options: Record<string, unknown> }[],
  headers: Record<string, string>,
) => void;
type CapturedOptions = {
  cookies: {
    getAll: () => { name: string; value: string }[];
    setAll: SetAll;
  };
};

const getClaims = vi.fn();
let captured: CapturedOptions | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: CapturedOptions,
  ) => {
    captured = options;
    return { auth: { getClaims } };
  },
}));

beforeEach(() => {
  captured = null;
  getClaims.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function makeRequest() {
  return new NextRequest("http://localhost:3000/", {
    headers: { cookie: "sb-local-auth-token=old; other=1" },
  });
}

describe("updateSession", () => {
  it("lets the request continue and reads the request's cookies", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const { updateSession } = await import("@/lib/supabase/update-session");
    const response = await updateSession(makeRequest());

    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(captured?.cookies.getAll()).toEqual([
      { name: "sb-local-auth-token", value: "old" },
      { name: "other", value: "1" },
    ]);
  });

  it("writes refreshed cookies and cache headers to the response and request", async () => {
    const request = makeRequest();
    getClaims.mockImplementation(async () => {
      captured?.cookies.setAll(
        [
          {
            name: "sb-local-auth-token",
            value: "fresh",
            options: { path: "/", maxAge: 400 },
          },
        ],
        { "Cache-Control": "private, no-store", Pragma: "no-cache" },
      );
      return { data: null, error: null };
    });
    const { updateSession } = await import("@/lib/supabase/update-session");
    const response = await updateSession(request);

    expect(response.cookies.get("sb-local-auth-token")?.value).toBe("fresh");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-middleware-next")).toBe("1");
    // Server Components later in this request must see the new token too.
    expect(request.cookies.get("sb-local-auth-token")?.value).toBe("fresh");
  });

  it("logs a failed session check without tokens and still continues", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getClaims.mockResolvedValue({
      data: null,
      error: { name: "AuthApiError", message: "invalid JWT" },
    });
    const { updateSession } = await import("@/lib/supabase/update-session");
    const response = await updateSession(makeRequest());

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain("AuthApiError");
    expect(logged).not.toContain("old");
  });

  it("fails loudly when the Supabase environment is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { updateSession } = await import("@/lib/supabase/update-session");
    await expect(updateSession(makeRequest())).rejects.toThrow(
      "NEXT_PUBLIC_SUPABASE_URL",
    );
    expect(getClaims).not.toHaveBeenCalled();
  });
});
