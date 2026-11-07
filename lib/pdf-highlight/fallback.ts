/**
 * Decides when the viewer shows the cited passage as text instead of a
 * highlight (Task 3.6). Pure, no React and no DOM, so it runs under the
 * node-only Vitest setup.
 *
 * The panel is the mandatory fallback for the cases where the matcher could
 * not pinpoint the passage on the page it was cut from (BUILD_PLAN 3.5/3.6).
 * It is deliberately NOT shown when:
 *  - the passage is on another page (nothing failed; the note names the page);
 *  - the passage belongs to another document (it would be mislabelled);
 *  - the chunk could not be loaded (there is no text to show);
 *  - a highlight is drawn or still being worked out.
 */
import type { DeclineReason, HighlightStatus } from "./plan";

/** The declines where the passage is on the shown page but not pinpointed. */
const FALLBACK_REASONS: ReadonlySet<DeclineReason> = new Set([
  "too_short",
  "ambiguous",
  "not_found",
  "render_mismatch",
]);

/** The cited passage as the panel needs it. */
export interface FallbackPassage {
  /** 1-based page the passage was cut from (the page on screen). */
  pageNumber: number;
  /** The chunk's text, exactly as stored. Shown as plain text, never as HTML. */
  text: string;
}

/**
 * The passage to show in the fallback panel, or `null` for no panel. `passage`
 * must already be checked to belong to the document on screen (the caller
 * passes `null` otherwise).
 */
export function selectFallbackPassage(
  status: HighlightStatus,
  passage: { pageNumber: number; text: string } | null,
): FallbackPassage | null {
  if (passage === null) return null;
  if (status.state !== "declined") return null;
  if (!FALLBACK_REASONS.has(status.reason)) return null;
  // Never show an empty box: say nothing rather than an empty "passage".
  if (passage.text.trim() === "") return null;
  return { pageNumber: passage.pageNumber, text: passage.text };
}
