import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("keeps same-site relative paths and queries", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/documents")).toBe("/documents");
    expect(safeNextPath("/?doc=abc&page=2")).toBe("/?doc=abc&page=2");
  });

  it.each([
    "https://evil.example",
    "http://evil.example/x",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "evil.example",
    "relative/path",
    "/ok\nHeader: x",
    "/ok\u0000",
    "",
  ])("falls back to / for %j", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it("falls back for non-strings and very long values", () => {
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(["/a"])).toBe("/");
    expect(safeNextPath(`/${"a".repeat(600)}`)).toBe("/");
  });

  it("refuses the auth pages so links cannot loop", () => {
    expect(safeNextPath("/sign-in")).toBe("/");
    expect(safeNextPath("/sign-up?next=/x")).toBe("/");
    expect(safeNextPath("/auth/callback")).toBe("/");
    // A look-alike path is a different page and stays allowed.
    expect(safeNextPath("/sign-inventory")).toBe("/sign-inventory");
  });

  it("normalizes dot segments instead of passing them through", () => {
    expect(safeNextPath("/a/../b")).toBe("/b");
    expect(safeNextPath("/../../sign-in")).toBe("/");
  });
});
