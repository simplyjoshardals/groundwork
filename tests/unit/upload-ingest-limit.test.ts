import { describe, expect, it } from "vitest";
import {
  ingestLimitMessage,
  retryLimitMessage,
} from "@/lib/upload/ingest-limit";

const RESET = "2026-11-11T00:00:00.000Z";
const fileName = "handbook.pdf";

describe("ingestLimitMessage", () => {
  it("says the file is saved, and when the daily limit resets", () => {
    expect(
      ingestLimitMessage(
        { fileName, reason: "user_limit", resetsAt: RESET },
        "Africa/Lagos",
      ),
    ).toBe(
      "Uploaded handbook.pdf, but you've reached today's upload limit, so it hasn't been processed yet. It is saved in your list. Resets at 01:00 (00:00 UTC).",
    );
  });

  it("falls back to 00:00 UTC without a usable reset time", () => {
    expect(
      ingestLimitMessage({ fileName, reason: "user_limit" }, "UTC"),
    ).toContain("Resets at 00:00 UTC.");
    expect(
      ingestLimitMessage(
        { fileName, reason: "user_limit", resetsAt: "nope" },
        "UTC",
      ),
    ).toContain("Resets at 00:00 UTC.");
  });

  it("gives each reason a distinct message, with no time for cooldown or global", () => {
    const messages = (["user_limit", "cooldown", "global_limit"] as const).map(
      (reason) =>
        ingestLimitMessage({ fileName, reason, resetsAt: RESET }, "UTC"),
    );
    expect(new Set(messages).size).toBe(3);
    expect(messages[1]).toContain("too quickly");
    expect(messages[1]).not.toMatch(/\d\d:\d\d/);
    expect(messages[2]).toContain("resting");
    expect(messages[2]).not.toMatch(/\d\d:\d\d/);
    for (const message of messages) expect(message).toContain(fileName);
  });
});

describe("retryLimitMessage", () => {
  it("gives the daily limit its reset time, without a file name", () => {
    expect(
      retryLimitMessage(
        { reason: "user_limit", resetsAt: RESET },
        "Africa/Lagos",
      ),
    ).toBe(
      "You've reached today's upload limit, so this can't be processed yet. Resets at 01:00 (00:00 UTC).",
    );
  });

  it("falls back to 00:00 UTC without a usable reset time", () => {
    expect(retryLimitMessage({ reason: "user_limit" }, "UTC")).toContain(
      "Resets at 00:00 UTC.",
    );
  });

  it("gives each reason a distinct message, with no time for cooldown or global", () => {
    const messages = (["user_limit", "cooldown", "global_limit"] as const).map(
      (reason) => retryLimitMessage({ reason, resetsAt: RESET }, "UTC"),
    );
    expect(new Set(messages).size).toBe(3);
    expect(messages[1]).not.toMatch(/\d\d:\d\d/);
    expect(messages[2]).not.toMatch(/\d\d:\d\d/);
  });
});
