import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  supabaseOrigin,
  TURNSTILE_ORIGIN,
} from "@/lib/security/headers";
import { parseCsp } from "@/scripts/security-audit/checks";

const LOCAL = "http://127.0.0.1:55321";
const prod = { supabaseUrl: "https://abc.supabase.co/", isDev: false };

describe("supabaseOrigin", () => {
  it("reduces a URL to its origin", () => {
    expect(supabaseOrigin("https://abc.supabase.co/rest/v1/")).toBe(
      "https://abc.supabase.co",
    );
    expect(supabaseOrigin(` ${LOCAL} `)).toBe(LOCAL);
  });

  it("returns null when nothing is configured (a build without env)", () => {
    expect(supabaseOrigin(undefined)).toBeNull();
    expect(supabaseOrigin("  ")).toBeNull();
  });

  it("throws on a bad value without echoing it", () => {
    for (const bad of ["not a url", "ftp://example.com"]) {
      const attempt = () => supabaseOrigin(bad);
      expect(attempt).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
      expect(attempt).not.toThrow(bad);
    }
  });
});

describe("buildContentSecurityPolicy", () => {
  it("allows the Supabase origin and Turnstile where the app needs them", () => {
    const csp = parseCsp(buildContentSecurityPolicy(prod));
    expect(csp.get("connect-src")).toEqual([
      "'self'",
      "https://abc.supabase.co",
    ]);
    expect(csp.get("script-src")).toContain(TURNSTILE_ORIGIN);
    expect(csp.get("frame-src")).toEqual([TURNSTILE_ORIGIN]);
    expect(csp.get("worker-src")).toEqual(["'self'", "blob:"]);
  });

  it("locks down framing, plugins, base and forms", () => {
    const csp = parseCsp(buildContentSecurityPolicy(prod));
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("never uses a wildcard or a bare scheme as a source", () => {
    const text = buildContentSecurityPolicy(prod);
    expect(text).not.toMatch(/(^|\s)(\*|https:|http:)(\s|;|$)/);
  });

  it("allows eval and websockets only in dev", () => {
    const dev = parseCsp(buildContentSecurityPolicy({ ...prod, isDev: true }));
    const production = parseCsp(buildContentSecurityPolicy(prod));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("ws:");
    expect(production.get("script-src")).not.toContain("'unsafe-eval'");
    expect(production.get("connect-src")).not.toContain("ws:");
  });

  it("omits the Supabase origin when none is configured", () => {
    const csp = parseCsp(
      buildContentSecurityPolicy({ supabaseUrl: undefined, isDev: false }),
    );
    expect(csp.get("connect-src")).toEqual(["'self'"]);
  });
});

describe("buildSecurityHeaders", () => {
  const names = (headers: { key: string }[]) => headers.map((h) => h.key);

  it("sends the basic headers in every mode", () => {
    for (const isDev of [true, false]) {
      expect(names(buildSecurityHeaders({ ...prod, isDev }))).toEqual(
        expect.arrayContaining([
          "Content-Security-Policy",
          "X-Content-Type-Options",
          "X-Frame-Options",
          "Referrer-Policy",
          "Permissions-Policy",
        ]),
      );
    }
  });

  it("adds HSTS in production only, without includeSubDomains or preload", () => {
    expect(names(buildSecurityHeaders({ ...prod, isDev: true }))).not.toContain(
      "Strict-Transport-Security",
    );
    const hsts = buildSecurityHeaders(prod).find(
      (h) => h.key === "Strict-Transport-Security",
    );
    expect(hsts?.value).toBe("max-age=31536000");
  });
});
