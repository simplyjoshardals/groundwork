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
