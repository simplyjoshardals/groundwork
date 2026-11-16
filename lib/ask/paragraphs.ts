import { segmentAnswer, type AnswerSegment } from "./citations";

/**
 * Splits a streamed answer into paragraphs (blank-line separated) and segments
 * each one into text and citation markers.
 *
 * A marker never spans a blank line, so segmenting per paragraph is safe. Only
 * the last paragraph can still be growing, so only it holds back an unfinished
 * `[` or `[1` while streaming; earlier paragraphs are complete.
 */
export function splitParagraphs(
  text: string,
  sourceCount: number,
  options: { streaming?: boolean } = {},
): AnswerSegment[][] {
  const streaming = options.streaming === true;
  const parts = text.split(/\n{2,}/);
  const paragraphs: AnswerSegment[][] = [];

  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    const segments = segmentAnswer(part.trim(), sourceCount, {
      streaming: streaming && isLast,
    });
    if (segments.length > 0) paragraphs.push(segments);
  });

  return paragraphs;
}

/** What `AnswerText` draws: plain text, or a run of markers kept together. */
export type AnswerNode =
  | { type: "text"; text: string }
  | {
      type: "cites";
      /** The last word before the markers (with its space), so a line never breaks between them. */
      lead: string;
      markers: number[];
      /** Punctuation straight after the markers (".", ",") for the same reason. */
      trail: string;
    };

/** The last word and any space after it: the space is kept inside the group. */
const TRAILING_WORD = /\S+\s*$/;
const LEADING_PUNCTUATION = /^[.,;:!?)\]”’"']+/;

/**
 * Groups adjacent markers with the word before them and the punctuation after
 * them, so a wrapped line never leaves "2." alone on the next line. Text is
 * otherwise unchanged: joined back, the nodes read as the original segments.
 */
export function groupCitations(
  segments: readonly AnswerSegment[],
): AnswerNode[] {
  const items = segments.map((segment) => ({ ...segment }));
  const nodes: AnswerNode[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i];
    if (item.type === "text") {
      nodes.push({ type: "text", text: item.text });
      i += 1;
      continue;
    }

    const markers: number[] = [];
    for (let next = items[i]; next?.type === "citation"; next = items[i]) {
      markers.push(next.marker);
      i += 1;
    }

    // Punctuation right after the run joins it; the rest stays plain text.
    let trail = "";
    const after = items[i];
    if (after?.type === "text") {
      trail = LEADING_PUNCTUATION.exec(after.text)?.[0] ?? "";
      after.text = after.text.slice(trail.length);
      if (after.text === "") i += 1;
    }

    // The word just before the run joins it too.
    let lead = "";
    const before = nodes[nodes.length - 1];
    if (before?.type === "text") {
      lead = TRAILING_WORD.exec(before.text)?.[0] ?? "";
      before.text = before.text.slice(0, before.text.length - lead.length);
      if (before.text === "") nodes.pop();
    }

    nodes.push({ type: "cites", lead, markers, trail });
  }
  return nodes;
}
