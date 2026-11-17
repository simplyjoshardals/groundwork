// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "@/components/ui/toast";

function Trigger({ message }: { message: string }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show(message)}>
      Show {message}
    </button>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("has its live region before anything is shown", () => {
    render(
      <ToastProvider>
        <p>page</p>
      </ToastProvider>,
    );
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("shows a message, then removes it after 4 s", () => {
    render(
      <ToastProvider>
        <Trigger message="Document deleted" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show Document deleted" }));
    expect(screen.getByText("Document deleted")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(3900));
    expect(screen.getByText("Document deleted")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(100)); // 4 s: starts the fade-out
    act(() => void vi.advanceTimersByTime(200)); // fade-out done: removed
    expect(screen.queryByText("Document deleted")).toBeNull();
  });

  it("shows one toast at a time: a new message replaces the old one", () => {
    render(
      <ToastProvider>
        <Trigger message="one" />
        <Trigger message="two" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show one" }));
    fireEvent.click(screen.getByRole("button", { name: "Show two" }));
    expect(screen.queryByText("one")).toBeNull();
    expect(screen.getByText("two")).toBeTruthy();
  });

  it("pauses while the pointer is over it", () => {
    render(
      <ToastProvider>
        <Trigger message="kept" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show kept" }));
    const toast = screen.getByText("kept").parentElement as HTMLElement;
    fireEvent.mouseEnter(toast);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText("kept")).toBeTruthy();
    fireEvent.mouseLeave(toast);
    act(() => void vi.advanceTimersByTime(4000));
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByText("kept")).toBeNull();
  });
});
