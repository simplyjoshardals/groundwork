import { expect, test, type Page } from "@playwright/test";
import { startDemo } from "./helpers/demo";
import { expectNoHorizontalScroll, findSmallTargets } from "./helpers/layout";
import { SCREENS, askBusy, screenNamed } from "./helpers/screens";
import { waitForHydration } from "./helpers/hydration";

/**
 * U6: the responsive pass and the motion pass, as measurements. They prove
 * what a machine can prove (no sideways scroll, no shift above the sources,
 * loops only where DESIGN allows them, 44 px targets on touch). Whether it
 * looks right is the screenshot review.
 */

const WIDTHS = [320, 375, 768, 1280] as const;

test.describe("no horizontal scroll (DESIGN 4.2)", () => {
  for (const screen of SCREENS.filter((candidate) => !candidate.viewer)) {
    test(screen.name, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(screen.path);
      await screen.ready(page);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await expectNoHorizontalScroll(page, `${screen.name} at ${width}px`);
      }
    });
  }

  test("workspace (demo, idle)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startDemo(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoHorizontalScroll(page, `workspace at ${width}px`);
    }
  });
});

test("nothing above the sources shifts while an answer streams (DESIGN 6.4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dev-states/ask/slow");
  const box = page.getByRole("textbox");
  await waitForHydration(box);

  // Layout shifts, minus the sources block (the list and the "other passages"
  // under it), which the growing answer pushes down by design. Anything else
  // moving is a bug. Each offender reports where it moved from and to.
  await page.evaluate(() => {
    const offenders: string[] = [];
    (window as unknown as { __offenders: string[] }).__offenders = offenders;
    type Shift = PerformanceEntry & {
      hadRecentInput: boolean;
      sources?: {
        node: Node | null;
        previousRect: DOMRectReadOnly;
        currentRect: DOMRectReadOnly;
      }[];
    };
    const isSourcesBlock = (el: Element): boolean => {
      const root = document.querySelector(
        'section[aria-label="Ask"] [aria-busy]',
      );
      const sources = root?.querySelector('section[aria-label="Sources"]');
      if (!root || !sources) return false;
      // The sources section's wrapper: the child of the panel that holds it.
      let block: Element = sources;
      while (block.parentElement && block.parentElement !== root) {
        block = block.parentElement;
      }
      return block.contains(el);
    };
    const place = (rect: DOMRectReadOnly) =>
      `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Shift[]) {
        if (entry.hadRecentInput) continue;
        for (const source of entry.sources ?? []) {
          const node = source.node;
          if (!node) continue;
          const el = node instanceof Element ? node : node.parentElement;
          if (!el || el.closest("details") || isSourcesBlock(el)) continue;
          offenders.push(
            `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}" moved ${place(source.previousRect)} -> ${place(source.currentRect)} at ${Math.round(entry.startTime)} ms`,
          );
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  await box.fill("How much annual leave do I get?");
  await box.press("Enter");
  await expect(page.getByText("Searching your documents…")).toBeVisible();
  await expect(askBusy(page)).toHaveAttribute("aria-busy", "false", {
    timeout: 40_000,
  });

  const offenders = await page.evaluate(
    () => (window as unknown as { __offenders: string[] }).__offenders,
  );
  expect(offenders, "elements that moved outside the sources list").toEqual([]);
});

/** Names of the animations that loop forever and are running right now. */
async function loopingAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === "running" &&
          animation.effect?.getComputedTiming().iterations === Infinity,
      )
      .map((animation) =>
        animation instanceof CSSAnimation
          ? animation.animationName
          : "(script animation)",
      ),
  );
}

test.describe("looping motion (DESIGN 7)", () => {
  test("the shelf loops only its progress line and the processing spine", async ({
    page,
  }) => {
    await page.goto("/dev-states/documents/mixed");
    await expect(
      page.getByRole("heading", { name: /documents/i }).first(),
    ).toBeVisible();
    // `mixed` has processing documents, so both loops run. The strip fills in
    // after hydration, so wait for both rather than sampling once. If it never
    // gets there, the failure shows what was running.
    await expect
      .poll(async () => [...new Set(await loopingAnimations(page))].sort(), {
        timeout: 10_000,
      })
      .toEqual(["row-progress", "spine-pulse"]);
  });

  test("the ask skeleton loops one shimmer and nothing else", async ({
    page,
  }) => {
    await page.goto("/dev-states/ask/slow");
    const box = page.getByRole("textbox");
    await waitForHydration(box);
    await box.fill("How much annual leave do I get?");
    await box.press("Enter");
    await expect(page.getByText("Searching your documents…")).toBeVisible();
    expect([...new Set(await loopingAnimations(page))]).toEqual(["shimmer"]);
  });

  test("with reduced motion nothing loops", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dev-states/documents/mixed");
    await expect(
      page.getByRole("heading", { name: /documents/i }).first(),
    ).toBeVisible();
    expect(await loopingAnimations(page)).toEqual([]);
  });
});

test.describe("touch targets on a coarse pointer (DESIGN 0.6)", () => {
  test.use({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });

  const NAMES = [
    "landing",
    "sign in",
    "sign up",
    "ask idle",
    "ask limit-daily",
    "documents mixed",
    "documents cap",
    "documents load-error",
  ];

  for (const name of NAMES) {
    test(name, async ({ page }) => {
      const screen = screenNamed(name);
      await page.goto(screen.path);
      await screen.ready(page);
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
        "the emulated device is not a coarse pointer",
      ).toBe(true);
      expect(
        await findSmallTargets(page),
        `${name}: targets under 44 px`,
      ).toEqual([]);
    });
  }

  test("workspace (demo, idle)", async ({ page }) => {
    await startDemo(page);
    expect(
      await findSmallTargets(page),
      "workspace: targets under 44 px",
    ).toEqual([]);
  });
});
