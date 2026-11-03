import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createClient = vi.fn(() => ({ marker: "admin-client" }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
const SECRET_VAR = "SUPABASE_SECRET_KEY";

beforeEach(() => {
  createClient.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("supabase env", () => {
  it("returns trimmed values", async () => {
    vi.stubEnv(URL_VAR, "  http://127.0.0.1:55321  ");
    vi.stubEnv(KEY_VAR, " sb_publishable_x ");
    const { supabaseUrl, supabasePublishableKey } =
      await import("@/lib/supabase/env");
    expect(supabaseUrl()).toBe("http://127.0.0.1:55321");
    expect(supabasePublishableKey()).toBe("sb_publishable_x");
  });

  it("names the missing variable and treats blank as missing", async () => {
    vi.stubEnv(URL_VAR, "   ");
    vi.stubEnv(KEY_VAR, "");
    const { supabaseUrl, supabasePublishableKey, MissingSupabaseEnvError } =
      await import("@/lib/supabase/env");
    expect(() => supabaseUrl()).toThrow(MissingSupabaseEnvError);
    expect(() => supabaseUrl()).toThrow(URL_VAR);
    expect(() => supabasePublishableKey()).toThrow(KEY_VAR);
  });
});

describe("createAdminSupabase", () => {
  it("throws naming the variable when the secret key is missing", async () => {
    vi.stubEnv(URL_VAR, "http://127.0.0.1:55321");
    vi.stubEnv(SECRET_VAR, "");
    const { createAdminSupabase } = await import("@/lib/supabase/admin");
    expect(() => createAdminSupabase()).toThrow(SECRET_VAR);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("creates a sessionless client with the secret key", async () => {
    vi.stubEnv(URL_VAR, "http://127.0.0.1:55321");
    vi.stubEnv(SECRET_VAR, " sb_secret_x ");
    const { createAdminSupabase } = await import("@/lib/supabase/admin");
    createAdminSupabase();
    expect(createClient).toHaveBeenCalledWith(
      "http://127.0.0.1:55321",
      "sb_secret_x",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  });

  it("does not put the secret key in the error for a missing URL", async () => {
    vi.stubEnv(URL_VAR, "");
    vi.stubEnv(SECRET_VAR, "sb_secret_do_not_leak");
    const { createAdminSupabase } = await import("@/lib/supabase/admin");
    expect(() => createAdminSupabase()).toThrow(URL_VAR);
    try {
      createAdminSupabase();
    } catch (error) {
      expect(String(error)).not.toContain("sb_secret_do_not_leak");
    }
  });
});
