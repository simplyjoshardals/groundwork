import { describe, expect, it } from "vitest";
import { groupCitations, splitParagraphs } from "@/lib/ask/paragraphs";

describe("splitParagraphs", () => {
  it("returns nothing for an empty answer", () => {
    expect(splitParagraphs("", 2)).toEqual([]);
  });

  it("splits on blank lines and drops empty paragraphs", () => {
    const result = splitParagraphs("One [1].\n\n\n\nTwo.\n\n", 1);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([
      { type: "text", text: "One " },
      { type: "citation", marker: 1 },
      { type: "text", text: "." },
    ]);
  });

  it("keeps a single newline inside its paragraph", () => {
    expect(splitParagraphs("a\nb", 1)).toHaveLength(1);
  });

  it("holds back an unfinished marker only in the last paragraph", () => {
    const result = splitParagraphs("First [1].\n\nSecond [", 1, {
      streaming: true,
    });
    const flat = (i: number) =>
      result[i]
        .map((s) => (s.type === "text" ? s.text : `[${s.marker}]`))
        .join("");
    expect(flat(0)).toBe("First [1].");
    expect(flat(1)).toBe("Second");
  });
});

describe("groupCitations", () => {
  const [first] = splitParagraphs("It is 26 days each year [1][2].", 2);

  it("keeps the word before, adjacent markers and the punctuation after together", () => {
    expect(groupCitations(first)).toEqual([
      { type: "text", text: "It is 26 days each " },
      { type: "cites", lead: "year ", markers: [1, 2], trail: "." },
    ]);
  });

  it("leaves text without markers alone", () => {
    expect(groupCitations(splitParagraphs("Plain text.", 1)[0])).toEqual([
      { type: "text", text: "Plain text." },
    ]);
  });

  it("keeps text that follows the punctuation, and handles a marker at the start", () => {
    const nodes = groupCitations(splitParagraphs("[1], then more.", 1)[0]);
    expect(nodes).toEqual([
      { type: "cites", lead: "", markers: [1], trail: "," },
      { type: "text", text: " then more." },
    ]);
  });

  it("does not change its input", () => {
    const before = JSON.stringify(first);
    groupCitations(first);
    expect(JSON.stringify(first)).toBe(before);
  });
});
