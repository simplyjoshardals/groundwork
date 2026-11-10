import { describe, expect, it } from "vitest";
import {
  CAPTCHA_PENDING_MESSAGE,
  captchaCanRetry,
  captchaReducer,
  captchaStatusMessage,
  INITIAL_CAPTCHA_STATE,
  isCaptchaRejection,
  type CaptchaState,
} from "@/lib/turnstile/state";
import {
  isAlwaysPassTestSiteKey,
  TURNSTILE_DUMMY_TOKEN,
  TURNSTILE_TEST_SITE_KEY_PASS,
} from "@/lib/turnstile/test-keys";

const verified: CaptchaState = { status: "verified", token: "tok", attempt: 2 };

describe("captchaReducer", () => {
  it("starts pending with no token", () => {
    expect(INITIAL_CAPTCHA_STATE).toEqual({ status: "pending", attempt: 0 });
  });

  it("verifies on a token and keeps the attempt", () => {
    const next = captchaReducer(
      { status: "pending", attempt: 3 },
      { type: "token", token: "abc" },
    );
    expect(next).toEqual({ status: "verified", token: "abc", attempt: 3 });
  });

  it("trims the token and treats an empty one as a failure", () => {
    expect(
      captchaReducer(INITIAL_CAPTCHA_STATE, { type: "token", token: "  abc " }),
    ).toMatchObject({ status: "verified", token: "abc" });
    for (const token of ["", "   "]) {
      expect(
        captchaReducer(INITIAL_CAPTCHA_STATE, { type: "token", token }),
      ).toEqual({ status: "failed", reason: "widget", attempt: 0 });
    }
  });

  it("drops a verified token when it expires, and ignores expiry otherwise", () => {
    expect(captchaReducer(verified, { type: "expired" })).toEqual({
      status: "pending",
      attempt: 2,
    });
    const failed: CaptchaState = {
      status: "failed",
      reason: "script",
      attempt: 1,
    };
    expect(captchaReducer(failed, { type: "expired" })).toBe(failed);
    expect(captchaReducer(INITIAL_CAPTCHA_STATE, { type: "expired" })).toBe(
      INITIAL_CAPTCHA_STATE,
    );
  });

  it("fails on an error, even after a token", () => {
    expect(
      captchaReducer(verified, { type: "error", reason: "widget" }),
    ).toEqual({ status: "failed", reason: "widget", attempt: 2 });
  });

  it("reset discards the token and bumps the attempt so the widget remounts", () => {
    const next = captchaReducer(verified, { type: "reset" });
    expect(next).toEqual({ status: "pending", attempt: 3 });
    expect("token" in next).toBe(false);
  });
});

describe("captcha messages", () => {
  it("says something for every state except verified", () => {
    expect(captchaStatusMessage(INITIAL_CAPTCHA_STATE)).toBe(
      CAPTCHA_PENDING_MESSAGE,
    );
    expect(captchaStatusMessage(verified)).toBeNull();
    const messages = (["unconfigured", "script", "widget"] as const).map(
      (reason) =>
        captchaStatusMessage({ status: "failed", reason, attempt: 0 }),
    );
    expect(messages.every((m) => typeof m === "string" && m.length > 0)).toBe(
      true,
    );
    expect(new Set(messages).size).toBe(3);
  });

  it("offers a retry for every failure except a missing site key", () => {
    expect(
      captchaCanRetry({ status: "failed", reason: "script", attempt: 0 }),
    ).toBe(true);
    expect(
      captchaCanRetry({ status: "failed", reason: "widget", attempt: 0 }),
    ).toBe(true);
    expect(
      captchaCanRetry({ status: "failed", reason: "unconfigured", attempt: 0 }),
    ).toBe(false);
    expect(captchaCanRetry(INITIAL_CAPTCHA_STATE)).toBe(false);
    expect(captchaCanRetry(verified)).toBe(false);
  });
});

describe("isCaptchaRejection", () => {
  it("matches the Supabase error code only", () => {
    expect(isCaptchaRejection({ code: "captcha_failed" })).toBe(true);
    expect(isCaptchaRejection({ code: "invalid_credentials" })).toBe(false);
    expect(isCaptchaRejection({})).toBe(false);
    expect(isCaptchaRejection(null)).toBe(false);
    expect(isCaptchaRejection(undefined)).toBe(false);
  });
});

describe("Turnstile test keys", () => {
  it("accepts only the always-pass site keys", () => {
    expect(isAlwaysPassTestSiteKey(TURNSTILE_TEST_SITE_KEY_PASS)).toBe(true);
    expect(isAlwaysPassTestSiteKey(` ${TURNSTILE_TEST_SITE_KEY_PASS} `)).toBe(
      true,
    );
    expect(isAlwaysPassTestSiteKey("1x00000000000000000000BB")).toBe(true);
    expect(isAlwaysPassTestSiteKey("2x00000000000000000000AB")).toBe(false);
    expect(isAlwaysPassTestSiteKey("3x00000000000000000000FF")).toBe(false);
    expect(isAlwaysPassTestSiteKey("0x4AAAAAAAreal")).toBe(false);
    expect(isAlwaysPassTestSiteKey("")).toBe(false);
    expect(isAlwaysPassTestSiteKey(undefined)).toBe(false);
  });

  it("keeps the dummy token Cloudflare documents", () => {
    expect(TURNSTILE_DUMMY_TOKEN).toBe("XXXX.DUMMY.TOKEN.XXXX");
  });
});
