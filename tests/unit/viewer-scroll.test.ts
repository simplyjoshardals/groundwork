import { describe, expect, it } from "vitest";
import { computeScrollTop, type ScrollGeometry } from "@/lib/viewer/scroll-to-passage";
import {
  STAGGER_CAP_MS,
  STAGGER_STEP_MS,
  staggerDelays,
} from "@/lib/viewer/wipe";

const base: ScrollGeometry = {
  scrollTop: 0,
  clientHeight: 600,
  scrollHeight: 2000,
  containerTop: 100,
  targetTop: 900,
  targetHeight: 40,
  topInset: 0,
};

describe("computeScrollTop", () => {
  it("centres a passage that fits", () => {
    // 800 below the region top, minus half the spare room (280).
    expect(computeScrollTop(base)).toBe(520);
  });

  it("counts the sticky toolbar as covered space", () => {
    // Visible height 552, spare 256, target starts 800 - 48 below the visible top.
    expect(computeScrollTop({ ...base, topInset: 48 })).toBe(496);
  });

  it("lines up the top of a passage taller than the region, with a margin", () => {
    expect(computeScrollTop({ ...base, targetHeight: 900 })).toBe(788);
  });

  it("never scrolls past either end", () => {
    expect(computeScrollTop({ ...base, targetTop: 100, scrollTop: 0 })).toBe(0);
    expect(computeScrollTop({ ...base, targetTop: 5000 })).toBe(1400);
  });

  it("accounts for where the region is already scrolled", () => {
    expect(computeScrollTop({ ...base, scrollTop: 300, targetTop: 400 })).toBe(
      320,
    );
  });
});

describe("staggerDelays", () => {
  it("is empty for nothing and zero for a single piece", () => {
    expect(staggerDelays(0)).toEqual([]);
    expect(staggerDelays(1)).toEqual([0]);
  });

  it("steps per line", () => {
    expect(staggerDelays(3)).toEqual([0, STAGGER_STEP_MS, 2 * STAGGER_STEP_MS]);
  });

  it("never runs past the cap, however many lines", () => {
    const delays = staggerDelays(40);
    expect(delays[0]).toBe(0);
    expect(delays[39]).toBeLessThanOrEqual(STAGGER_CAP_MS);
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
  });
});
