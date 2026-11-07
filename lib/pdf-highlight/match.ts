/**
 * Passage-to-text-layer matching (proven in spike 0.7, used by Task 3.5).
 *
 * Pure functions, no DOM and no React, so they can be unit-tested in Node.
 *
 * Idea: build a "key" for the page's text and for the passage with the SAME
 * folding, then look for the passage key inside the page key. The folding
 * removes everything that differs legitimately between where a chunk came from
 * and what the text layer holds:
 *  - whitespace and line breaks (items are joined with nothing, so table cells
 *    and kerned fragments that PDF.js splits mid-word line up);
 *  - hyphens and dashes of every kind, and soft hyphens (so a word broken as
 *    "hy-" + "phenation" equals "hyphenation");
 *  - ligatures and other compatibility forms (NFKD: the "fi" ligature is "fi");
 *  - combining accents, letter case, curly versus straight quotes.
 * Every key character remembers which text item and which characters of that
 * item it came from, so a match can be turned back into highlight ranges.
 *
 * A match must be UNIQUE. An ambiguous or missing match declines to highlight:
 * a wrong highlight is worse than none (BUILD_PLAN 3.5).
 */

export interface PageTextItem {
  /** Index in the page's text-content items, as react-pdf reports it. */
  itemIndex: number;
  str: string;
}

export interface PageIndex {
  key: string;
  /** Per key character: the text item it came from. */
  itemOf: number[];
  /** Per key character: where its source character starts in that item. */
  startOf: number[];
  /** Per key character: where its source character ends in that item. */
  endOf: number[];
}

export interface ItemRange {
  itemIndex: number;
  /** Start offset in the item's string (inclusive). */
  from: number;
  /** End offset in the item's string (exclusive). */
  to: number;
}

export type MatchResult =
  | {
      status: "found";
      ranges: ItemRange[];
      keyStart: number;
      keyLength: number;
    }
  | { status: "ambiguous"; occurrences: number }
  | { status: "not_found" }
  | { status: "too_short"; keyLength: number };

/** Below this many key characters a match is too likely to hit the wrong place. */
export const MIN_KEY_LENGTH = 12;

/** Inline so it needs no global CSS rule; transparent text keeps the canvas readable. */
export const HIGHLIGHT_STYLE =
  "background:rgba(255,214,0,0.45);color:transparent;border-radius:2px";

// Built from a string so the project's ES2017 compile target does not matter;
// the runtime (Node 22, current browsers) supports property escapes.
const DROPPED = new RegExp(
  "^[\\p{White_Space}\\p{Cf}\\p{M}\\p{Pd}\\u2212]$",
  "u",
);

const QUOTES: Readonly<Record<string, string>> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
};

interface FoldedChar {
  char: string;
  /** Start of the source code point in the original string (UTF-16 offset). */
  start: number;
  /** End of the source code point in the original string. */
  end: number;
}

function* foldChars(text: string): Generator<FoldedChar> {
  let offset = 0;
  for (const codePoint of text) {
    const start = offset;
    offset += codePoint.length;
    const expanded = codePoint.normalize("NFKD").toLowerCase();
    for (const char of expanded) {
      if (DROPPED.test(char)) continue;
      yield { char: QUOTES[char] ?? char, start, end: offset };
    }
  }
}

/** The searchable form of a passage (or of any text). */
export function normalizeToKey(text: string): string {
  let key = "";
  for (const folded of foldChars(text)) key += folded.char;
  return key;
}

/** Builds the searchable key of a whole page from its text items, in order. */
export function buildPageIndex(items: readonly PageTextItem[]): PageIndex {
  const index: PageIndex = { key: "", itemOf: [], startOf: [], endOf: [] };
  for (const item of items) {
    for (const folded of foldChars(item.str)) {
      index.key += folded.char;
      index.itemOf.push(item.itemIndex);
      index.startOf.push(folded.start);
      index.endOf.push(folded.end);
    }
  }
  return index;
}

/** Finds the passage in the page. Only a single, unambiguous match is a match. */
export function findPassage(index: PageIndex, passage: string): MatchResult {
  const needle = normalizeToKey(passage);
  if (needle.length < MIN_KEY_LENGTH) {
    return { status: "too_short", keyLength: needle.length };
  }

  const first = index.key.indexOf(needle);
  if (first === -1) return { status: "not_found" };

  let occurrences = 1;
  let next = index.key.indexOf(needle, first + 1);
  while (next !== -1) {
    occurrences++;
    next = index.key.indexOf(needle, next + 1);
  }
  if (occurrences > 1) return { status: "ambiguous", occurrences };

  const ranges: ItemRange[] = [];
  for (let k = first; k < first + needle.length; k++) {
    const itemIndex = index.itemOf[k];
    const last = ranges[ranges.length - 1];
    if (last && last.itemIndex === itemIndex) {
      last.to = Math.max(last.to, index.endOf[k]);
    } else {
      ranges.push({
        itemIndex,
        from: index.startOf[k],
        to: index.endOf[k],
      });
    }
  }
  return { status: "found", ranges, keyStart: first, keyLength: needle.length };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The HTML for one text item. react-pdf puts this string into the DOM with
 * innerHTML (after its own sanitizing), so the text must be escaped here: a
 * "<" in a PDF must stay text. `data-hl` lets the page find the highlights.
 */
export function renderItemHtml(str: string, range: ItemRange | null): string {
  if (!range) return escapeHtml(str);
  const from = Math.max(0, Math.min(range.from, str.length));
  const to = Math.max(from, Math.min(range.to, str.length));
  return (
    escapeHtml(str.slice(0, from)) +
    `<mark data-hl="1" style="${HIGHLIGHT_STYLE}">${escapeHtml(str.slice(from, to))}</mark>` +
    escapeHtml(str.slice(to))
  );
}
