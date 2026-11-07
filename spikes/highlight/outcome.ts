/**
 * Decides whether a highlight really worked, from what the browser rendered.
 *
 * Finding the passage in extracted text is NOT a success. A highlight counts
 * only when the page's rendered text layer holds highlight elements, they are
 * visible on the page, and the text they cover is the passage.
 *
 * A wrong highlight is reported separately from no highlight, because showing
 * the wrong place is worse than showing nothing (BUILD_PLAN 3.5).
 */
import { normalizeToKey } from "@/lib/pdf-highlight/match";

export type Outcome = "CORRECT" | "WRONG" | "NONE";

export interface DomObservation {
  /** Highlight elements found in the rendered text layer. */
  markCount: number;
  /** Of those, how many are visible: non-zero size, inside the page, filled. */
  visibleMarks: number;
  /** The text inside the highlight elements, in document order. */
  markedText: string;
}

export interface Verdict {
  outcome: Outcome;
  reason: string;
}

export function classifyOutcome(
  passage: string,
  observation: DomObservation,
): Verdict {
  if (observation.markCount === 0) {
    return {
      outcome: "NONE",
      reason: "no highlight in the rendered text layer",
    };
  }
  if (normalizeToKey(observation.markedText) !== normalizeToKey(passage)) {
    return {
      outcome: "WRONG",
      reason: "the highlighted text is not the passage",
    };
  }
  if (observation.visibleMarks !== observation.markCount) {
    return {
      outcome: "WRONG",
      reason: "some highlights are not visible on the page",
    };
  }
  return { outcome: "CORRECT", reason: "visible highlight covers the passage" };
}
