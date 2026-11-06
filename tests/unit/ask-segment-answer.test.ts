import { describe, expect, it } from "vitest";
import {
  segmentAnswer,
  validateCitations,
  type AnswerSegment,
} from "@/lib/ask/citations";

const text = (value: string): AnswerSegment => ({ type: "text", text: value });
const cite = (marker: number): AnswerSegment => ({ type: "citation", marker });

/** Puts segments back together; must equal `strippedText` from validation. */
function join(segments: AnswerSegment[]): string {
  return segments
    .map((s) => (s.type === "text" ? s.text : `[${s.marker}]`))
    .join("");
}

describe("segmentAnswer", () => {
  it("returns no segments for an empty text", () => {
    expect(segmentAnswer("", 2)).toEqual([]);
  });

  it("returns one text segment when there are no markers", () => {
    expect(segmentAnswer("No citations here.", 2)).toEqual([
      text("No citations here."),
    ]);
  });

  it("splits a valid marker out and keeps the surrounding text", () => {
    expect(segmentAnswer("Three days [1] a week.", 2)).toEqual([
      text("Three days "),
      cite(1),
      text(" a week."),
    ]);
  });

  it("handles a marker at the very start", () => {
    expect(segmentAnswer("[1] says so.", 1)).toEqual([
      cite(1),
      text(" says so."),
    ]);
  });

  it("handles adjacent markers without empty text between them", () => {
    expect(segmentAnswer("Both agree [1][2].", 2)).toEqual([
      text("Both agree "),
      cite(1),
      cite(2),
      text("."),
    ]);
  });

  it("repeats a citation segment for a repeated marker", () => {
    expect(segmentAnswer("A [2] B [2].", 2)).toEqual([
      text("A "),
      cite(2),
      text(" B "),
      cite(2),
      text("."),
    ]);
  });

  it("never shows an invalid marker: [9] and [0] are removed", () => {
    const segments = segmentAnswer("Thirty days [9] or fewer [0] [1].", 2);
    expect(segments).toEqual([
      text("Thirty days or fewer "),
      cite(1),
      text("."),
    ]);
    expect(join(segments)).not.toMatch(/\[(9|0)\]/);
  });

  it("removes only the invalid one of adjacent markers", () => {
    expect(segmentAnswer("Both [1][9].", 2)).toEqual([
      text("Both "),
      cite(1),
      text("."),
    ]);
  });

  it("treats every marker as invalid when there are no sources", () => {
    expect(segmentAnswer("Made up [1][2].", 0)).toEqual([text("Made up.")]);
  });

  it("leaves bracket forms the prompt does not ask for as plain text", () => {
    expect(segmentAnswer("See [1, 2] and [01].", 3)).toEqual([
      text("See [1, 2] and [01]."),
    ]);
  });

  it("joins back to strippedText from validateCitations", () => {
    const input = "A [1] b [9] c [2][3] d [0] e [2].";
    expect(join(segmentAnswer(input, 3))).toBe(
      validateCitations(input, 3).strippedText,
    );
  });

  it("never produces an empty text segment", () => {
    const segments = segmentAnswer("[1][2] [3]", 3);
    for (const s of segments) {
      if (s.type === "text") expect(s.text).not.toBe("");
    }
  });

  it("gives the same result when called twice (no regex state)", () => {
    const input = "A [1] B [9] C [2].";
    expect(segmentAnswer(input, 2)).toEqual(segmentAnswer(input, 2));
  });

  describe("while streaming", () => {
    const streaming = { streaming: true };

    it("holds back an unfinished marker at the end", () => {
      expect(segmentAnswer("Two days [", 2, streaming)).toEqual([
        text("Two days"),
      ]);
      expect(segmentAnswer("Two days [1", 2, streaming)).toEqual([
        text("Two days"),
      ]);
      expect(segmentAnswer("Two days [12", 2, streaming)).toEqual([
        text("Two days"),
      ]);
    });

    it("shows the marker once its closing bracket has arrived", () => {
      expect(segmentAnswer("Two days [1]", 2, streaming)).toEqual([
        text("Two days "),
        cite(1),
      ]);
    });

    it("keeps an unfinished marker once streaming is over", () => {
      expect(segmentAnswer("Two days [1", 2)).toEqual([text("Two days [1")]);
    });

    it("only holds back a bracket at the end, not in the middle", () => {
      expect(segmentAnswer("a [x] b [", 2, streaming)).toEqual([
        text("a [x] b"),
      ]);
    });
  });
});
