/**
 * Citation validation (Task 2.6). The model cites passages as `[n]`, where
 * passage `n` is the source with marker `n` (1-based, see `toStreamSources`).
 * Models sometimes cite a number that was never retrieved, so every marker is
 * checked against the number of sources before the client may trust it. Pure
 * and free of `server-only`: the server fills the `done` event with it and the
 * browser reuses it to strip invalid markers and draw chips (Task 2.7).
 */

/**
 * Only the exact form the prompt asks for counts: `[1]`, `[2][3]`. A number
 * has no leading zeros, except `[0]` itself, which is a marker and always
 * invalid. `[1, 2]`, `[1-3]`, `[a]`, `[01]` and `[1](url)` are ordinary text.
 * An optional single space before the marker is part of the match, so
 * stripping one does not leave a double space.
 */
const MARKER = / ?\[(0|[1-9]\d*)\]/g;

export interface CitationValidation {
  /** Valid markers that appear in the text, each once, in first-appearance order. */
  citations: number[];
  /** Markers outside 1..sourceCount (`[0]`, `[9]`), each once, in first-appearance order. */
  invalidCitations: number[];
  /** The text with invalid markers removed. Valid markers are kept. */
  strippedText: string;
  /** True when the text has no valid marker: an answer that cites nothing. */
  uncited: boolean;
}

/**
 * Finds the `[n]` markers in `text` and checks each against `sourceCount`
 * retrieved passages. With `sourceCount` 0 every marker is invalid.
 */
export function validateCitations(
  text: string,
  sourceCount: number,
): CitationValidation {
  const citations: number[] = [];
  const invalidCitations: number[] = [];

  const strippedText = text.replace(MARKER, (match, digits: string) => {
    const marker = Number(digits); // a huge digit run becomes a large number, so invalid
    if (marker >= 1 && marker <= sourceCount) {
      if (!citations.includes(marker)) citations.push(marker);
      return match;
    }
    if (!invalidCitations.includes(marker)) invalidCitations.push(marker);
    return "";
  });

  return {
    citations,
    invalidCitations,
    strippedText,
    uncited: citations.length === 0,
  };
}

/** A piece of a displayed answer: plain text, or a valid `[n]` citation. */
export type AnswerSegment =
  { type: "text"; text: string } | { type: "citation"; marker: number };

/** A marker that is still arriving at the end of the text: `[` or `[12`. */
const OPEN_MARKER_AT_END = / ?\[\d*$/;

export interface SegmentOptions {
  /**
   * True while tokens are still arriving. An unfinished `[` or `[1` at the very
   * end is then held back, so it does not flash before its `]` arrives.
   */
  streaming?: boolean;
}

/**
 * Turns answer text into what the UI draws: invalid markers removed (as in
 * `validateCitations`), valid ones split out as citation segments. Text
 * segments are never empty, and the segments joined back (with each citation
 * as `[n]`) give `strippedText`.
 */
export function segmentAnswer(
  text: string,
  sourceCount: number,
  options: SegmentOptions = {},
): AnswerSegment[] {
  const visible = options.streaming
    ? text.replace(OPEN_MARKER_AT_END, "")
    : text;
  const { strippedText } = validateCitations(visible, sourceCount);

  const segments: AnswerSegment[] = [];
  let cursor = 0;

  // After validation every remaining match is valid. `matchAll` copies the
  // regex, so the shared `lastIndex` state is never touched.
  for (const match of strippedText.matchAll(MARKER)) {
    const leadingSpace = match[0].startsWith(" ") ? 1 : 0;
    const markerStart = match.index + leadingSpace;
    if (markerStart > cursor) {
      segments.push({
        type: "text",
        text: strippedText.slice(cursor, markerStart),
      });
    }
    segments.push({ type: "citation", marker: Number(match[1]) });
    cursor = match.index + match[0].length;
  }

  if (cursor < strippedText.length) {
    segments.push({ type: "text", text: strippedText.slice(cursor) });
  }
  return segments;
}
