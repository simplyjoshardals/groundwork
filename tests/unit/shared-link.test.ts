import { describe, expect, it } from "vitest";
import { authHref, nextFromSearchParams } from "@/lib/auth/shared-link";

describe("nextFromSearchParams", () => {
  it("is the home page when there is no document link", () => {
    expect(nextFromSearchParams({})).toBe("/");
    expect(nextFromSearchParams({ page: "2" })).toBe("/");
  });

  it("keeps doc, page and chunk, in that order", () => {
    expect(
      nextFromSearchParams({ chunk: "7", page: "2", doc: "abc-123" }),
    ).toBe("/?doc=abc-123&page=2&chunk=7");
    expect(nextFromSearchParams({ doc: "abc" })).toBe("/?doc=abc");
  });

  it("drops other parameters and malformed page or chunk values", () => {
    expect(
      nextFromSearchParams({
        doc: "abc",
        page: "two",
        chunk: "a b",
        next: "https://evil.example",
        error: "callback",
      }),
    ).toBe("/?doc=abc");
  });

  it.each(["../x", "a/b", "a b", "", "x".repeat(65), "%2e%2e"])(
    "falls back to / for the document id %j",
    (doc) => {
      expect(nextFromSearchParams({ doc, page: "1" })).toBe("/");
    },
  );

  it("uses the first value of a repeated parameter", () => {
    expect(
      nextFromSearchParams({ doc: ["abc", "def"], page: ["3", "4"] }),
    ).toBe("/?doc=abc&page=3");
  });
});

describe("authHref", () => {
  it("adds no query for the home page", () => {
    expect(authHref("/sign-in", "/")).toBe("/sign-in");
    expect(authHref("/sign-up", "/")).toBe("/sign-up");
  });

  it("carries a shared link as an encoded next", () => {
    expect(authHref("/sign-in", "/?doc=abc")).toBe(
      "/sign-in?next=%2F%3Fdoc%3Dabc",
    );
  });
});
