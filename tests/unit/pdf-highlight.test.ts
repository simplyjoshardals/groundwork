import { describe, expect, it } from "vitest";
import { describeHighlightStatus } from "@/lib/pdf-highlight/messages";
import {
  marksMatchPassage,
  planHighlight,
  renderPlannedItem,
  toPageTextItems,
  type DeclineReason,
  type HighlightStatus,
} from "@/lib/pdf-highlight/plan";

const PASSAGE = "A full-time employee receives 26 days of paid annual leave.";

describe("toPageTextItems", () => {
  it("keeps the index of the full items array, skipping marked content", () => {
    const items = [
      { type: "beginMarkedContent", id: "p1" },
      { str: "Hello ", hasEOL: false },
      { type: "endMarkedContent" },
      { str: "world", hasEOL: true },
    ];
    expect(toPageTextItems(items)).toEqual([
      { itemIndex: 1, str: "Hello " },
      { itemIndex: 3, str: "world" },
    ]);
  });
});

describe("planHighlight", () => {
  it("maps a unique match to the items it spans, by item index", () => {
    const items = toPageTextItems([
      { type: "beginMarkedContent" },
      { str: "Intro text. A full-time employee receives " },
      { str: "26 days of paid annual leave." },
      { str: " Other sentence." },
    ]);
    const plan = planHighlight(items, PASSAGE);
    expect(plan.status).toBe("highlight");
    if (plan.status !== "highlight") return;
    expect([...plan.ranges.keys()]).toEqual([1, 2]);
    expect(renderPlannedItem(plan.ranges, { str: "26 days of paid annual leave.", itemIndex: 2 })).toContain(
      '<mark data-hl="1"',
    );
    expect(renderPlannedItem(plan.ranges, { str: " Other sentence.", itemIndex: 3 })).toBe(
      " Other sentence.",
    );
  });

  it("matches across a hyphenated line break", () => {
    const items = toPageTextItems([
      { str: "Staff must report any reim-" },
      { str: "bursement problems promptly." },
    ]);
    expect(
      planHighlight(items, "report any reimbursement problems promptly").status,
    ).toBe("highlight");
  });

  const declines: Array<[DeclineReason, string, string[]]> = [
    ["not_found", PASSAGE, ["Nothing relevant here at all, only other words."]],
    ["ambiguous", PASSAGE, [PASSAGE, " ", PASSAGE]],
    ["too_short", "Leave", ["Leave policy. Leave days."]],
  ];
  it.each(declines)("declines with %s", (reason, passage, strings) => {
    const plan = planHighlight(
      toPageTextItems(strings.map((str) => ({ str }))),
      passage,
    );
    expect(plan).toEqual({ status: "declined", reason });
  });
});

describe("renderPlannedItem", () => {
  it("escapes markup in the PDF text", () => {
    const ranges = new Map([[0, { itemIndex: 0, from: 0, to: 3 }]]);
    const html = renderPlannedItem(ranges, { str: "<b>x", itemIndex: 0 });
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("marksMatchPassage", () => {
  it("accepts marks whose text is the passage, however it was split", () => {
    expect(
      marksMatchPassage(PASSAGE, ["A full-time employee receives ", "26 days of paid annual leave."]),
    ).toBe(true);
  });
  it("rejects no marks and the wrong text", () => {
    expect(marksMatchPassage(PASSAGE, [])).toBe(false);
    expect(marksMatchPassage(PASSAGE, ["Some other highlighted sentence here."])).toBe(false);
  });
});

describe("describeHighlightStatus", () => {
  it("is silent only when the link names no chunk", () => {
    expect(describeHighlightStatus({ state: "none" })).toBeNull();
  });

  const statuses: HighlightStatus[] = [
    { state: "loading" },
    { state: "highlighted" },
    { state: "unavailable" },
    { state: "error" },
    ...(
      ["other_document", "other_page", "too_short", "ambiguous", "not_found", "render_mismatch"] as const
    ).map((reason) => ({ state: "declined" as const, reason, pageNumber: 4 })),
  ];
  it.each(statuses)("explains %j", (status) => {
    expect(describeHighlightStatus(status)?.text).toBeTruthy();
  });

  it("offers Retry only for a load failure", () => {
    expect(describeHighlightStatus({ state: "error" })?.retryable).toBe(true);
    expect(describeHighlightStatus({ state: "unavailable" })?.retryable).toBe(false);
  });

  it("names the page for a passage on another page", () => {
    expect(
      describeHighlightStatus({ state: "declined", reason: "other_page", pageNumber: 7 })?.text,
    ).toContain("page 7");
  });
});
