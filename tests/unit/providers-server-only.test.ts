import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard only. It proves every runtime module in lib/providers asks
 * for the `server-only` boundary; it does not prove the build rejects a client
 * import. That is checked separately with a deliberate failing `next build`.
 */
const DIR = join(process.cwd(), "lib", "providers");
// Pure type/error modules carry no secrets and no runtime behaviour.
const EXEMPT = new Set(["types.ts", "errors.ts"]);

describe("lib/providers server-only boundary", () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith(".ts"));

  it("finds the provider modules", () => {
    expect(files).toContain("index.ts");
    expect(files).toContain("env.ts");
  });

  for (const file of files.filter((name) => !EXEMPT.has(name))) {
    it(`${file} imports server-only`, () => {
      const source = readFileSync(join(DIR, file), "utf8");
      expect(source).toMatch(/^import "server-only";/m);
    });
  }

  it("only the exempt modules lack the import, and they stay free of runtime code", () => {
    for (const file of EXEMPT) {
      const source = readFileSync(join(DIR, file), "utf8");
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/\bfetch\(/);
    }
  });

  it("no module outside the folder's own env.ts reads process.env", () => {
    for (const file of files.filter((name) => name !== "env.ts")) {
      expect(readFileSync(join(DIR, file), "utf8")).not.toMatch(/process\.env/);
    }
  });
});
