import { describe, expect, it } from "vitest";
import {
  describeAuthError,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  parseCredentials,
} from "@/lib/auth/credentials";

describe("parseCredentials", () => {
  it("accepts valid sign-up input and trims the email", () => {
    const result = parseCredentials(
      { email: "  a@example.com ", password: "x".repeat(MIN_PASSWORD_LENGTH) },
      "sign-up",
    );
    expect(result).toEqual({
      ok: true,
      value: {
        email: "a@example.com",
        password: "x".repeat(MIN_PASSWORD_LENGTH),
      },
    });
  });

  it("rejects a short password on sign-up but not on sign-in", () => {
    const short = { email: "a@example.com", password: "abc" };
    const up = parseCredentials(short, "sign-up");
    expect(up.ok).toBe(false);
    if (!up.ok) expect(up.fieldErrors.password).toContain("at least");
    expect(parseCredentials(short, "sign-in").ok).toBe(true);
  });

  it("rejects an over-long password and a bad email", () => {
    const result = parseCredentials(
      { email: "not-an-email", password: "x".repeat(MAX_PASSWORD_LENGTH + 1) },
      "sign-up",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.email).toBeDefined();
      expect(result.fieldErrors.password).toBeDefined();
    }
  });

  it("rejects an empty sign-in password and non-string input", () => {
    expect(
      parseCredentials({ email: "a@example.com", password: "" }, "sign-in").ok,
    ).toBe(false);
    expect(parseCredentials({ email: null, password: 5 }, "sign-in").ok).toBe(
      false,
    );
  });

  it("does not trim or alter the password", () => {
    const result = parseCredentials(
      { email: "a@example.com", password: "  spaced pass  " },
      "sign-in",
    );
    expect(result.ok && result.value.password).toBe("  spaced pass  ");
  });
});

describe("describeAuthError", () => {
  it("maps known codes to fixed text", () => {
    expect(describeAuthError({ code: "invalid_credentials" })).toBe(
      "Incorrect email or password.",
    );
    expect(describeAuthError({ code: "user_already_exists" })).toContain(
      "already exists",
    );
    expect(describeAuthError({ code: "over_email_send_rate_limit" })).toContain(
      "emails",
    );
  });

  it("treats a 429 without a known code as rate limiting", () => {
    expect(describeAuthError({ status: 429 })).toContain("Too many attempts");
  });

  it("recognizes a network failure", () => {
    expect(describeAuthError({ name: "AuthRetryableFetchError" })).toContain(
      "Could not reach",
    );
  });

  it("falls back to a generic message and never echoes provider text", () => {
    const text = describeAuthError({
      code: "something_new",
      name: "AuthApiError",
      status: 500,
    });
    expect(text).toBe("Something went wrong. Please try again.");
    expect(describeAuthError(null)).toBe(text);
  });
});
