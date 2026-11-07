import type { HighlightStatus } from "./plan";

export interface HighlightNote {
  text: string;
  /** `alert` for failures, `status` for everything else. */
  tone: "info" | "error";
  /** Whether a Retry makes sense (a load failure, not a decline). */
  retryable: boolean;
}

/**
 * The line shown under the viewer for a highlight status, or `null` when there
 * is nothing to say. A decline is explained, never silent; the wording avoids
 * anything from the document or the error, so nothing sensitive reaches the UI.
 */
export function describeHighlightStatus(
  status: HighlightStatus,
): HighlightNote | null {
  switch (status.state) {
    case "none":
      return null;
    case "loading":
      return { text: "Finding the cited passage…", tone: "info", retryable: false };
    case "highlighted":
      return { text: "The cited passage is highlighted.", tone: "info", retryable: false };
    case "unavailable":
      return {
        text: "The cited passage could not be found, or your session cannot open it.",
        tone: "error",
        retryable: false,
      };
    case "error":
      return {
        text: "The cited passage could not be loaded.",
        tone: "error",
        retryable: true,
      };
    case "declined":
      switch (status.reason) {
        case "other_document":
          return {
            text: "This link's passage belongs to a different document, so nothing is highlighted.",
            tone: "info",
            retryable: false,
          };
        case "other_page":
          return {
            text:
              status.pageNumber === null
                ? "The cited passage is on a different page."
                : `The cited passage is on page ${status.pageNumber}.`,
            tone: "info",
            retryable: false,
          };
        default:
          return {
            text: "The cited passage could not be pinpointed on this page, so nothing is highlighted.",
            tone: "info",
            retryable: false,
          };
      }
  }
}
