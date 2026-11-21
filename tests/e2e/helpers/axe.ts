import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export type Theme = "light" | "dark";

/** The key the head script reads (lib/theme/theme-script.ts). */
const THEME_KEY = "groundwork-theme";

/**
 * Stores the theme choice before the page's own scripts run, so the head
 * script applies it on first paint (the same path a returning visitor takes).
 * Call it before `page.goto`.
 */
export async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Storage blocked: the page falls back to the system theme.
      }
    },
    { key: THEME_KEY, value: theme },
  );
}

/** Fails early, with a clear reason, if the theme did not actually apply. */
export async function expectTheme(page: Page, theme: Theme): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/**
 * Waits until fonts are loaded and no finite animation is still running, so a
 * contrast check never reads a colour from the middle of a fade. Looping
 * animations (skeleton shimmer, progress line) are left alone: they never
 * change a text colour.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" &&
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              ).length,
        ),
      { message: "finite animations never finished" },
    )
    .toBe(0);
}

const BLOCKING = new Set(["serious", "critical"]);

/**
 * DESIGN 10: no serious or critical axe violations. Runs the WCAG A and AA
 * rules (through 2.2) plus axe's best-practice rules, and fails only on
 * serious and critical results. Lesser violations and "incomplete" checks
 * (axe could not decide, for example text over a PDF canvas) are printed, not
 * hidden, so a review can see what was not proven.
 */
export async function expectNoSeriousViolations(
  page: Page,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
      "best-practice",
    ])
    // Next's dev-mode indicator is not part of the product.
    .exclude("nextjs-portal")
    .analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact && BLOCKING.has(violation.impact),
  );
  const minor = results.violations.filter(
    (violation) => !violation.impact || !BLOCKING.has(violation.impact),
  );
  console.log(
    `axe [${label}] blocking: ${blocking.length}, minor: ${minor.length} (${minor
      .map((violation) => violation.id)
      .join(
        ", ",
      )}), incomplete: ${results.incomplete.length} (${results.incomplete
      .map((check) => check.id)
      .join(", ")})`,
  );

  expect(
    blocking.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 4).map((node) => node.target.join(" ")),
    })),
    `axe: ${label}`,
  ).toEqual([]);
}
