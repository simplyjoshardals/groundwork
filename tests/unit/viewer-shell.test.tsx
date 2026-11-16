// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ViewerShell } from "@/components/viewer-shell";

beforeAll(() => {
  // jsdom has no modal dialog behaviour; this is just enough to drive the
  // shell. The real focus trap, inert background and scroll lock are checked
  // in the Playwright flow.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Content() {
  return (
    <>
      <h2 tabIndex={-1} data-viewer-title>
        Handbook
      </h2>
      <button type="button">Inside</button>
    </>
  );
}

function renderShell(
  props: { open?: boolean; docked?: boolean } = {},
  handlers = { onClose: vi.fn(), onExited: vi.fn() },
) {
  const view = (next: { open?: boolean; docked?: boolean }) => (
    <ViewerShell
      open={next.open ?? true}
      docked={next.docked ?? false}
      focusKey="doc-a"
      {...handlers}
    >
      <Content />
    </ViewerShell>
  );
  const rendered = render(view(props));
  return {
    ...handlers,
    rerender: (next: { open?: boolean; docked?: boolean }) =>
      rendered.rerender(view(next)),
  };
}

describe("sheet (below xl)", () => {
  it("opens as a modal dialog and focuses the title", () => {
    renderShell();
    const dialog = screen.getByRole("dialog", { name: "Document viewer" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Handbook" }),
    );
  });

  it("routes Escape through onClose and keeps the dialog open itself", () => {
    const { onClose } = renderShell();
    const dialog = screen.getByRole("dialog", { name: "Document viewer" });
    const notCancelled = fireEvent(
      dialog,
      new Event("cancel", { cancelable: true }),
    );
    expect(notCancelled).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a press that starts and ends on the backdrop", () => {
    const { onClose } = renderShell();
    const dialog = screen.getByRole("dialog", { name: "Document viewer" });
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks inside the sheet and drags that end on the backdrop", () => {
    const { onClose } = renderShell();
    const dialog = screen.getByRole("dialog", { name: "Document viewer" });
    const inside = screen.getByRole("button", { name: "Inside" });
    fireEvent.pointerDown(inside);
    fireEvent.click(inside);
    fireEvent.pointerDown(inside);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("treats a close by the browser as a close request", () => {
    const { onClose } = renderShell();
    fireEvent(
      screen.getByRole("dialog", { name: "Document viewer" }),
      new Event("close"),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the dialog and reports the exit when the transition ends", () => {
    const { rerender, onExited, onClose } = renderShell();
    const dialog = screen.getByRole("dialog", { name: "Document viewer" });
    rerender({ open: false });
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(onExited).not.toHaveBeenCalled();
    // Closing because the URL changed is not a request to close.
    expect(onClose).not.toHaveBeenCalled();
    const ended = Object.assign(new Event("transitionend"), {
      propertyName: "opacity",
    });
    fireEvent(dialog, ended);
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it("reports the exit after a timer when no transition runs", () => {
    vi.useFakeTimers();
    const { rerender, onExited } = renderShell();
    rerender({ open: false });
    act(() => {
      vi.advanceTimersByTime(449);
    });
    expect(onExited).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it("cancels the exit when it is opened again", () => {
    vi.useFakeTimers();
    const { rerender, onExited } = renderShell();
    rerender({ open: false });
    rerender({ open: true });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onExited).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("dialog", { name: "Document viewer" })
        .hasAttribute("open"),
    ).toBe(true);
  });
});

describe("docked panel (xl and up)", () => {
  it("is a non-modal complementary region with focus on the title", () => {
    renderShell({ docked: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("complementary", { name: "Document viewer" }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Handbook" }),
    );
  });

  it("closes on Escape from anywhere inside it", () => {
    const { onClose } = renderShell({ docked: true });
    fireEvent.keyDown(screen.getByRole("button", { name: "Inside" }), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves at once, with no exit animation", () => {
    const { rerender, onExited } = renderShell({ docked: true });
    rerender({ docked: true, open: false });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(onExited).toHaveBeenCalled();
  });
});
