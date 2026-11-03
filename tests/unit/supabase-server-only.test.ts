import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard only. It proves the service-role and cookie-reading modules
 * ask for the `server-only` boundary and that secrets stay in admin.ts; it
 * does not prove the build rejects a client import. That is checked
 * separately with a deliberate failing `next build`.
 */
const DIR = join(process.cwd(), "lib", "supabase");
const read = (file: string) => readFileSync(join(DIR, file), "utf8");

describe("lib/supabase server-only boundary", () => {
  it("admin.ts and server.ts import server-only", () => {
    expect(read("admin.ts")).toMatch(/^import "server-only";/m);
    expect(read("server.ts")).toMatch(/^import "server-only";/m);
  });

  it("browser.ts and env.ts stay importable from client code", () => {
    expect(read("browser.ts")).not.toMatch(/import "server-only"/);
    expect(read("env.ts")).not.toMatch(/import "server-only"/);
  });

  it("the secret key is named only in admin.ts", () => {
    const files = readdirSync(DIR).filter((name) => name.endsWith(".ts"));
    expect(files).toContain("admin.ts");
    for (const file of files) {
      const mentionsSecret = /SUPABASE_SECRET_KEY/.test(read(file));
      if (file === "admin.ts") expect(mentionsSecret).toBe(true);
      else expect(mentionsSecret).toBe(false);
    }
  });

  it("there is no barrel file that could drag admin into client code", () => {
    expect(readdirSync(DIR)).not.toContain("index.ts");
  });
});
