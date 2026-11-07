import { describe, expect, it } from "vitest";
import { selectFallbackPassage } from "@/lib/pdf-highlight/fallback";
import {
  marksMatchPassage,
  planHighlight,
  toPageTextItems,
  type DeclineReason,
  type HighlightStatus,
} from "@/lib/pdf-highlight/plan";

const TEXT = "A full-time employee receives 26 days of paid annual leave.";
const PASSAGE = { pageNumber: 4, text: TEXT };

function declined(reason: DeclineReason): HighlightStatus {
  return { state: "declined", reason, pageNumber: 4 };
}

describe("selectFallbackPassage", () => {
  it.each(["too_short", "ambiguous", "not_found", "render_mismatch"] as const)(
    "shows the passage when the highlight was declined with %s",
    (reason) => {
      expect(selectFallbackPassage(declined(reason), PASSAGE)).toEqual({
        pageNumber: 4,
        text: TEXT,
      });
    },
  );

  it("shows nothing when a highlight is drawn or being worked out", () => {
    expect(selectFallbackPassage({ state: "highlighted" }, PASSAGE)).toBeNull();
    expect(selectFallbackPassage({ state: "loading" }, PASSAGE)).toBeNull();
  });

  it("shows nothing when the link names no chunk or the chunk did not load", () => {
    expect(selectFallbackPassage({ state: "none" }, PASSAGE)).toBeNull();
    expect(selectFallbackPassage({ state: "unavailable" }, PASSAGE)).toBeNull();
    expect(selectFallbackPassage({ state: "error" }, PASSAGE)).toBeNull();
  });

  it("shows nothing for another page (nothing failed) or another document", () => {
    expect(selectFallbackPassage(declined("other_page"), PASSAGE)).toBeNull();
    expect(
      selectFallbackPassage(declined("other_document"), PASSAGE),
    ).toBeNull();
  });

  it("shows nothing without a passage, or with an empty one", () => {
    expect(selectFallbackPassage(declined("not_found"), null)).toBeNull();
    expect(
      selectFallbackPassage(declined("not_found"), {
        pageNumber: 4,
        text: " \n ",
      }),
    ).toBeNull();
  });

  it("keeps the text exactly as stored (line breaks included)", () => {
    const text = "First paragraph.\n\nSecond paragraph, with <b>markup</b>.";
    expect(
      selectFallbackPassage(declined("ambiguous"), { pageNumber: 2, text })
        ?.text,
    ).toBe(text);
  });
});

describe("forcing a mismatch (BUILD_PLAN 3.6 acceptance)", () => {
  const pageItems = toPageTextItems([
    { str: "Intro text. A full-time employee receives " },
    { str: "26 days of paid annual leave." },
    { str: " Other sentence." },
  ]);

  it("control: the unedited passage highlights, so no panel", () => {
    const plan = planHighlight(pageItems, TEXT);
    expect(plan.status).toBe("highlight");
    const status: HighlightStatus = { state: "highlighted" };
    expect(selectFallbackPassage(status, PASSAGE)).toBeNull();
  });

  it("an edited passage is declined, so there are no ranges and the panel shows", () => {
    const edited =
      "A full-time employee receives 99 days of paid annual leave.";
    const plan = planHighlight(pageItems, edited);
    expect(plan.status).toBe("declined");
    if (plan.status !== "declined") return;
    // A declined plan carries no ranges: nothing can be highlighted.
    expect("ranges" in plan).toBe(false);

    const status: HighlightStatus = {
      state: "declined",
      reason: plan.reason,
      pageNumber: 4,
    };
    expect(
      selectFallbackPassage(status, { pageNumber: 4, text: edited }),
    ).toEqual({ pageNumber: 4, text: edited });
  });

  it("a highlight the browser drew wrongly is withdrawn and the panel shows", () => {
    // The post-render check fails when the marked text is not the passage.
    expect(marksMatchPassage(TEXT, ["Some other highlighted sentence."])).toBe(
      false,
    );
    expect(
      selectFallbackPassage(declined("render_mismatch"), PASSAGE),
    ).not.toBeNull();
  });
});
