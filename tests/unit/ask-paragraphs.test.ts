import { describe, expect, it } from "vitest";
import { splitParagraphs } from "@/lib/ask/paragraphs";

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
