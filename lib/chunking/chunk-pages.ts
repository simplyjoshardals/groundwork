import { normalizePageText } from "./normalize";

/** One page of extracted text. `page` is the 1-based page number to cite. */
export interface PageInput {
  page: number;
  text: string;
}

/**
 * One retrievable passage. Offsets are UTF-16 code units (what JavaScript's
 * `slice()` uses) into the NORMALIZED text of the page, not the raw text:
 * `content === normalizePageText(page.text).slice(charStart, charEnd)`.
 */
export interface Chunk {
  /** Zero-based and contiguous across the whole document. */
  chunkIndex: number;
  pageNumber: number;
  /** Inclusive. */
  charStart: number;
  /** Exclusive. */
  charEnd: number;
  content: string;
}

export interface ChunkOptions {
  /** Maximum chunk length in UTF-16 code units. Default 1200. */
  maxChars?: number;
  /**
   * Maximum overlap with the previous chunk, in UTF-16 code units. Default
   * 150. The actual overlap snaps to a paragraph, sentence or word start and
   * is usually a little smaller; read it from the offsets.
   */
  overlapChars?: number;
}

/** Provisional starting defaults, not empirically validated retrieval settings. */
export const DEFAULT_MAX_CHARS = 1200;
export const DEFAULT_OVERLAP_CHARS = 150;
/** `chunks.content` is limited to 4000 characters (DATA_MODEL.md). */
export const MAX_CHUNK_CHARS = 4000;
/**
 * Smallest window that always lets us make progress without splitting a
 * surrogate pair (an astral character takes 2 code units).
 */
export const MIN_CHUNK_CHARS = 4;

export interface Span {
  start: number;
  end: number;
}

const WHITESPACE = /\s/;
const TERMINATORS = ".!?。！？";
// Closing quotes and brackets that stay attached to the sentence they close.
const CLOSERS = "\"'”’)]»」』）";

function isWs(text: string, index: number): boolean {
  return WHITESPACE.test(text[index]);
}

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLow(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** True when `index` sits between the two halves of a surrogate pair. */
function splitsSurrogatePair(text: string, index: number): boolean {
  return (
    index > 0 &&
    index < text.length &&
    isHigh(text.charCodeAt(index - 1)) &&
    isLow(text.charCodeAt(index))
  );
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x3040 && code <= 0x30ff) || // kana
    (code >= 0x3400 && code <= 0x4dbf) || // CJK extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
    (code >= 0xac00 && code <= 0xd7af) || // hangul syllables
    (code >= 0xf900 && code <= 0xfaff) // CJK compatibility ideographs
  );
}

/**
 * True when a sentence ends at `end` (exclusive): the characters before `end`
 * are a terminator plus optional closing quotes/brackets, and the sentence is
 * followed by whitespace or the end of the text. CJK text has no spaces, so
 * "。" (and "!", "?", "." right after a CJK character) also end a sentence
 * without trailing whitespace. NFKC turns the fullwidth "！" and "？" into
 * ASCII, which is why that second rule exists.
 */
function isSentenceEnd(text: string, end: number): boolean {
  let i = end - 1;
  while (i >= 0 && CLOSERS.includes(text[i])) i--;
  if (i < 0 || !TERMINATORS.includes(text[i])) return false;
  if (end >= text.length || isWs(text, end)) return true;
  if (CLOSERS.includes(text[end])) return false; // the closer belongs to this sentence
  if (text[i] === "。" || text[i] === "！" || text[i] === "？") return true;
  return i > 0 && isCjk(text.charCodeAt(i - 1));
}

function isParagraphEnd(text: string, end: number): boolean {
  return (
    end + 1 < text.length &&
    text[end] === "\n" &&
    text[end + 1] === "\n" &&
    !isWs(text, end - 1)
  );
}

/** First non-whitespace character of a paragraph (preceded by a blank line). */
function isParagraphStart(text: string, index: number): boolean {
  if (isWs(text, index)) return false;
  let newlines = 0;
  for (let q = index - 1; q >= 0 && isWs(text, q); q--) {
    if (text[q] === "\n") newlines++;
  }
  return newlines >= 2;
}

function isSentenceStart(text: string, index: number): boolean {
  if (isWs(text, index)) return false;
  let q = index;
  while (q > 0 && isWs(text, q - 1)) q--;
  return q > 0 && isSentenceEnd(text, q);
}

function isWordStart(text: string, index: number): boolean {
  return index > 0 && isWs(text, index - 1) && !isWs(text, index);
}

function skipWhitespace(text: string, index: number): number {
  let i = index;
  while (i < text.length && isWs(text, i)) i++;
  return i;
}

interface EndChoice {
  end: number;
  hardCut: boolean;
}

/**
 * Picks where a chunk ends, searching (lowerExclusive, hardEnd] from the
 * right so the chunk is as full as the best available boundary allows.
 * Preference: paragraph end, then sentence end, then line break, then
 * whitespace, then a hard cut that never splits a surrogate pair. Every
 * candidate leaves the chunk without trailing whitespace.
 */
function chooseEnd(
  text: string,
  lowerExclusive: number,
  hardEnd: number,
): EndChoice {
  let sentence = -1;
  let line = -1;
  let space = -1;
  for (let e = hardEnd; e > lowerExclusive; e--) {
    if (isParagraphEnd(text, e)) return { end: e, hardCut: false };
    if (sentence === -1 && isSentenceEnd(text, e)) sentence = e;
    if (e < text.length && !isWs(text, e - 1)) {
      if (line === -1 && text[e] === "\n") line = e;
      if (space === -1 && text[e] === " ") space = e;
    }
  }
  if (sentence !== -1) return { end: sentence, hardCut: false };
  if (line !== -1) return { end: line, hardCut: false };
  if (space !== -1) return { end: space, hardCut: false };
  // MIN_CHUNK_CHARS guarantees hardEnd - 1 is still past lowerExclusive.
  const end = splitsSurrogatePair(text, hardEnd) ? hardEnd - 1 : hardEnd;
  return { end, hardCut: true };
}

/**
 * Picks where the next chunk starts. It may overlap the chunk that just
 * ended by at most `overlapChars` (and by at most half of that chunk, so the
 * next start always moves forward). Within that range it takes the earliest
 * paragraph start, else sentence start, else word start. If none exists it
 * hard-cuts only when the previous chunk was itself hard-cut (an unbroken
 * token); otherwise it starts the next chunk with no overlap.
 */
function chooseNextStart(
  text: string,
  start: number,
  end: number,
  overlapChars: number,
  endWasHardCut: boolean,
): number {
  const room = Math.min(overlapChars, Math.floor((end - start) / 2));
  if (room === 0) return skipWhitespace(text, end);
  const lower = end - room;
  let sentence = -1;
  let word = -1;
  for (let p = lower; p < end; p++) {
    if (isParagraphStart(text, p)) return p;
    if (sentence === -1 && isSentenceStart(text, p)) sentence = p;
    if (word === -1 && isWordStart(text, p)) word = p;
  }
  if (sentence !== -1) return sentence;
  if (word !== -1) return word;
  if (!endWasHardCut) return skipWhitespace(text, end);
  const p = splitsSurrogatePair(text, lower) ? lower + 1 : lower;
  return skipWhitespace(text, p);
}

/**
 * Splits already-normalized text into spans of at most `maxChars`.
 * Exported for `paginate-text.ts`; not part of the public API (see index.ts).
 *
 * Trailing pieces: if everything left fits in `maxChars` measured from the
 * current chunk's start, the chunk simply takes all of it, so a short final
 * paragraph is absorbed whenever that fits the limit. When it does not fit,
 * the short piece becomes its own chunk (preceded by the usual overlap); it is
 * never dropped and no chunk ever exceeds `maxChars`.
 */
export function splitIntoSpans(
  text: string,
  maxChars: number,
  overlapChars: number,
): Span[] {
  const spans: Span[] = [];
  let length = text.length;
  while (length > 0 && isWs(text, length - 1)) length--;
  let start = skipWhitespace(text, 0);
  let previousEnd = start;
  while (start < length) {
    let end: number;
    let hardCut = false;
    if (length - start <= maxChars) {
      end = length;
    } else {
      const choice = chooseEnd(
        text,
        Math.max(start, previousEnd),
        start + maxChars,
      );
      end = choice.end;
      hardCut = choice.hardCut;
      if (isWs(text, end - 1)) {
        // Overlap pulled the window back so far that everything new in it is
        // whitespace, and a chunk must not end in whitespace. Restart this
        // chunk after the previous one with no overlap.
        start = skipWhitespace(text, previousEnd);
        continue;
      }
    }
    spans.push({ start, end });
    if (end >= length) break;
    start = chooseNextStart(text, start, end, overlapChars, hardCut);
    previousEnd = end;
  }
  return spans;
}

function resolveOptions(options: ChunkOptions): {
  maxChars: number;
  overlapChars: number;
} {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  if (
    !Number.isInteger(maxChars) ||
    maxChars < MIN_CHUNK_CHARS ||
    maxChars > MAX_CHUNK_CHARS
  ) {
    throw new RangeError(
      `maxChars must be an integer from ${MIN_CHUNK_CHARS} to ${MAX_CHUNK_CHARS}, got ${maxChars}`,
    );
  }
  if (
    !Number.isInteger(overlapChars) ||
    overlapChars < 0 ||
    overlapChars >= maxChars
  ) {
    throw new RangeError(
      `overlapChars must be an integer from 0 to maxChars - 1 (${maxChars - 1}), got ${overlapChars}`,
    );
  }
  return { maxChars, overlapChars };
}

function validatePages(pages: readonly PageInput[]): void {
  const seen = new Set<number>();
  for (const page of pages) {
    if (!Number.isInteger(page.page) || page.page < 1) {
      throw new RangeError(
        `page numbers must be integers >= 1, got ${String(page.page)}`,
      );
    }
    if (seen.has(page.page)) {
      throw new RangeError(`duplicate page number ${page.page}`);
    }
    seen.add(page.page);
    if (typeof page.text !== "string") {
      throw new TypeError(`page ${page.page} text must be a string`);
    }
  }
}

/**
 * Splits pages into page-bounded, paragraph-aware chunks.
 *
 * - Each page is normalized first (`normalizePageText`); offsets and content
 *   refer to that normalized text.
 * - Chunks never cross a page and nothing overlaps across pages.
 * - Pages keep input order; empty or whitespace-only pages are skipped, and
 *   `chunkIndex` stays contiguous across skipped pages.
 * - The 30-page limit is not enforced here; extraction/ingestion owns it.
 *
 * Throws `RangeError` for invalid options or duplicate/invalid page numbers.
 */
export function chunkPages(
  pages: readonly PageInput[],
  options: ChunkOptions = {},
): Chunk[] {
  const { maxChars, overlapChars } = resolveOptions(options);
  validatePages(pages);
  const chunks: Chunk[] = [];
  let chunkIndex = 0;
  for (const page of pages) {
    const text = normalizePageText(page.text);
    if (text.length === 0) continue;
    for (const span of splitIntoSpans(text, maxChars, overlapChars)) {
      chunks.push({
        chunkIndex: chunkIndex++,
        pageNumber: page.page,
        charStart: span.start,
        charEnd: span.end,
        content: text.slice(span.start, span.end),
      });
    }
  }
  return chunks;
}
