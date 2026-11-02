import { describe, expect, it } from "vitest";
import { chunkPages } from "@/lib/chunking/chunk-pages";
import { normalizePageText } from "@/lib/chunking/normalize";
import {
  DEFAULT_VIRTUAL_PAGE_CHARS,
  paginateText,
} from "@/lib/chunking/paginate-text";

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

/** Text of exactly `length` characters made of words, no sentence punctuation. */
function paragraph(length: number, label: string): string {
  const base = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do ";
  let text = `${label} `;
  while (text.length < length + 5) text += base;
  text = text.slice(0, length);
  return text.endsWith(" ") ? `${text.slice(0, -1)}x` : text;
}

describe("paginateText", () => {
  it("defaults to 4000-character virtual pages", () => {
    expect(DEFAULT_VIRTUAL_PAGE_CHARS).toBe(4000);
  });

  it("returns [] for empty and whitespace-only text", () => {
    expect(paginateText("")).toEqual([]);
    expect(paginateText(" \n\t\r\n\u00a0 ")).toEqual([]);
  });

  it("puts short text on page 1, normalized", () => {
    expect(paginateText("Hello\r\nworld\u00a0!")).toEqual([
      { page: 1, text: "Hello\nworld !" },
    ]);
  });

  it("cuts a .txt file at paragraph boundaries near the target size", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) =>
      paragraph(900, `P${i}`),
    );
    const pages = paginateText(paragraphs.join("\n\n"));
    // 4 paragraphs (3,602 chars) fit in a 4,000-char page; a 5th does not.
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(pages.map((p) => p.text)).toEqual([
      paragraphs.slice(0, 4).join("\n\n"),
      paragraphs.slice(4, 8).join("\n\n"),
      paragraphs.slice(8, 12).join("\n\n"),
    ]);
    expect(
      pages.every((p) => p.text.length <= DEFAULT_VIRTUAL_PAGE_CHARS),
    ).toBe(true);
  });

  it("keeps Markdown as plain text without parsing it", () => {
    const markdown = [
      "# Heading",
      "",
      "* item **bold** and `code`",
      "* [link](https://example.com)",
      "",
      "```",
      "const x = 1;",
      "```",
    ].join("\n");
    const pages = paginateText(markdown);
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toBe(markdown);
  });

  it("normalizes before cutting (CRLF, NBSP, ligatures, soft hyphens)", () => {
    const raw = "ﬁrst\u00a0line\r\n\r\n\r\n\r\nco\u00adop second line";
    expect(paginateText(raw)).toEqual([
      { page: 1, text: "first line\n\ncoop second line" },
    ]);
  });

  it("hard-cuts only when a paragraph is larger than the page size", () => {
    const token = "x".repeat(10000);
    const pages = paginateText(token);
    expect(pages.map((p) => p.text.length)).toEqual([4000, 4000, 2000]);
    expect(pages.map((p) => p.text).join("")).toBe(token);
  });

  it("prefers a sentence boundary over a hard cut inside an oversized paragraph", () => {
    const text = Array.from(
      { length: 400 },
      (_, i) => `Sentence ${String(i).padStart(3, "0")} is here.`,
    ).join(" ");
    const pages = paginateText(text, { virtualPageChars: 1000 });
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages.slice(0, -1)) {
      expect(page.text.endsWith("here.")).toBe(true);
    }
  });

  it("preserves all text across virtual page boundaries, with no loss or duplication", () => {
    const text = [
      Array.from({ length: 30 }, (_, i) =>
        paragraph(150 + i * 7, `A${i}`),
      ).join("\n\n"),
      "x".repeat(450),
      "这是一个测试句子。".repeat(80),
      "😀 end of the file 👨‍👩‍👧‍👦",
    ].join("\n\n");
    for (const virtualPageChars of [4000, 500, 97, 10, 4]) {
      const pages = paginateText(text, { virtualPageChars });
      expect(pages.every((p) => p.text.length <= virtualPageChars)).toBe(true);
      expect(pages.map((p) => p.page)).toEqual(pages.map((_, i) => i + 1));
      // Pages joined in order are the normalized text; only the blank-line
      // separators between pages are dropped.
      expect(stripWhitespace(pages.map((p) => p.text).join(""))).toBe(
        stripWhitespace(normalizePageText(text)),
      );
    }
  });

  it("never splits a surrogate pair at a hard cut", () => {
    const pages = paginateText("😀".repeat(1000), { virtualPageChars: 7 });
    for (const page of pages) {
      expect([...page.text].every((c) => c === "😀")).toBe(true);
    }
    expect(pages.map((p) => p.text).join("")).toBe("😀".repeat(1000));
  });

  it("produces pages that are already normalized", () => {
    const text = "Cafe\u0301 ﬁle\r\n\r\n\r\n".repeat(200);
    for (const page of paginateText(text, { virtualPageChars: 300 })) {
      expect(normalizePageText(page.text)).toBe(page.text);
    }
  });

  it("feeds chunkPages: chunk offsets index into the virtual page text", () => {
    const text = Array.from({ length: 60 }, (_, i) =>
      paragraph(500, `P${i}`),
    ).join("\n\n");
    const pages = paginateText(text);
    expect(pages.length).toBeGreaterThan(5);
    const chunks = chunkPages(pages);
    expect(chunks.length).toBeGreaterThan(pages.length);
    for (const chunk of chunks) {
      const page = pages[chunk.pageNumber - 1];
      expect(chunk.content).toBe(
        page.text.slice(chunk.charStart, chunk.charEnd),
      );
    }
    expect([...new Set(chunks.map((c) => c.pageNumber))]).toEqual(
      pages.map((p) => p.page),
    );
  });

  it("is deterministic", () => {
    const text = Array.from({ length: 50 }, (_, i) =>
      paragraph(333, `D${i}`),
    ).join("\n\n");
    expect(paginateText(text)).toEqual(paginateText(text));
  });

  it("throws on an invalid virtualPageChars", () => {
    for (const virtualPageChars of [0, 3, -5, 100.5, Number.NaN]) {
      expect(() => paginateText("text", { virtualPageChars })).toThrow(
        RangeError,
      );
    }
  });
});
