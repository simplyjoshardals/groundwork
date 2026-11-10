/**
 * Pure state for the CAPTCHA field (no React, no DOM), so it can be unit
 * tested. A form may only call Supabase while the state is `verified`; the
 * token is single-use, so every failed attempt must `reset`.
 */

export type CaptchaFailure = "unconfigured" | "script" | "widget";

/** `attempt` changes on every reset; it is the React `key` that remounts the widget. */
export type CaptchaState =
  | { status: "pending"; attempt: number }
  | { status: "verified"; token: string; attempt: number }
  | { status: "failed"; reason: CaptchaFailure; attempt: number };

export type CaptchaEvent =
  | { type: "token"; token: string }
  | { type: "expired" }
  | { type: "error"; reason: CaptchaFailure }
  | { type: "reset" };

export const INITIAL_CAPTCHA_STATE: CaptchaState = {
  status: "pending",
  attempt: 0,
};

export function captchaReducer(
  state: CaptchaState,
  event: CaptchaEvent,
): CaptchaState {
  const { attempt } = state;
  switch (event.type) {
    case "token": {
      const token = event.token.trim();
      // An empty token would reach Supabase as "no token"; treat it as a failure.
      return token
        ? { status: "verified", token, attempt }
        : { status: "failed", reason: "widget", attempt };
    }
    case "expired":
      // The widget refreshes an expired token by itself and calls back again.
      return state.status === "verified"
        ? { status: "pending", attempt }
        : state;
    case "error":
      return { status: "failed", reason: event.reason, attempt };
    case "reset":
      return { status: "pending", attempt: attempt + 1 };
  }
}

export const CAPTCHA_PENDING_MESSAGE = "Verifying that you're human…";
export const CAPTCHA_WAIT_MESSAGE =
  "Please wait for the verification check to finish.";
export const CAPTCHA_REJECTED_MESSAGE =
  "The verification check failed. Please try again.";

const FAILURE_MESSAGES: Record<CaptchaFailure, string> = {
  unconfigured:
    "The verification check is not configured for this deployment, so signing in is unavailable.",
  script:
    "Could not load the verification check. Check your connection and try again.",
  widget: "The verification check failed. Please try again.",
};

/** Text for the status line, or null when there is nothing to say. */
export function captchaStatusMessage(state: CaptchaState): string | null {
  switch (state.status) {
    case "pending":
      return CAPTCHA_PENDING_MESSAGE;
    case "verified":
      return null;
    case "failed":
      return FAILURE_MESSAGES[state.reason];
  }
}

/** A missing site key is a deployment problem; retrying cannot fix it. */
export function captchaCanRetry(state: CaptchaState): boolean {
  return state.status === "failed" && state.reason !== "unconfigured";
}

/**
 * Supabase Auth reports a missing, invalid, expired or reused token with the
 * error code `captcha_failed`. Matched by code, never by message text.
 */
export function isCaptchaRejection(
  error: { code?: string } | null | undefined,
): boolean {
  return error?.code === "captcha_failed";
}
