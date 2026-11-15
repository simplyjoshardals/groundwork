// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EvalStrip } from "@/components/landing/eval-strip";

afterEach(cleanup);

describe("EvalStrip", () => {
  it("renders nothing until there are real numbers", () => {
    const empty = render(<EvalStrip metrics={null} />);
    expect(empty.container.innerHTML).toBe("");
    const none = render(<EvalStrip metrics={[]} />);
    expect(none.container.innerHTML).toBe("");
  });

  it("lists each metric with its label", () => {
    render(
      <EvalStrip metrics={[{ label: "Questions measured", value: "40" }]} />,
    );
    expect(
      screen.getByRole("heading", { name: "Measured, not claimed." }),
    ).toBeTruthy();
    expect(screen.getByText("Questions measured")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
  });
});
