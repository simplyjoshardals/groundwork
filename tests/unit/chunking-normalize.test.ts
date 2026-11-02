import { describe, expect, it } from "vitest";
import { PIPELINE_VERSION, normalizePageText } from "@/lib/chunking/normalize";

const FAMILY = "👨‍👩‍👧‍👦"; // man ZWJ woman ZWJ girl ZWJ boy

describe("PIPELINE_VERSION", () => {
  it("is 1 (documents.pipeline_version default)", () => {
    expect(PIPELINE_VERSION).toBe(1);
  });
});

describe("normalizePageText whitespace rules", () => {
  it("converts CRLF and lone CR to LF", () => {
    expect(normalizePageText("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("converts tabs and NBSP to ordinary spaces", () => {
    expect(normalizePageText("a\tb\u00a0c")).toBe("a b c");
  });

  it("collapses runs of spaces", () => {
    expect(normalizePageText("a     b \t \u00a0 c")).toBe("a b c");
  });

  it("strips trailing spaces from each line", () => {
    expect(normalizePageText("one   \ntwo \t\nthree")).toBe("one\ntwo\nthree");
  });

  it("collapses 3 or more newlines to exactly 2 and keeps 1 and 2", () => {
    expect(normalizePageText("a\n\n\n\nb\n\nc\nd")).toBe("a\n\nb\n\nc\nd");
  });

  it("treats whitespace-only lines as empty when collapsing newlines", () => {
    expect(normalizePageText("a\n  \n \t \nb")).toBe("a\n\nb");
  });

  it("trims the page", () => {
    expect(normalizePageText("  \n\n  hello  \n\n ")).toBe("hello");
  });

  it("returns an empty string for empty and whitespace-only input", () => {
    expect(normalizePageText("")).toBe("");
    expect(normalizePageText(" \n\t\u00a0\r\n ")).toBe("");
  });

  it("maps form feed and Unicode line separators to newlines", () => {
    expect(normalizePageText("a\fb\u2028c\u2029d\u0085e")).toBe(
      "a\nb\nc\nd\ne",
    );
  });
});

describe("normalizePageText Unicode rules", () => {
  it("applies NFKC: ligatures and compatibility forms", () => {
    expect(normalizePageText("o\ufb03ce \ufb01le")).toBe("office file");
  });

  it("composes combining characters (NFKC)", () => {
    expect(normalizePageText("cafe\u0301")).toBe("caf\u00e9");
  });

  it("removes soft hyphens", () => {
    expect(normalizePageText("co\u00adop\u00aderate")).toBe("cooperate");
  });

  it("removes zero width space, word joiner, BOM and bidi marks", () => {
    expect(
      normalizePageText("\ufeffa\u200bb\u2060c\u200ed\u200fe\u202af\u2066g"),
    ).toBe("abcdefg");
  });

  it("removes control characters, including NUL (not storable in Postgres)", () => {
    expect(normalizePageText("a\u0000b\u0007c\u007fd\u0090e")).toBe("abcde");
  });

  it("preserves U+200D (ZWJ) and U+200C (ZWNJ)", () => {
    const text = "a\u200db\u200cc";
    expect(normalizePageText(text)).toBe(text);
  });

  it("preserves the Persian half-space (ZWNJ) in real words", () => {
    const word = "می\u200cخواهم";
    expect(normalizePageText(`${word} ${word}`)).toBe(`${word} ${word}`);
  });

  it("preserves family emoji sequences intact", () => {
    const text = `Family ${FAMILY} here`;
    const out = normalizePageText(text);
    expect(out).toBe(text);
    expect(out).toContain("\u200d");
    expect([...FAMILY].filter((c) => c === "\u200d")).toHaveLength(3);
  });

  it("preserves variation selectors (emoji presentation)", () => {
    expect(normalizePageText("\u2764\ufe0f")).toBe("\u2764\ufe0f");
  });

  it("replaces unpaired surrogates with U+FFFD and keeps valid pairs", () => {
    expect(normalizePageText("a\ud800b\udc00c😀d")).toBe("a\ufffdb\ufffdc😀d");
  });

  it("keeps CJK text; NFKC maps fullwidth ASCII punctuation but not 。", () => {
    // U+FF0C (fullwidth comma) and U+FF01 (fullwidth !) become ASCII under
    // NFKC; U+3002 (ideographic full stop) is left alone.
    expect(normalizePageText("你好，世界。\r\n再见！")).toBe(
      "你好,世界。\n再见!",
    );
  });
});

describe("normalizePageText idempotence", () => {
  const samples = [
    "",
    "plain text",
    "  \r\n\r\n\r\n a \u00a0\t b  \n\n\n\n c \r",
    "co\u00ad\u0301nfig e\u00ad\u0301 e\u0301\u00ad\u0301",
    "\u200b\u0301a \u200b \u0301",
    `x ${FAMILY}\u200d y \u200c z`,
    "o\ufb03ce \ufb01le \u2460 \u00bd \u2122 \u2026 \u3000x\u3000",
    "\ud800\udc00 \ud800 \udc00 a\ud83d",
    "\u1100\u1161\u11a8 \uac00\u11a8",
    "line \u2028 sep \u2029 para \u0085 nel \u000b vt \f ff",
    "\ufdfa \u3392 \ufb2c",
  ];

  it("returns the same string when applied twice (curated samples)", () => {
    for (const sample of samples) {
      const once = normalizePageText(sample);
      expect(normalizePageText(once)).toBe(once);
    }
  });

  it("returns the same string when applied twice (seeded random mixes)", () => {
    const alphabet = [
      "a",
      "e",
      "q",
      " ",
      " ",
      "\n",
      "\n",
      "\r",
      "\t",
      "\u00a0",
      "\u00ad",
      "\u200b",
      "\u200c",
      "\u200d",
      "\u0301",
      "\u0323",
      "\ufb01",
      "\u2028",
      "\ud83d",
      "\ude00",
      "😀",
      "你",
      "。",
      "\u1100",
      "\u1161",
      "\u11a8",
      "\ufe0f",
      "\ufeff",
      "\u0000",
    ];
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 4000; i++) {
      const length = 1 + Math.floor(next() * 14);
      let s = "";
      for (let j = 0; j < length; j++) {
        s += alphabet[Math.floor(next() * alphabet.length)];
      }
      const once = normalizePageText(s);
      expect(normalizePageText(once), JSON.stringify(s)).toBe(once);
    }
  });
});
