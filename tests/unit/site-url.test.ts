import { describe, expect, it } from "vitest";
import { siteUrl } from "@/lib/brand/site-url";

describe("siteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL", () => {
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: "https://groundwork.example",
        VERCEL_PROJECT_PRODUCTION_URL: "ignored.vercel.app",
      }).origin,
    ).toBe("https://groundwork.example");
  });

  it("falls back to the Vercel production host, which has no scheme", () => {
    expect(
      siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "groundwork.vercel.app" })
        .origin,
    ).toBe("https://groundwork.vercel.app");
  });

  it("falls back to localhost, and treats blank values as unset", () => {
    expect(siteUrl({}).origin).toBe("http://localhost:3000");
    expect(
      siteUrl({ NEXT_PUBLIC_SITE_URL: "  ", VERCEL_PROJECT_PRODUCTION_URL: "" })
        .origin,
    ).toBe("http://localhost:3000");
  });

  it("throws on a value that is not a URL, so a typo fails the build", () => {
    expect(() => siteUrl({ NEXT_PUBLIC_SITE_URL: "groundwork" })).toThrow();
  });
});
