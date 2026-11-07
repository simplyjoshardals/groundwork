/**
 * Decides what the viewer highlights (Task 3.5). Pure functions, no React and
 * no DOM, so they run under the node-only Vitest setup.
 *
 * Rule: a wrong highlight is worse than none (BUILD_PLAN 3.5). Every doubt
 * ends in a decline with a reason, never in a guess:
 *  - the chunk belongs to another document or to a page that is not shown;
 *  - the matcher finds no passage, several, or too little text to be sure;
 *  - after rendering, the text inside the highlight is not the passage.
 */
import {
  buildPageIndex,
  findPassage,
  normalizeToKey,
  renderItemHtml,
  type ItemRange,
  type PageTextItem,
} from "./match";

export type DeclineReason =
  | "other_document"
  | "other_page"
  | "too_short"
  | "ambiguous"
  | "not_found"
  | "render_mismatch";

/**
 * What the viewer reports to the panel. `unavailable` and `error` are about
 * loading the cited chunk (missing or not readable, versus a failure worth a
 * retry); the others are about drawing the highlight.
 */
export type HighlightStatus =
  /** The link names no chunk: just a document at a page. */
  | { state: "none" }
  | { state: "loading" }
  | { state: "highlighted" }
  | { state: "declined"; reason: DeclineReason; pageNumber: number | null }
  | { state: "unavailable" }
  | { state: "error" };

export type HighlightPlan =
  | { status: "highlight"; ranges: ReadonlyMap<number, ItemRange> }
  | { status: "declined"; reason: "too_short" | "ambiguous" | "not_found" };

/**
 * The text items of a page, with the index react-pdf reports to
 * `customTextRenderer`. That index counts every entry of `textContent.items`,
 * including marked-content entries that have no `str`, so it is taken before
 * filtering.
 */
export function toPageTextItems(
  items: ReadonlyArray<object>,
): PageTextItem[] {
  const result: PageTextItem[] = [];
  items.forEach((item, itemIndex) => {
    if ("str" in item && typeof item.str === "string") {
      result.push({ itemIndex, str: item.str });
    }
  });
  return result;
}

/** Finds the passage in the page's text items; only a unique match highlights. */
export function planHighlight(
  items: readonly PageTextItem[],
  passageText: string,
): HighlightPlan {
  const match = findPassage(buildPageIndex(items), passageText);
  if (match.status !== "found") {
    return { status: "declined", reason: match.status };
  }
  const ranges = new Map<number, ItemRange>();
  for (const range of match.ranges) ranges.set(range.itemIndex, range);
  return { status: "highlight", ranges };
}

/** The HTML for one text item: its matched slice in a `<mark>`, escaped. */
export function renderPlannedItem(
  ranges: ReadonlyMap<number, ItemRange>,
  item: { str: string; itemIndex: number },
): string {
  return renderItemHtml(item.str, ranges.get(item.itemIndex) ?? null);
}

/**
 * The check after rendering, against what the browser really drew: there must
 * be highlight elements, and the text they cover must be the passage. This
 * catches an item index that no longer lines up with the text layer.
 */
export function marksMatchPassage(
  passageText: string,
  markedTexts: readonly string[],
): boolean {
  if (markedTexts.length === 0) return false;
  return normalizeToKey(markedTexts.join("")) === normalizeToKey(passageText);
}
