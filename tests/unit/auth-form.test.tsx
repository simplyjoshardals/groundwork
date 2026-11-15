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
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  captcha: { status: "verified", token: "tok", attempt: 0 } as CaptchaState,
  online: true,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, refresh: h.refresh }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    auth: { signInWithPassword: h.signInWithPassword, signUp: h.signUp },
  }),
}));
vi.mock("@/components/captcha-provider", () => ({
  useCaptcha: () => ({ state: h.captcha, dispatch: h.dispatch }),
}));
vi.mock("@/lib/net/use-online-status", () => ({
  useOnlineStatus: () => h.online,
}));

import { AuthForm } from "@/components/auth-form";

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
}

beforeEach(() => {
  h.captcha = { status: "verified", token: "tok", attempt: 0 };
  h.online = true;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const fn of [
    h.replace,
    h.refresh,
    h.dispatch,
    h.signInWithPassword,
    h.signUp,
  ]) {
    fn.mockReset();
  }
});

describe("AuthForm sign-in", () => {
  it("shows field errors and does not call Supabase for empty input", () => {
    render(<AuthForm mode="sign-in" next="/" title="Sign in" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });

  it("disables the submit button until the check has produced a token", () => {
    h.captcha = { status: "pending", attempt: 0 };
    render(<AuthForm mode="sign-in" next="/" title="Sign in" />);
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("signs in with the token and goes to next", async () => {
    h.signInWithPassword.mockResolvedValue({ error: null });
    render(<AuthForm mode="sign-in" next="/?doc=abc" title="Sign in" />);
    fill("reader@example.com", "secret-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/?doc=abc"));
    expect(h.signInWithPassword).toHaveBeenCalledWith({
      email: "reader@example.com",
      password: "secret-password",
      options: { captchaToken: "tok" },
    });
  });

  it("shows a danger banner and asks for a new token when sign-in fails", async () => {
    h.signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials" },
    });
    render(<AuthForm mode="sign-in" next="/" title="Sign in" />);
    fill("reader@example.com", "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Incorrect email or password.");
    expect(h.dispatch).toHaveBeenCalledWith({ type: "reset" });
  });

  it("shows the expired-link notice as a status banner", () => {
    render(
      <AuthForm
        mode="sign-in"
        next="/"
        title="Sign in"
        notice="That confirmation link is invalid or has expired."
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "invalid or has expired",
    );
  });

  it("is disabled and says so when offline", () => {
    h.online = false;
    render(<AuthForm mode="sign-in" next="/" title="Sign in" />);
    expect(screen.getByText("You’re offline.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("AuthForm sign-up", () => {
  it("replaces the form with Check your email when no session is returned", async () => {
    h.signUp.mockResolvedValue({ data: { session: null }, error: null });
    render(<AuthForm mode="sign-up" next="/" title="Create an account" />);
    fill("reader@example.com", "long-enough-password");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(
      await screen.findByRole("heading", { name: "Check your email" }),
    ).toBeTruthy();
    expect(screen.getByText("reader@example.com")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(h.dispatch).toHaveBeenCalledWith({ type: "reset" });
  });

  it("shows the password hint and rejects a short password", () => {
    render(<AuthForm mode="sign-up" next="/" title="Create an account" />);
    expect(screen.getByText("At least 8 characters.")).toBeTruthy();
    fill("reader@example.com", "short");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy();
    expect(h.signUp).not.toHaveBeenCalled();
  });
});
