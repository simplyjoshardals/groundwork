/**
 * Timing of the highlight wipe (DESIGN 7). Pure, so it runs under the
 * node-only Vitest setup. The CSS owns the animation itself (`--dur-highlight`);
 * these numbers only decide when to start it and when it is certainly over.
 */

export const WIPE_MS = 600;
/** A passage that wraps over several lines wipes one line after another. */
export const STAGGER_STEP_MS = 80;
export const STAGGER_CAP_MS = 400;
/** After this the wipe has surely finished, so a re-render never replays it. */
export const WIPE_DONE_AFTER_MS = WIPE_MS + STAGGER_CAP_MS + 200;
/** If the scroll never reports back, start the wipe anyway: never hide a highlight. */
export const WIPE_SAFETY_MS = 2500;

/** Start delay for each of `count` highlight pieces, in reading order. */
export function staggerDelays(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const step = Math.min(STAGGER_STEP_MS, STAGGER_CAP_MS / (count - 1));
  return Array.from({ length: count }, (_, index) => Math.round(index * step));
}
