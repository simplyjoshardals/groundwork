/**
 * Scrolls the cited passage into view inside the viewer's own scroll region
 * (DESIGN 6.6), never the window: the ask column must not move when a citation
 * opens. The region is marked `data-viewer-scroll`; a sticky page toolbar
 * inside it is marked `data-viewer-toolbar` and counts as covered space.
 */

/** Never settle with the passage hard against an edge. */
const EDGE_PADDING = 12;
/** `scrollend` is missing in older Safari; this ends the wait there. */
export const SCROLL_SETTLE_FALLBACK_MS = 700;

export interface ScrollGeometry {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  /** Viewport-relative tops, as `getBoundingClientRect` reports them. */
  containerTop: number;
  targetTop: number;
  targetHeight: number;
  /** Height of what covers the top of the region (the sticky toolbar). */
  topInset: number;
}

/**
 * The `scrollTop` that centres the passage in the visible part of the region,
 * or lines its top up near the top edge when it is taller than that part.
 * Clamped to what the region can actually scroll.
 */
export function computeScrollTop(geometry: ScrollGeometry): number {
  const visibleHeight = Math.max(0, geometry.clientHeight - geometry.topInset);
  const spare = Math.max(
    EDGE_PADDING,
    (visibleHeight - geometry.targetHeight) / 2,
  );
  const desired =
    geometry.scrollTop +
    (geometry.targetTop - (geometry.containerTop + geometry.topInset)) -
    spare;
  const max = Math.max(0, geometry.scrollHeight - geometry.clientHeight);
  return Math.min(max, Math.max(0, Math.round(desired)));
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function findScrollRegion(from: Element | null): HTMLElement | null {
  return from?.closest<HTMLElement>("[data-viewer-scroll]") ?? null;
}

/** Back to the top of the page area, for a page turn. Instant on purpose. */
export function scrollViewerToTop(from: Element | null): void {
  findScrollRegion(from)?.scrollTo({ top: 0, behavior: "auto" });
}

/**
 * Brings the highlight pieces into view and resolves once the region has
 * settled, so the wipe can start on a page that is standing still. Resolves
 * at the next frame when nothing needs to scroll, and under reduced motion
 * (which jumps instead of gliding).
 */
export function scrollToPassage(
  targets: readonly HTMLElement[],
): Promise<void> {
  const first = targets[0];
  const container = findScrollRegion(first ?? null);
  if (first === undefined || container === null) return nextFrame();

  const toolbar = container.querySelector<HTMLElement>(
    "[data-viewer-toolbar]",
  );
  const rects = targets.map((target) => target.getBoundingClientRect());
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const destination = computeScrollTop({
    scrollTop: container.scrollTop,
    clientHeight: container.clientHeight,
    scrollHeight: container.scrollHeight,
    containerTop: container.getBoundingClientRect().top,
    targetTop: top,
    targetHeight: bottom - top,
    topInset: toolbar?.offsetHeight ?? 0,
  });

  if (Math.abs(destination - container.scrollTop) < 2) return nextFrame();
  if (prefersReducedMotion()) {
    container.scrollTo({ top: destination, behavior: "auto" });
    return nextFrame();
  }

  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      container.removeEventListener("scrollend", finish);
      clearTimeout(timer);
      resolve();
    };
    container.addEventListener("scrollend", finish, { once: true });
    const timer = setTimeout(finish, SCROLL_SETTLE_FALLBACK_MS);
    container.scrollTo({ top: destination, behavior: "smooth" });
  });
}
