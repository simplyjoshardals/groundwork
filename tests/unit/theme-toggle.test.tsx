// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_STORAGE_KEY } from "@/lib/theme/theme-script";

type Listener = () => void;
let osDark = false;
const listeners = new Set<Listener>();

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  osDark = false;
  listeners.clear();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return osDark;
    },
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThemeToggle", () => {
  it("starts on System and names the next state in its label", () => {
    render(<ThemeToggle />);
    expect(
      screen.getByRole("button", { name: "Theme: System. Switch to Light." }),
    ).toBeTruthy();
  });

  it("cycles System, Light, Dark, System and stores each choice", () => {
    render(<ThemeToggle />);
    const press = (name: string) =>
      fireEvent.click(screen.getByRole("button", { name }));

    press("Theme: System. Switch to Light.");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    press("Theme: Light. Switch to Dark.");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    press("Theme: Dark. Switch to System.");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(
      screen.getByRole("button", { name: "Theme: System. Switch to Light." }),
    ).toBeTruthy();
  });

  it("shows the stored choice after hydration", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);
    expect(
      screen.getByRole("button", { name: "Theme: Dark. Switch to System." }),
    ).toBeTruthy();
  });

  it("follows the OS while on System, and stops following once a choice is made", () => {
    render(<ThemeToggle />);
    osDark = true;
    listeners.forEach((l) => l());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(
      screen.getByRole("button", { name: "Theme: System. Switch to Light." }),
    );
    osDark = true;
    listeners.forEach((l) => l());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("still switches the page when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ThemeToggle />);
    fireEvent.click(
      screen.getByRole("button", { name: "Theme: System. Switch to Light." }),
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
