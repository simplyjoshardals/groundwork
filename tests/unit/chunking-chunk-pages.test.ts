import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_CHARS,
  DEFAULT_OVERLAP_CHARS,
  MAX_CHUNK_CHARS,
  chunkPages,
  type Chunk,
  type PageInput,
} from "@/lib/chunking/chunk-pages";
import { normalizePageText } from "@/lib/chunking/normalize";

// ---------------------------------------------------------------- helpers

const FAMILY = "👨‍👩‍👧‍👦";

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Text of exactly `length` characters made of words, with no sentence punctuation. */
function paragraph(length: number, label: string): string {
  const base = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do ";
  let text = `${label} `;
  while (text.length < length + 5) text += base;
  text = text.slice(0, length);
  return text.endsWith(" ") ? `${text.slice(0, -1)}x` : text;
}

/** "Sentence 00 here. Sentence 01 here. ..." Each sentence plus space is 18 chars. */
function sentences(count: number): string {
  return Array.from(
    { length: count },
    (_, i) => `Sentence ${String(i).padStart(2, "0")} here.`,
  ).join(" ");
}

/** "w000 w001 ..." Each word plus space is 5 chars. */
function wordRun(count: number): string {
  return Array.from(
    { length: count },
    (_, i) => `w${String(i).padStart(3, "0")}`,
  ).join(" ");
}

interface Limits {
  maxChars: number;
  overlapChars: number;
}

/**
 * Returns the first violated invariant, or null. Plain checks (no expect per
 * chunk) keep the generated-text test fast and the failure message specific.
 */
function findViolation(
  pages: readonly PageInput[],
  chunks: readonly Chunk[],
  limits: Limits,
): string | null {
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].chunkIndex !== i) return `chunkIndex ${i} is not contiguous`;
  }
  const expectedPages = pages
    .map((p) => ({ page: p.page, text: normalizePageText(p.text) }))
    .filter((p) => p.text.length > 0);
  const pageOrder = [...new Set(chunks.map((c) => c.pageNumber))];
  if (pageOrder.join(",") !== expectedPages.map((p) => p.page).join(",")) {
    return `page order ${pageOrder.join(",")} is wrong`;
  }

  for (const { page, text } of expectedPages) {
    const own = chunks.filter((c) => c.pageNumber === page);
    if (own[0].charStart !== 0)
      return `page ${page}: first chunk does not start at 0`;
    if (own[own.length - 1].charEnd !== text.length) {
      return `page ${page}: last chunk does not end at the page end`;
    }
    let rebuilt = "";
    for (let i = 0; i < own.length; i++) {
      const chunk = own[i];
      const label = `page ${page} chunk ${chunk.chunkIndex} [${chunk.charStart},${chunk.charEnd})`;
      if (chunk.content !== text.slice(chunk.charStart, chunk.charEnd)) {
        return `${label}: content is not text.slice(charStart, charEnd)`;
      }
      if (chunk.charEnd <= chunk.charStart)
        return `${label}: empty or inverted`;
      if (chunk.content.length > limits.maxChars) {
        return `${label}: ${chunk.content.length} chars exceeds maxChars ${limits.maxChars}`;
      }
      if (chunk.content !== chunk.content.trim()) {
        return `${label}: has leading or trailing whitespace`;
      }
      if (hasLoneSurrogate(chunk.content))
        return `${label}: splits a surrogate pair`;
      if (i === 0) {
        rebuilt = chunk.content;
        continue;
      }
      const previous = own[i - 1];
      if (chunk.charStart <= previous.charStart)
        return `${label}: start does not advance`;
      if (chunk.charEnd <= previous.charEnd)
        return `${label}: end does not advance`;
      if (chunk.charStart < previous.charEnd) {
        // Overlap, measured from the offsets rather than assumed.
        const overlap = previous.charEnd - chunk.charStart;
        if (overlap > limits.overlapChars) {
          return `${label}: overlap ${overlap} exceeds ${limits.overlapChars}`;
        }
        rebuilt += chunk.content.slice(overlap);
      } else {
        const gap = text.slice(previous.charEnd, chunk.charStart);
        if (stripWhitespace(gap) !== "")
          return `${label}: non-whitespace text dropped`;
        rebuilt += chunk.content;
      }
    }
    if (stripWhitespace(rebuilt) !== stripWhitespace(text)) {
      return `page ${page}: reassembly does not match the page text`;
    }
  }
  return null;
}

function expectInvariants(
  pages: readonly PageInput[],
  chunks: readonly Chunk[],
  limits: Limits,
): void {
  expect(findViolation(pages, chunks, limits)).toBeNull();
}

function chunkAndCheck(
  pages: readonly PageInput[],
  options: Partial<Limits> = {},
): Chunk[] {
  const limits: Limits = {
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    overlapChars: options.overlapChars ?? DEFAULT_OVERLAP_CHARS,
  };
  const chunks = chunkPages(pages, options);
  expectInvariants(pages, chunks, limits);
  return chunks;
}

// ------------------------------------------------------------------ basics

describe("chunkPages basics", () => {
  it("exposes the approved defaults and the 4000-character ceiling", () => {
    expect(DEFAULT_MAX_CHARS).toBe(1200);
    expect(DEFAULT_OVERLAP_CHARS).toBe(150);
    expect(MAX_CHUNK_CHARS).toBe(4000);
  });

  it("returns [] for empty input", () => {
    expect(chunkPages([])).toEqual([]);
    expect(chunkPages([{ page: 1, text: "" }])).toEqual([]);
  });

  it("puts a short page into a single chunk covering the whole page", () => {
    const chunks = chunkAndCheck([{ page: 1, text: "Hello world." }]);
    expect(chunks).toEqual([
      {
        chunkIndex: 0,
        pageNumber: 1,
        charStart: 0,
        charEnd: 12,
        content: "Hello world.",
      },
    ]);
  });

  it("produces several chunks for a long single page", () => {
    const chunks = chunkAndCheck([{ page: 1, text: sentences(200) }]);
    expect(chunks.length).toBeGreaterThan(2);
  });

  it("skips empty and whitespace-only pages", () => {
    const chunks = chunkAndCheck([
      { page: 1, text: "" },
      { page: 2, text: " \n\t\u00a0\r\n " },
      { page: 3, text: "\u200b\u00ad" },
    ]);
    expect(chunks).toEqual([]);
  });

  it("keeps chunkIndex contiguous across pages even when pages are skipped", () => {
    const chunks = chunkAndCheck([
      { page: 1, text: "first" },
      { page: 2, text: "   " },
      { page: 3, text: "third" },
      { page: 4, text: "" },
      { page: 5, text: "fifth" },
    ]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
    expect(chunks.map((c) => c.pageNumber)).toEqual([1, 3, 5]);
  });

  it("preserves page numbers and input order", () => {
    const chunks = chunkAndCheck([
      { page: 7, text: sentences(120) },
      { page: 2, text: sentences(120) },
    ]);
    const order = [...new Set(chunks.map((c) => c.pageNumber))];
    expect(order).toEqual([7, 2]);
  });

  it("does not hardcode the 30-page limit", () => {
    const pages = Array.from({ length: 45 }, (_, i) => ({
      page: i + 1,
      text: `page ${i + 1}`,
    }));
    expect(chunkAndCheck(pages)).toHaveLength(45);
  });

  it("is deterministic", () => {
    const pages = [
      { page: 1, text: sentences(150) },
      { page: 2, text: `${paragraph(900, "A")}\n\n${paragraph(900, "B")}` },
    ];
    const first = chunkPages(pages);
    expect(chunkPages(pages)).toEqual(first);
    expect(chunkPages(structuredClone(pages))).toEqual(first);
  });

  it("does not mutate its input", () => {
    const pages = Object.freeze([
      Object.freeze({ page: 1, text: `  ${sentences(80)} \r\n ` }),
    ]);
    expect(() => chunkPages(pages)).not.toThrow();
  });
});

// -------------------------------------------------------- normalized offsets

describe("chunkPages offsets refer to normalized text", () => {
  const raw =
    "Cafe\u0301 \r\n\ufb01le\u00a0\u00a0data\t\t\r\n\r\n\r\nNext\u00adword \u2026\r";

  it("matches the normalized text, not the raw text (single chunk)", () => {
    const normalized = normalizePageText(raw);
    expect(normalized).not.toBe(raw);
    const chunks = chunkAndCheck([{ page: 1, text: raw }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].charStart).toBe(0);
    expect(chunks[0].charEnd).toBe(normalized.length);
    expect(chunks[0].charEnd).not.toBe(raw.length);
    expect(chunks[0].content).toBe(normalized);
  });

  it("keeps slice equality after CRLF, NBSP, ligature and combining input (many chunks)", () => {
    const longRaw = Array.from(
      { length: 40 },
      (_, i) =>
        `Cafe\u0301 ${i}.\r\n\ufb01le\u00a0data\t\tends here.\r\n\r\n\r\nNext\u00adword ok.`,
    ).join("\r\n");
    const normalized = normalizePageText(longRaw);
    const chunks = chunkAndCheck([{ page: 1, text: longRaw }], {
      maxChars: 200,
      overlapChars: 40,
    });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.content).toBe(
        normalized.slice(chunk.charStart, chunk.charEnd),
      );
      expect(chunk.content).not.toMatch(/[\r\u00a0\t\ufb01\u00ad]/);
      expect(chunk.content).not.toContain("\n\n\n");
    }
  });

  it("keeps the family emoji and joiners intact in a chunk", () => {
    const text = `Family ${FAMILY} and a joiner a\u200db.`;
    const chunks = chunkAndCheck([{ page: 1, text }]);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].content).toContain(FAMILY);
  });
});

// -------------------------------------------------------------- page bounds

describe("chunkPages page boundaries", () => {
  it("never lets a chunk or its overlap cross a page", () => {
    const pageA = `${sentences(60)} ALPHA`;
    const pageB = `OMEGA ${sentences(60)}`;
    const chunks = chunkAndCheck(
      [
        { page: 1, text: pageA },
        { page: 2, text: pageB },
      ],
      { maxChars: 300, overlapChars: 100 },
    );
    const a = chunks.filter((c) => c.pageNumber === 1);
    const b = chunks.filter((c) => c.pageNumber === 2);
    expect(a.length).toBeGreaterThan(1);
    expect(b.length).toBeGreaterThan(1);
    expect(a.some((c) => c.content.includes("OMEGA"))).toBe(false);
    expect(b.some((c) => c.content.includes("ALPHA"))).toBe(false);
    expect(a[a.length - 1].charEnd).toBe(pageA.length);
    expect(b[0].charStart).toBe(0);
    expect(b[0].content.startsWith("OMEGA")).toBe(true);
  });
});

// ------------------------------------------------------- grouping and splits

describe("chunkPages paragraph grouping", () => {
  it("groups whole paragraphs greedily up to maxChars", () => {
    const paragraphs = ["A", "B", "C", "D", "E", "F"].map((l) =>
      paragraph(400, l),
    );
    const chunks = chunkAndCheck([{ page: 1, text: paragraphs.join("\n\n") }], {
      maxChars: 1000,
      overlapChars: 0,
    });
    expect(chunks.map((c) => c.content)).toEqual([
      `${paragraphs[0]}\n\n${paragraphs[1]}`,
      `${paragraphs[2]}\n\n${paragraphs[3]}`,
      `${paragraphs[4]}\n\n${paragraphs[5]}`,
    ]);
  });

  it("ends chunks at paragraph boundaries rather than mid-paragraph", () => {
    const paragraphs = ["A", "B", "C"].map((l) => paragraph(700, l));
    const chunks = chunkAndCheck([{ page: 1, text: paragraphs.join("\n\n") }], {
      maxChars: 1200,
      overlapChars: 0,
    });
    expect(chunks.map((c) => c.content)).toEqual(paragraphs);
  });
});

describe("chunkPages oversized paragraphs", () => {
  it("splits at the latest sentence boundary inside the window", () => {
    const text = sentences(160); // 2878 chars, one paragraph
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 1000,
      overlapChars: 0,
    });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.content.endsWith("here.")).toBe(true);
      // The latest sentence end inside a 1000-char window is within one sentence of it.
      expect(chunk.content.length).toBeGreaterThanOrEqual(1000 - 18);
    }
  });

  it("falls back to a line break when there is no sentence boundary", () => {
    const text = Array.from(
      { length: 80 },
      (_, i) => `row ${i} alpha beta gamma`,
    ).join("\n");
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 120,
      overlapChars: 0,
    });
    for (const chunk of chunks.slice(0, -1)) {
      expect(text[chunk.charEnd]).toBe("\n");
    }
  });

  it("falls back to whitespace when there is no line break either", () => {
    const text = wordRun(300);
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 100,
      overlapChars: 0,
    });
    for (const chunk of chunks.slice(0, -1)) {
      expect(text[chunk.charEnd]).toBe(" ");
    }
  });

  it("hard-cuts a token with no boundary at all", () => {
    const text = "x".repeat(950);
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 100,
      overlapChars: 0,
    });
    expect(chunks).toHaveLength(10);
    expect(
      chunks.every((c) => c.content.length === 100 || c.charEnd === 950),
    ).toBe(true);
  });

  it("handles a 5,000-character unbroken token with default options", () => {
    const token = "a".repeat(5000);
    const chunks = chunkAndCheck([{ page: 1, text: token }]);
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.every((c) => c.content.length <= DEFAULT_MAX_CHARS)).toBe(
      true,
    );
    let rebuilt = chunks[0].content;
    for (const chunk of chunks.slice(1)) {
      rebuilt += chunk.content.slice(
        chunks[chunk.chunkIndex - 1].charEnd - chunk.charStart,
      );
    }
    expect(rebuilt).toBe(token);
  });
});

// ------------------------------------------------------------------ overlap

describe("chunkPages overlap", () => {
  it("represents overlap exactly in the offsets", () => {
    const text = sentences(80);
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 200,
      overlapChars: 60,
    });
    expect(chunks.length).toBeGreaterThan(3);
    for (let i = 1; i < chunks.length; i++) {
      const previous = chunks[i - 1];
      const chunk = chunks[i];
      const overlap = previous.charEnd - chunk.charStart;
      expect(overlap).toBeGreaterThan(0);
      expect(overlap).toBeLessThanOrEqual(60);
      expect(chunk.charStart).toBeLessThan(previous.charEnd);
      const shared = text.slice(chunk.charStart, previous.charEnd);
      expect(previous.content.endsWith(shared)).toBe(true);
      expect(chunk.content.startsWith(shared)).toBe(true);
    }
  });

  it("snaps to a word start when the requested overlap cannot land exactly", () => {
    // Words are 4 chars plus a space, so word starts sit at multiples of 5.
    const text = wordRun(120);
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 50,
      overlapChars: 20,
    });
    // Window [0, 50]: the latest space is at 49. The earliest word start at
    // or after 49 - 20 = 29 is 30, so the real overlap is 19, not 20.
    expect(chunks[0].charEnd).toBe(49);
    expect(chunks[1].charStart).toBe(30);
    expect(chunks[0].charEnd - chunks[1].charStart).toBe(19);
    for (const chunk of chunks.slice(1)) {
      expect(text[chunk.charStart - 1]).toBe(" ");
    }
  });

  it("prefers a sentence start over an earlier word start", () => {
    const text = sentences(80);
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 100,
      overlapChars: 40,
    });
    for (const chunk of chunks.slice(1)) {
      // Sentence starts are at multiples of 18.
      expect(chunk.charStart % 18).toBe(0);
      const previous = chunks[chunk.chunkIndex - 1];
      // It is the earliest sentence start within the allowed overlap.
      expect(chunk.charStart - 18).toBeLessThan(previous.charEnd - 40);
    }
  });

  it("prefers a paragraph start over sentence and word starts", () => {
    const first = paragraph(80, "P1");
    const short = "Short tail para.";
    const text = `${first}\n\n${short}\n\n${paragraph(400, "P3")}`;
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 100,
      overlapChars: 30,
    });
    expect(chunks[0].charEnd).toBe(80 + 2 + short.length);
    expect(chunks[1].charStart).toBe(82);
    expect(chunks[1].content.startsWith(short)).toBe(true);
  });

  it("uses no overlap when overlapChars is 0", () => {
    const chunks = chunkAndCheck([{ page: 1, text: sentences(80) }], {
      maxChars: 200,
      overlapChars: 0,
    });
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeGreaterThanOrEqual(chunks[i - 1].charEnd);
    }
  });

  it("starts without overlap when the tail has no boundary and the chunk was not hard-cut", () => {
    const token = "z".repeat(60);
    const text = `${paragraph(100, "P")}\n\n${token}\n\n${paragraph(300, "Q")}`;
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 300,
      overlapChars: 40,
    });
    // The first chunk ends after the token; its last 40 chars are inside the
    // token (no boundary), so the next chunk must not start mid-token.
    const second = chunks[1];
    expect(second.charStart).toBe(text.indexOf(paragraph(300, "Q")));
  });
});

// ---------------------------------------------------- trailing short pieces

describe("chunkPages short trailing pieces", () => {
  it("absorbs a very short final paragraph when it fits within maxChars", () => {
    const text = `${paragraph(1100, "A")}\n\n${paragraph(1000, "B")}\n\nTiny end.`;
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 1200,
      overlapChars: 100,
    });
    expect(chunks).toHaveLength(2);
    const last = chunks[1];
    expect(last.content.endsWith("Tiny end.")).toBe(true);
    expect(last.charEnd).toBe(text.length);
    expect(last.content.length).toBeLessThanOrEqual(1200);
  });

  it("keeps a short final piece as its own chunk when it cannot be merged", () => {
    const text = `${paragraph(1195, "A")}\n\nTail.`; // 1202 chars > 1200
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 1200,
      overlapChars: 100,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].charEnd).toBe(1195);
    const last = chunks[1];
    expect(last.charEnd).toBe(1202);
    expect(last.content.endsWith("Tail.")).toBe(true);
    expect(last.charStart).toBeLessThan(1195); // carries the usual overlap
    expect(last.content.length).toBeLessThanOrEqual(1200);
  });

  it("never discards the short final piece, even with no overlap", () => {
    const text = `${paragraph(1195, "A")}\n\nTail.`;
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 1200,
      overlapChars: 0,
    });
    expect(chunks.map((c) => c.content)).toEqual([
      paragraph(1195, "A"),
      "Tail.",
    ]);
  });

  it("never merges past maxChars", () => {
    const text = `${paragraph(98, "A")}\n\nZ`; // 101 chars with maxChars 100
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 100,
      overlapChars: 0,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.content.length <= 100)).toBe(true);
    expect(chunks[1].content).toBe("Z");
  });
});

// ------------------------------------------------------------------ Unicode

describe("chunkPages Unicode handling", () => {
  it("never splits a surrogate pair when hard-cutting", () => {
    const text = "😀".repeat(400);
    for (const [maxChars, overlapChars] of [
      [7, 3],
      [5, 0],
      [4, 1],
      [9, 5],
      [101, 51],
    ]) {
      const chunks = chunkAndCheck([{ page: 1, text }], {
        maxChars,
        overlapChars,
      });
      for (const chunk of chunks) {
        expect(hasLoneSurrogate(chunk.content)).toBe(false);
        expect([...chunk.content].every((c) => c === "😀")).toBe(true);
      }
    }
  });

  it("never splits a surrogate pair in mixed ASCII and astral text", () => {
    const text = "ab😀cd😀😀e".repeat(200);
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 11,
      overlapChars: 4,
    });
    expect(chunks.length).toBeGreaterThan(10);
  });

  it("never ends a chunk in whitespace when overlap leaves only whitespace in the window", () => {
    // Found by the seeded fuzz run: with maxChars 5 and overlap 2 the window
    // after the first chunk held only "\n\n" before an astral character.
    const text = "aaa a\n\n 😀";
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 5,
      overlapChars: 2,
    });
    expect(chunks.every((c) => c.content === c.content.trim())).toBe(true);
    expect(chunks[chunks.length - 1].content.endsWith("😀")).toBe(true);
  });

  it("splits CJK text without spaces at 。", () => {
    const text = "这是一个测试句子。".repeat(300);
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 100,
      overlapChars: 20,
    });
    expect(chunks.length).toBeGreaterThan(10);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.content.endsWith("。")).toBe(true);
    }
  });

  it("splits CJK text at fullwidth ！ (NFKC turns it into ASCII !)", () => {
    const text = "你好世界！".repeat(300);
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 100,
      overlapChars: 20,
    });
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.content.endsWith("!")).toBe(true);
    }
  });

  it("hard-cuts CJK text with no punctuation and keeps all of it", () => {
    const text = "测试".repeat(1000);
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 100,
      overlapChars: 0,
    });
    expect(chunks.map((c) => c.content).join("")).toBe(text);
  });

  it("does not split a closing quote from its sentence", () => {
    const text = Array.from(
      { length: 60 },
      () => 'He said "go home." Then left.',
    ).join(" ");
    const chunks = chunkAndCheck([{ page: 1, text }], {
      maxChars: 90,
      overlapChars: 0,
    });
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.content.endsWith(".") || chunk.content.endsWith('."')).toBe(
        true,
      );
      expect(chunk.content.startsWith('"')).toBe(false);
    }
  });
});

// --------------------------------------------------------------- validation

describe("chunkPages validation", () => {
  it("throws on duplicate page numbers (even when one page is empty)", () => {
    expect(() =>
      chunkPages([
        { page: 1, text: "a" },
        { page: 1, text: "b" },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      chunkPages([
        { page: 2, text: "" },
        { page: 2, text: "b" },
      ]),
    ).toThrow(/duplicate page number 2/);
  });

  it("throws on invalid page numbers", () => {
    for (const page of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => chunkPages([{ page, text: "x" }])).toThrow(RangeError);
    }
  });

  it("throws when page text is not a string", () => {
    const bad = [{ page: 1, text: 42 as unknown as string }];
    expect(() => chunkPages(bad)).toThrow(TypeError);
  });

  it("throws when maxChars is above 4000, below the minimum, or not an integer", () => {
    expect(() =>
      chunkPages([{ page: 1, text: "x" }], { maxChars: 4001 }),
    ).toThrow(RangeError);
    expect(() => chunkPages([{ page: 1, text: "x" }], { maxChars: 3 })).toThrow(
      RangeError,
    );
    expect(() =>
      chunkPages([{ page: 1, text: "x" }], {
        maxChars: 100.5,
        overlapChars: 0,
      }),
    ).toThrow(RangeError);
  });

  it("accepts maxChars of exactly 4000 and respects it", () => {
    const chunks = chunkAndCheck([{ page: 1, text: sentences(400) }], {
      maxChars: 4000,
      overlapChars: 200,
    });
    expect(chunks.every((c) => c.content.length <= 4000)).toBe(true);
  });

  it("throws when overlapChars is negative, fractional, or not below maxChars", () => {
    const pages = [{ page: 1, text: "x" }];
    expect(() =>
      chunkPages(pages, { maxChars: 100, overlapChars: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      chunkPages(pages, { maxChars: 100, overlapChars: 2.5 }),
    ).toThrow(RangeError);
    expect(() =>
      chunkPages(pages, { maxChars: 100, overlapChars: 100 }),
    ).toThrow(RangeError);
    // The 150 default is too large for a small window; callers must say so.
    expect(() => chunkPages(pages, { maxChars: 100 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------- seeded fuzz

describe("chunkPages invariants on generated text", () => {
  function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateText(random: () => number): string {
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)];
    const parts: string[] = [];
    const target = Math.floor(random() * 6000);
    let length = 0;
    while (length < target) {
      const kind = random();
      let part: string;
      if (kind < 0.45) {
        const n = 1 + Math.floor(random() * 12);
        part = Array.from({ length: n }, () =>
          String.fromCharCode(97 + Math.floor(random() * 26)),
        ).join("");
      } else if (kind < 0.6) {
        part = pick([". ", "! ", "? ", ".", "。", "！", '." ', ") ", "... "]);
      } else if (kind < 0.7) {
        part = pick(["\n", "\n\n", "\r\n", "\n\n\n", "  ", "\t", "\u00a0"]);
      } else if (kind < 0.8) {
        part = pick(["😀", FAMILY, "𠮷", "👍🏽", "\u200d", "\u200c"]);
      } else if (kind < 0.9) {
        part = pick(["你好世界", "这是测试。", "テスト", "한국어"]);
      } else if (kind < 0.95) {
        part = "u".repeat(40 + Math.floor(random() * 400));
      } else {
        part = pick(["\u00ad", "\ufb01", "e\u0301", "\u0000", "\u2028"]);
      }
      parts.push(part, random() < 0.5 ? " " : "");
      length += part.length;
    }
    return parts.join("");
  }

  it("holds for random pages and option sets", () => {
    const random = makeRandom(20261102);
    const sizes = [4, 5, 10, 37, 100, 500, 1200, 4000];
    for (let run = 0; run < 250; run++) {
      const maxChars = sizes[Math.floor(random() * sizes.length)];
      const overlaps = [
        0,
        1,
        Math.floor(maxChars / 4),
        Math.floor(maxChars / 2),
        maxChars - 1,
      ].filter((o) => o < maxChars);
      const overlapChars = overlaps[Math.floor(random() * overlaps.length)];
      const pages: PageInput[] = [
        { page: 1, text: generateText(random) },
        { page: 4, text: generateText(random) },
        { page: 9, text: generateText(random) },
      ];
      const chunks = chunkPages(pages, { maxChars, overlapChars });
      const violation = findViolation(pages, chunks, {
        maxChars,
        overlapChars,
      });
      if (violation !== null) {
        throw new Error(
          `run ${run} maxChars=${maxChars} overlapChars=${overlapChars}: ${violation}`,
        );
      }
    }
  });
});
