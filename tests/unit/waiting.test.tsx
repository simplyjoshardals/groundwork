// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ online: true }));
vi.mock("@/lib/net/use-online-status", () => ({
  useOnlineStatus: () => h.online,
}));

import { ReloadButton } from "@/components/reload-button";
import { WaitingContent } from "@/components/waiting-content";
import { markWaitingRetry, wasRecentlyRetried } from "@/lib/auth/waiting-retry";

beforeEach(() => {
  h.online = true;
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("ReloadButton", () => {
  it("shows Checking…, stays disabled, and remembers the attempt", () => {
    const onReload = vi.fn();
    render(<ReloadButton onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Checking…" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(wasRecentlyRetried(window.sessionStorage)).toBe(true);
  });

  it("is disabled while offline", () => {
    h.online = false;
    render(<ReloadButton onReload={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Try again" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("WaitingContent", () => {
  it("explains the wait and has no retry note on a first visit", () => {
    render(<WaitingContent />);
    expect(screen.getByText(/starting after a quiet spell/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("says it is still not reachable after a recent retry", () => {
    markWaitingRetry(window.sessionStorage);
    render(<WaitingContent />);
    expect(screen.getByRole("status").textContent).toBe(
      "Still not reachable. Try again in a minute.",
    );
  });

  it("replaces the explanation with the offline notice when offline", () => {
    h.online = false;
    render(<WaitingContent />);
    expect(screen.getByText("You’re offline.")).toBeTruthy();
    expect(screen.queryByText(/starting after a quiet spell/)).toBeNull();
  });
});
