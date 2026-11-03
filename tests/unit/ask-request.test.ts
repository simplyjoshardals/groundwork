import { describe, expect, it } from "vitest";
import { MAX_QUESTION_LENGTH, parseAskRequest } from "@/lib/ask/request";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("parseAskRequest", () => {
  it("accepts a question and trims it", () => {
    expect(
      parseAskRequest({ question: "  What is the notice period?  " }),
    ).toEqual({
      ok: true,
      data: { question: "What is the notice period?" },
    });
  });

  it("accepts an optional documentId", () => {
    expect(parseAskRequest({ question: "Q", documentId: UUID })).toEqual({
      ok: true,
      data: { question: "Q", documentId: UUID },
    });
  });

  it("enforces 1 to 500 characters after trimming", () => {
    expect(
      parseAskRequest({ question: "x".repeat(MAX_QUESTION_LENGTH) }).ok,
    ).toBe(true);
    expect(
      parseAskRequest({ question: "x".repeat(MAX_QUESTION_LENGTH + 1) }).ok,
    ).toBe(false);
    expect(parseAskRequest({ question: "" }).ok).toBe(false);
    expect(parseAskRequest({ question: "   \n " }).ok).toBe(false);
  });

  it.each([
    ["missing question", {}],
    ["non-string question", { question: 42 }],
    ["non-object body", "question"],
    ["null body", null],
    ["array body", []],
    ["bad documentId", { question: "Q", documentId: "not-a-uuid" }],
    ["null documentId", { question: "Q", documentId: null }],
  ])("rejects %s with a fixed, safe message", (_name, body) => {
    const result = parseAskRequest(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
      // No raw Zod wording and no echo of the submitted value.
      expect(result.message).not.toMatch(
        /expected|invalid input|too (small|big)|received/i,
      );
      expect(result.message).not.toContain("not-a-uuid");
    }
  });
});
