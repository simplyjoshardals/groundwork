/**
 * Citation validation (Task 2.6). The model cites passages as `[n]`, where
 * passage `n` is the source with marker `n` (1-based, see `toStreamSources`).
 * Models sometimes cite a number that was never retrieved, so every marker is
 * checked against the number of sources before the client may trust it. Pure
 * and free of `server-only`: the server fills the `done` event with it and the
 * browser can reuse `validateCitations` to strip invalid markers (Task 2.7).
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
