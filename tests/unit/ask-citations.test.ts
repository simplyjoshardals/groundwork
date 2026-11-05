import { describe, expect, it } from "vitest";
import { validateCitations } from "@/lib/ask/citations";

describe("validateCitations", () => {
  it("accepts a valid marker and keeps it in the text", () => {
    expect(validateCitations("Notice is 30 days [1].", 2)).toEqual({
      citations: [1],
      invalidCitations: [],
      strippedText: "Notice is 30 days [1].",
      uncited: false,
    });
  });

  it("treats a marker above the source count as invalid and strips it", () => {
    expect(validateCitations("Thirty days [9].", 3)).toEqual({
      citations: [],
      invalidCitations: [9],
      strippedText: "Thirty days.",
      uncited: true,
    });
  });

  it("treats [0] as invalid", () => {
    const result = validateCitations("Claim [0].", 3);
    expect(result.invalidCitations).toEqual([0]);
    expect(result.strippedText).toBe("Claim.");
  });

  it("accepts the boundary markers 1 and sourceCount", () => {
    const result = validateCitations("A [1] B [3].", 3);
    expect(result.citations).toEqual([1, 3]);
    expect(result.invalidCitations).toEqual([]);
  });

  it("lists a repeated marker once, in first-appearance order", () => {
    const result = validateCitations("A [2] B [1] C [2] D [1].", 2);
    expect(result.citations).toEqual([2, 1]);
    expect(result.strippedText).toBe("A [2] B [1] C [2] D [1].");
  });

  it("lists a repeated invalid marker once", () => {
    const result = validateCitations("A [7] B [7] C [8].", 2);
    expect(result.invalidCitations).toEqual([7, 8]);
    expect(result.strippedText).toBe("A B C.");
  });

  it("handles adjacent markers [1][2]", () => {
    const result = validateCitations("Both agree [1][2].", 2);
    expect(result.citations).toEqual([1, 2]);
    expect(result.strippedText).toBe("Both agree [1][2].");
  });

  it("strips only the invalid one of adjacent markers", () => {
    const result = validateCitations("Both agree [1][9].", 2);
    expect(result.citations).toEqual([1]);
    expect(result.invalidCitations).toEqual([9]);
    expect(result.strippedText).toBe("Both agree [1].");
  });

  it("treats every marker as invalid when there are no passages", () => {
    const result = validateCitations("Made up [1][2].", 0);
    expect(result.citations).toEqual([]);
    expect(result.invalidCitations).toEqual([1, 2]);
    expect(result.strippedText).toBe("Made up.");
    expect(result.uncited).toBe(true);
  });

  it("flags text with no markers as uncited", () => {
    expect(validateCitations("An answer with no citations.", 3)).toEqual({
      citations: [],
      invalidCitations: [],
      strippedText: "An answer with no citations.",
      uncited: true,
    });
  });

  it("is not uncited when at least one marker is valid, even beside an invalid one", () => {
    expect(validateCitations("A [1] B [9].", 2).uncited).toBe(false);
  });

  it("handles an empty text", () => {
    expect(validateCitations("", 2)).toEqual({
      citations: [],
      invalidCitations: [],
      strippedText: "",
      uncited: true,
    });
  });

  it("leaves bracket forms the prompt does not ask for alone", () => {
    const text = "See [1, 2], [1-3], [a], [] and [1](http://x) and [01].";
    const result = validateCitations(text, 3);
    // Only the exact `[1]` inside the link text counts; the rest is plain text.
    expect(result.citations).toEqual([1]);
    expect(result.invalidCitations).toEqual([]);
    expect(result.strippedText).toBe(text);
  });

  it("removes one preceding space with an invalid marker, no more", () => {
    expect(validateCitations("a [9] b", 1).strippedText).toBe("a b");
    expect(validateCitations("a  [9] b", 1).strippedText).toBe("a  b");
    expect(validateCitations("a\n[9] b", 1).strippedText).toBe("a\n b");
    expect(validateCitations("[9] b", 1).strippedText).toBe(" b");
  });

  it("treats a very long digit run as an invalid marker, not a crash", () => {
    const huge = "9".repeat(40);
    const result = validateCitations(`x [${huge}] y`, 3);
    expect(result.citations).toEqual([]);
    expect(result.invalidCitations).toHaveLength(1);
    expect(result.strippedText).toBe("x y");
  });

  it("gives the same result when called twice on the same text (no regex state)", () => {
    const text = "A [1] B [9].";
    expect(validateCitations(text, 2)).toEqual(validateCitations(text, 2));
  });
});
