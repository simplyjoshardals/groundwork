// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QuestionCounter } from "@/components/question-counter";
import { UsageProvider, useUsage } from "@/components/usage-context";
import type { StreamUsage } from "@/types/ask-stream";

afterEach(cleanup);

const RESET = "2026-11-16T00:00:00.000Z";
const usage = (remaining: number): StreamUsage => ({
  remaining,
  dailyLimit: 20,
  resetsAt: RESET,
});

describe("QuestionCounter", () => {
  it("shows the server's number before any answer, with the reset time for screen readers", () => {
    render(
      <UsageProvider initial={usage(14)}>
        <QuestionCounter />
      </UsageProvider>,
    );
    expect(screen.getByText("14 of 20 left")).toBeTruthy();
    expect(screen.getByText(/14 of 20 questions left today\. Resets at/)).toBeTruthy();
  });

  it("is a polite live region", () => {
    const { container } = render(
      <UsageProvider initial={usage(14)}>
        <QuestionCounter />
      </UsageProvider>,
    );
    expect(container.querySelector("[aria-live='polite']")).not.toBeNull();
  });

  it("says so when the count is unavailable, instead of guessing", () => {
    render(
      <UsageProvider initial={null}>
        <QuestionCounter />
      </UsageProvider>,
    );
    expect(screen.getByText("Question count unavailable.")).toBeTruthy();
  });

  it("shows the zero state", () => {
    render(
      <UsageProvider initial={usage(0)}>
        <QuestionCounter />
      </UsageProvider>,
    );
    expect(screen.getByText("0 left today")).toBeTruthy();
    expect(screen.getByText(/No questions left today\. Resets at/)).toBeTruthy();
  });

  it("updates when an answer publishes fresher usage", () => {
    let publish: (u: StreamUsage) => void = () => undefined;
    function Capture() {
      publish = useUsage().publish;
      return null;
    }
    render(
      <UsageProvider initial={usage(14)}>
        <Capture />
        <QuestionCounter />
      </UsageProvider>,
    );
    act(() => publish(usage(13)));
    expect(screen.getByText("13 of 20 left")).toBeTruthy();
  });
});
