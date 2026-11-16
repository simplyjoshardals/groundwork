// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useRestoreFocus } from "@/lib/viewer/use-restore-focus";

afterEach(cleanup);

function Harness({ showOriginal = true }: { showOriginal?: boolean }) {
  const [open, setOpen] = useState(false);
  const remember = useRestoreFocus(open);
  return (
    <div>
      {showOriginal ? (
        <button
          type="button"
          data-citation-chunk="101"
          onClick={(event) => {
            remember(event.currentTarget, "101");
            setOpen(true);
          }}
        >
          Marker
        </button>
      ) : (
        <button type="button" data-citation-chunk="101">
          Card for the same chunk
        </button>
      )}
      <button type="button" onClick={() => setOpen(false)}>
        Close viewer
      </button>
    </div>
  );
}

describe("useRestoreFocus", () => {
  it("returns focus to the control that opened the viewer", () => {
    render(<Harness />);
    const marker = screen.getByRole("button", { name: "Marker" });
    fireEvent.click(marker);
    const close = screen.getByRole("button", { name: "Close viewer" });
    close.focus();
    fireEvent.click(close);
    expect(document.activeElement).toBe(marker);
  });

  it("falls back to the control for the same chunk when the opener is gone", () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Marker" }));
    view.rerender(<Harness showOriginal={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Card for the same chunk" }),
    );
  });
});
