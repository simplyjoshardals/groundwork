import { expect, type Page } from "@playwright/test";

/** No horizontal scroll at the current viewport (DESIGN 4.2, 9). */
export async function expectNoHorizontalScroll(
  page: Page,
  label: string,
): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { scroll: root.scrollWidth, client: root.clientWidth };
  });
  expect(
    overflow.scroll,
    `${label}: page is ${overflow.scroll}px wide in a ${overflow.client}px viewport`,
  ).toBeLessThanOrEqual(overflow.client);
}

export interface SmallTarget {
  element: string;
  width: number;
  height: number;
}

/**
 * Interactive elements smaller than `min` px on either side, as measured on
 * screen. Exempt, and why:
 * - citation markers: their hit area is a pseudo-element that a bounding box
 *   cannot see (DESIGN 5.5 documents about 36 x 44 px);
 * - links inside running text: inline targets are exempt, and DESIGN 5.1
 *   keeps the `link` variant for inline text only;
 * - anything `aria-hidden` (the shelf strip) or inert;
 * - the visually hidden file input: its label is the target.
 */
export async function findSmallTargets(
  page: Page,
  min = 44,
): Promise<SmallTarget[]> {
  return page.evaluate((minSize) => {
    const selector =
      'a[href], button, input:not([type="hidden"]):not([type="file"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"]';
    const small: { element: string; width: number; height: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.closest("[inert], [aria-hidden='true']")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const label = el.getAttribute("aria-label") ?? "";
      if (/^Source \d+:/.test(label)) continue;
      if (el.tagName === "A" && el.closest("p, li")) {
        const own = (el.textContent ?? "").trim().length;
        const around = (el.parentElement?.textContent ?? "").trim().length;
        if (around > own) continue;
      }
      if (Math.min(rect.width, rect.height) < minSize - 0.5) {
        small.push({
          element: `${el.tagName.toLowerCase()} "${(label || el.textContent || "").trim().slice(0, 40)}"`,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    }
    return small;
  }, min);
}
