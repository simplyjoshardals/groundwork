import { describe, expect, it } from "vitest";
import { isAuthUnavailable } from "@/lib/auth/auth-unavailable";

class FakeAuthError extends Error {
  constructor(
    name: string,
    readonly status?: number,
  ) {
    super("x");
    this.name = name;
  }
}

describe("isAuthUnavailable", () => {
  it.each([
    ["a retryable fetch error", new FakeAuthError("AuthRetryableFetchError", 0)],
    ["a 503 from the auth server", new FakeAuthError("AuthApiError", 503)],
    ["a 540 gateway status", new FakeAuthError("AuthUnknownError", 540)],
    ["a failed fetch with status 0", new FakeAuthError("AuthUnknownError", 0)],
  ])("is true for %s", (_label, error) => {
    expect(isAuthUnavailable(error)).toBe(true);
  });

  it.each([
    ["an invalid JWT", new FakeAuthError("AuthInvalidJwtError", 401)],
    ["a session-missing error", new FakeAuthError("AuthSessionMissingError")],
    ["a 403", new FakeAuthError("AuthApiError", 403)],
    ["a plain Error", new Error("boom")],
    ["a string", "boom"],
    ["null", null],
  ])("is false for %s", (_label, error) => {
    expect(isAuthUnavailable(error)).toBe(false);
  });
});
