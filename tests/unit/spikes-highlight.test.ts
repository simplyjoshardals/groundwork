import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import {
  buildPageIndex,
  escapeHtml,
  findPassage,
  MIN_KEY_LENGTH,
  normalizeToKey,
  type PageTextItem,
  renderItemHtml,
} from "@/spikes/highlight/match";
import { classifyOutcome } from "@/spikes/highlight/outcome";
import { FIXTURES } from "@/spikes/highlight/passages";

function items(...strings: string[]): PageTextItem[] {
  return strings.map((str, itemIndex) => ({ itemIndex, str }));
}

describe("normalizeToKey", () => {
  it("ignores whitespace, line breaks and case", () => {
    expect(normalizeToKey("  The  Quick\n brown\tFox ")).toBe(
      "thequickbrownfox",
    );
  });

  it("folds ligatures to their letters", () => {
    expect(normalizeToKey("ﬁnal oﬃce ﬂow")).toBe("finaloffice" + "flow");
  });

  it("ignores soft hyphens, hyphens and dashes of every kind", () => {
    expect(normalizeToKey("hy­phen-ated")).toBe("hyphenated");
    expect(normalizeToKey("a‐b‑c–d—e−f")).toBe("abcdef");
  });

  it("treats curly and straight quotes alike", () => {
    expect(normalizeToKey("“don’t”")).toBe(normalizeToKey('"don\'t"'));
  });

  it("ignores non-breaking spaces, zero-width characters and accents", () => {
    expect(normalizeToKey("a b​c")).toBe("abc");
    expect(normalizeToKey("café")).toBe(normalizeToKey("café"));
  });
});

describe("findPassage", () => {
  it("maps a match that crosses items back to per-item ranges", () => {
    const index = buildPageIndex(
      items("The quick bro", "wn fox ", "jumps over"),
    );
    const result = findPassage(index, "quick brown fox jumps");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.ranges).toEqual([
      { itemIndex: 0, from: 4, to: 13 },
      { itemIndex: 1, from: 0, to: 6 },
      { itemIndex: 2, from: 0, to: 5 },
    ]);
  });

  it("keeps the original item indexes when some entries are not text", () => {
    // react-pdf numbers every entry of the text content, text or not.
    const sparse: PageTextItem[] = [
      { itemIndex: 3, str: "alpha beta gamma" },
      { itemIndex: 7, str: "delta epsilon" },
    ];
    const result = findPassage(buildPageIndex(sparse), "gamma delta epsilon");
    expect(
      result.status === "found" && result.ranges.map((r) => r.itemIndex),
    ).toEqual([3, 7]);
  });

  it("matches table cells that PDF.js splits into separate items", () => {
    const index = buildPageIndex(
      items("Help Desk 100", "Marcus", "25 Jan 2027", "1464.89", "Done"),
    );
    expect(
      findPassage(index, "Help Desk 100 Marcus 25 Jan 2027 1464.89 Done")
        .status,
    ).toBe("found");
  });

  it("matches a word hyphenated across a line break", () => {
    const index = buildPageIndex(
      items("the revised hy-", "phenated policy applies"),
    );
    expect(findPassage(index, "revised hyphenated policy applies").status).toBe(
      "found",
    );
  });

  it("matches ligature glyphs in the page against plain letters in the passage", () => {
    const index = buildPageIndex(items("the oﬃce ﬁle is ﬂat today"));
    const result = findPassage(index, "the office file is flat today");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    // The range covers the original ligature characters, not the expanded letters.
    expect(result.ranges).toEqual([{ itemIndex: 0, from: 0, to: 25 }]);
  });

  it("declines an ambiguous passage", () => {
    const repeated = "the weekly meeting room policy is reviewed";
    const index = buildPageIndex(items(repeated, "something else", repeated));
    expect(findPassage(index, repeated)).toEqual({
      status: "ambiguous",
      occurrences: 2,
    });
  });

  it("reports a missing passage", () => {
    const index = buildPageIndex(items("nothing relevant on this page at all"));
    expect(findPassage(index, "a passage that is not there").status).toBe(
      "not_found",
    );
  });

  it("declines a passage that is too short to be trusted", () => {
    const index = buildPageIndex(items("Done Done Done"));
    const result = findPassage(index, "Done");
    expect(result).toEqual({ status: "too_short", keyLength: 4 });
    expect(MIN_KEY_LENGTH).toBeGreaterThan(4);
  });
});

describe("renderItemHtml", () => {
  it("escapes text, so markup inside a PDF stays text", () => {
    expect(escapeHtml(`<b onclick="x">&'`)).toBe(
      "&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;",
    );
    expect(renderItemHtml("<script>alert(1)</script>", null)).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("wraps only the matched slice in a marked element", () => {
    const html = renderItemHtml("abc <def> ghi", {
      itemIndex: 0,
      from: 4,
      to: 9,
    });
    expect(html.startsWith("abc ")).toBe(true);
    expect(html).toContain('<mark data-hl="1"');
    expect(html).toContain("&lt;def&gt;</mark>");
    expect(html.endsWith(" ghi")).toBe(true);
  });

  it("clamps a range that runs past the end of the item", () => {
    expect(renderItemHtml("abc", { itemIndex: 0, from: 1, to: 99 })).toContain(
      ">bc</mark>",
    );
  });
});

describe("classifyOutcome", () => {
  const passage = "the weekly meeting room policy is reviewed";

  it("is NONE when nothing is highlighted", () => {
    expect(
      classifyOutcome(passage, {
        markCount: 0,
        visibleMarks: 0,
        markedText: "",
      }).outcome,
    ).toBe("NONE");
  });

  it("is CORRECT only for visible highlights that cover the passage", () => {
    expect(
      classifyOutcome(passage, {
        markCount: 2,
        visibleMarks: 2,
        markedText: "the weekly meeting room policy is re" + "viewed",
      }).outcome,
    ).toBe("CORRECT");
  });

  it("is WRONG when the highlighted text is something else", () => {
    expect(
      classifyOutcome(passage, {
        markCount: 1,
        visibleMarks: 1,
        markedText: "an unrelated sentence",
      }).outcome,
    ).toBe("WRONG");
  });

  it("is WRONG when the right text is highlighted but not visible", () => {
    expect(
      classifyOutcome(passage, {
        markCount: 1,
        visibleMarks: 0,
        markedText: passage,
      }).outcome,
    ).toBe("WRONG");
  });
});

describe("passages against real PDF.js text items (Node build)", () => {
  // A text-level pre-check only. It is NOT highlight success: that is decided
  // from the rendered DOM in the browser (docs/spikes/highlight.md).
  it("finds every passage except the interleaved two-column ones", async () => {
    const statuses: Record<string, string> = {};
    for (const fixture of FIXTURES) {
      const bytes = new Uint8Array(
        await readFile(
          path.join(
            process.cwd(),
            "spikes",
            "pdf",
            "fixtures",
            fixture.fileName,
          ),
        ),
      );
      const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
      for (const passage of fixture.passages) {
        const content = await (
          await pdf.getPage(passage.page)
        ).getTextContent();
        const pageItems = content.items.flatMap((item, itemIndex) =>
          "str" in item ? [{ itemIndex, str: item.str }] : [],
        );
        statuses[passage.id] = findPassage(
          buildPageIndex(pageItems),
          passage.text,
        ).status;
      }
    }
    const notFound = Object.entries(statuses)
      .filter(([, status]) => status !== "found")
      .map(([id]) => id);
    expect(notFound).toEqual(["two-column-4", "two-column-5"]);
    expect(Object.keys(statuses)).toHaveLength(20);
  });
});
