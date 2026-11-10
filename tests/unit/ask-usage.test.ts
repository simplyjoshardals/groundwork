import { describe, expect, it } from "vitest";
import { describeUsage, formatResetTime } from "@/lib/ask-client";
import { failureForLimit } from "@/lib/ask-client/failures";

const RESET = "2026-11-11T00:00:00.000Z"; // midnight UTC

describe("formatResetTime", () => {
  it("shows only UTC when the reader is on UTC", () => {
    expect(formatResetTime(RESET, "UTC")).toBe("00:00 UTC");
  });

  it("shows the reader's local time beside the UTC time", () => {
    expect(formatResetTime(RESET, "Africa/Lagos")).toBe("01:00 (00:00 UTC)");
    expect(formatResetTime(RESET, "America/New_York")).toBe(
      "19:00 (00:00 UTC)",
    );
  });

  it("falls back to 00:00 UTC when the time is missing or invalid", () => {
    expect(formatResetTime(undefined, "Africa/Lagos")).toBe("00:00 UTC");
    expect(formatResetTime("not-a-date", "Africa/Lagos")).toBe("00:00 UTC");
    expect(formatResetTime("", "Africa/Lagos")).toBe("00:00 UTC");
  });
});

describe("describeUsage", () => {
  const base = { dailyLimit: 20, resetsAt: RESET };

  it("shows how many questions are left and when they reset", () => {
    expect(describeUsage({ ...base, remaining: 17 }, "Africa/Lagos")).toEqual({
      text: "17 of 20 questions left today · resets at 01:00 (00:00 UTC)",
      lastQuestion: false,
    });
  });

  it("uses the singular for one question", () => {
    expect(describeUsage({ ...base, remaining: 1 }, "UTC").text).toBe(
      "1 question left today · resets at 00:00 UTC",
    );
  });

  it("says plainly when none is left", () => {
    expect(describeUsage({ ...base, remaining: 0 }, "UTC")).toEqual({
      text: "That was your last question today. Resets at 00:00 UTC.",
      lastQuestion: true,
    });
  });
});

describe("failureForLimit", () => {
  it("gives the per-user limit its reset time", () => {
    expect(
      failureForLimit(
        { type: "limit", scope: "user", reason: "user_limit", resetsAt: RESET },
        "Africa/Lagos",
      ),
    ).toEqual({
      message:
        "You've used today's questions. Resets at 01:00 (00:00 UTC).",
      retryable: false,
    });
  });

  it("tells a cooldown apart: short wait, retryable, no reset time", () => {
    const failure = failureForLimit({
      type: "limit",
      scope: "user",
      reason: "cooldown",
      resetsAt: RESET,
    });
    expect(failure.retryable).toBe(true);
    expect(failure.message).toContain("too quickly");
    expect(failure.message).not.toMatch(/\d\d:\d\d/);
  });

  it("shows the resting state for the global cap", () => {
    expect(
      failureForLimit({
        type: "limit",
        scope: "global",
        reason: "global_limit",
        resetsAt: RESET,
      }),
    ).toEqual({ message: "Demo is resting; back tomorrow.", retryable: false });
  });

  it("falls back to the scope when an older frame has no reason", () => {
    expect(failureForLimit({ type: "limit", scope: "user" }, "UTC").message).toBe(
      "You've used today's questions. Resets at 00:00 UTC.",
    );
    expect(failureForLimit({ type: "limit", scope: "global" }).message).toBe(
      "Demo is resting; back tomorrow.",
    );
  });
});
