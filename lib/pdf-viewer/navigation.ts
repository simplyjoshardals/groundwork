/**
 * Pure page-navigation helpers for the PDF viewer (Task 3.2). No React and no
 * PDF.js here, so they run under the node-only Vitest setup.
 */

export type NavigationAction = "previous" | "next" | "first" | "last";

/**
 * Clamps a 1-based page number to `1..numPages`. A fractional page is
 * truncated and a non-finite page becomes 1. Pass
 * `Number.POSITIVE_INFINITY` as `numPages` while the page count is unknown:
 * only the lower bound is applied then.
 */
export function clampPage(page: number, numPages: number): number {
  const whole = Number.isFinite(page) ? Math.trunc(page) : 1;
  const last = Number.isFinite(numPages)
    ? Math.max(1, Math.trunc(numPages))
    : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(whole, 1), last);
}

/** The page an action leads to. `numPages` must be a known, finite count. */
export function pageForAction(
  action: NavigationAction,
  current: number,
  numPages: number,
): number {
  switch (action) {
    case "previous":
      return clampPage(current - 1, numPages);
    case "next":
      return clampPage(current + 1, numPages);
    case "first":
      return 1;
    case "last":
      return clampPage(numPages, numPages);
  }
}

/** The parts of a keyboard event this module reads (React's event fits). */
export interface KeyLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Maps a key press to a navigation action. Any modifier means "not ours", so
 * browser shortcuts (Alt+Left is Back) keep working.
 */
export function keyToNavigation(event: KeyLike): NavigationAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }
  switch (event.key) {
    case "ArrowLeft":
      return "previous";
    case "ArrowRight":
      return "next";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}
