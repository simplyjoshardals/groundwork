import { describe, expect, it } from "vitest";
import { demoCta, type DemoPlacement } from "@/lib/demo/cta-state";
import type { CaptchaState } from "@/lib/turnstile/state";

const pending: CaptchaState = { status: "pending", attempt: 0 };
const verified: CaptchaState = { status: "verified", token: "t", attempt: 0 };
const failed: CaptchaState = { status: "failed", reason: "widget", attempt: 0 };

function cta(
  captcha: CaptchaState,
  opts: {
    online?: boolean;
    starting?: boolean;
    placement?: DemoPlacement;
  } = {},
) {
  return demoCta({
    captcha,
    online: opts.online ?? true,
    starting: opts.starting ?? false,
    placement: opts.placement ?? "hero",
  });
}

describe("demoCta", () => {
  it("is enabled only once the check has produced a token", () => {
    expect(cta(verified)).toEqual({ label: "Try demo", disabled: false });
    expect(cta(pending).disabled).toBe(true);
    expect(cta(failed).disabled).toBe(true);
  });

  it("says it is preparing while the check runs", () => {
    expect(cta(pending).label).toBe("Preparing demo…");
    expect(cta(failed).label).toBe("Try demo");
  });

  it("says it is starting while the request runs, and stays disabled", () => {
    expect(cta(verified, { starting: true })).toEqual({
      label: "Starting demo…",
      disabled: true,
    });
  });

  it("is disabled offline without changing the label", () => {
    expect(cta(verified, { online: false })).toEqual({
      label: "Try demo",
      disabled: true,
    });
    expect(cta(pending, { online: false }).label).toBe("Try demo");
  });

  it("keeps the header label fixed in every state", () => {
    for (const captcha of [pending, verified, failed]) {
      expect(cta(captcha, { placement: "header" }).label).toBe("Try demo");
    }
    expect(cta(verified, { placement: "header", starting: true })).toEqual({
      label: "Try demo",
      disabled: true,
    });
  });
});
