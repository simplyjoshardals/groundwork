// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptchaState } from "@/lib/turnstile/state";

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  dispatch: vi.fn(),
  signInAnonymously: vi.fn(),
  captcha: { status: "pending", attempt: 0 } as CaptchaState,
  online: true,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, refresh: h.refresh }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    auth: { signInAnonymously: h.signInAnonymously },
  }),
}));
vi.mock("@/components/captcha-provider", () => ({
  useCaptcha: () => ({ state: h.captcha, dispatch: h.dispatch }),
}));
vi.mock("@/lib/net/use-online-status", () => ({
  useOnlineStatus: () => h.online,
}));

import {
  DemoErrorNotice,
  DemoStartButton,
  DemoStartProvider,
} from "@/components/demo-start";
import { AUTH_UNAVAILABLE_MESSAGE } from "@/lib/auth/auth-unavailable";
import { CAPTCHA_REJECTED_MESSAGE } from "@/lib/turnstile/state";

const verified: CaptchaState = { status: "verified", token: "tok", attempt: 0 };

function renderHero(placement: "hero" | "header" = "hero") {
  render(
    <DemoStartProvider next="/?doc=abc">
      <DemoStartButton placement={placement} />
      <DemoErrorNotice />
    </DemoStartProvider>,
  );
}

beforeEach(() => {
  h.captcha = { status: "pending", attempt: 0 };
  h.online = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  h.replace.mockReset();
  h.refresh.mockReset();
  h.dispatch.mockReset();
  h.signInAnonymously.mockReset();
});

describe("Try demo", () => {
  it("is disabled and says it is preparing while the check runs", () => {
    renderHero();
    const button = screen.getByRole("button", { name: "Preparing demo…" });
    expect(button).toHaveProperty("disabled", true);
  });

  it("keeps the header label fixed while the check runs", () => {
    renderHero("header");
    const button = screen.getByRole("button", { name: "Try demo" });
    expect(button).toHaveProperty("disabled", true);
  });

  it("starts a session with the token and goes to next", async () => {
    h.captcha = verified;
    h.signInAnonymously.mockResolvedValue({ error: null });
    renderHero();
    fireEvent.click(screen.getByRole("button", { name: "Try demo" }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/?doc=abc"));
    expect(h.signInAnonymously).toHaveBeenCalledWith({
      options: { captchaToken: "tok" },
    });
    expect(h.refresh).toHaveBeenCalled();
  });

  it("shows the captcha message and asks for a new token when it is rejected", async () => {
    h.captcha = verified;
    h.signInAnonymously.mockResolvedValue({
      error: { code: "captcha_failed" },
    });
    renderHero();
    fireEvent.click(screen.getByRole("button", { name: "Try demo" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(CAPTCHA_REJECTED_MESSAGE);
    expect(h.dispatch).toHaveBeenCalledWith({ type: "reset" });
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("says the demo is waking up when the auth service is unreachable", async () => {
    h.captcha = verified;
    h.signInAnonymously.mockResolvedValue({
      error: { name: "AuthRetryableFetchError", status: 0 },
    });
    renderHero();
    fireEvent.click(screen.getByRole("button", { name: "Try demo" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(AUTH_UNAVAILABLE_MESSAGE);
  });

  it("shows a generic message for any other failure, including a thrown one", async () => {
    h.captcha = verified;
    h.signInAnonymously.mockRejectedValue(new Error("network down"));
    renderHero();
    fireEvent.click(screen.getByRole("button", { name: "Try demo" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not start the demo.");
    expect(h.dispatch).toHaveBeenCalledWith({ type: "reset" });
  });

  it("is disabled offline", () => {
    h.captcha = verified;
    h.online = false;
    renderHero();
    expect(screen.getByRole("button", { name: "Try demo" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
