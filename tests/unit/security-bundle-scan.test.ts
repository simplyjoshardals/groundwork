import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  scanDirectory,
  scanText,
  secretsFromEnv,
} from "@/scripts/security-audit/bundle-scan";

function jwt(payload: Record<string, unknown>): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}.${"s".repeat(20)}`;
}

describe("scanText", () => {
  it("is clean for public values", () => {
    const text = `const k="sb_publishable_abcdefgh12345";const u="http://127.0.0.1:55321";const t="1x00000000000000000000AA";`;
    expect(scanText(text, [])).toEqual([]);
    // An anon JWT is public by design; only the service role is a finding.
    expect(scanText(`x="${jwt({ role: "anon" })}"`, [])).toEqual([]);
  });

  it("finds key patterns and service-role JWTs", () => {
    expect(scanText("a=sb_secret_abcdefgh12345", [])).toContain(
      "Supabase secret key (sb_secret_)",
    );
    expect(scanText("a=AIzaSyA1234567890abcdefghijklmnopqrstuv", [])).toContain(
      "Google API key (AIza...)",
    );
    expect(scanText("a=gsk_abcdefghijklmnopqrstuvwx", [])).toContain(
      "Groq API key (gsk_...)",
    );
    expect(scanText(`x="${jwt({ role: "service_role" })}"`, [])).toContain(
      "service-role JWT",
    );
  });

  it("finds server variable names and exact values, naming only the variable", () => {
    expect(scanText("process.env.SUPABASE_SECRET_KEY", [])).toContain(
      "server variable name SUPABASE_SECRET_KEY",
    );
    const reasons = scanText("x=abcdefghijklmnop1234", [
      { name: "MY_KEY", value: "abcdefghijklmnop1234" },
    ]);
    expect(reasons).toEqual(["exact value of MY_KEY"]);
    expect(reasons.join()).not.toContain("abcdefghijklmnop1234");
  });

  it("ignores short values, which would match by accident", () => {
    expect(scanText("x=short", [{ name: "K", value: "short" }])).toEqual([]);
  });
});

describe("secretsFromEnv", () => {
  it("takes credential-looking, non-public variables", () => {
    const found = secretsFromEnv({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key-value-1234",
      SUPABASE_SECRET_KEY: "secret-value-1234567",
      GEMINI_API_KEY: "gemini-value-1234567",
      GEMINI_LLM_MODEL: "gemini-model",
      EMPTY_KEY: "",
    });
    expect(found.map((s) => s.name).sort()).toEqual([
      "GEMINI_API_KEY",
      "SUPABASE_SECRET_KEY",
    ]);
  });
});

describe("scanDirectory", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "bundle-scan-"));
    mkdirSync(path.join(dir, "chunks"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reports clean bundles and counts the files", () => {
    writeFileSync(path.join(dir, "chunks", "a.js"), "console.log('hello')");
    writeFileSync(path.join(dir, "b.css"), "body{}");
    writeFileSync(path.join(dir, "font.woff2"), "binary");
    expect(scanDirectory(dir, [])).toEqual({ filesScanned: 2, findings: [] });
  });

  it("reports file and reason for a leak, and a source map", () => {
    writeFileSync(
      path.join(dir, "chunks", "bad.js"),
      "k='sb_secret_abcdefgh12345'",
    );
    writeFileSync(path.join(dir, "chunks", "bad.js.map"), "{}");
    const { findings } = scanDirectory(dir, []);
    expect(findings).toEqual(
      expect.arrayContaining([
        {
          file: path.join("chunks", "bad.js"),
          reason: "Supabase secret key (sb_secret_)",
        },
        {
          file: path.join("chunks", "bad.js.map"),
          reason: "source map is published",
        },
      ]),
    );
  });
});
