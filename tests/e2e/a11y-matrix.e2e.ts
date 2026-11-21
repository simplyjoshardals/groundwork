import { test } from "@playwright/test";
import {
  expectNoSeriousViolations,
  expectTheme,
  setTheme,
  settle,
  type Theme,
} from "./helpers/axe";
import { startDemo } from "./helpers/demo";
import { SCREENS } from "./helpers/screens";

/**
 * U6: the accessibility pass (DESIGN 10). Every screen, in light and dark, at
 * a phone width and at desktop width, must have no serious or critical axe
 * violations. Reduced motion is on so axe never reads a colour mid-fade.
 *
 * This needs `next dev` (the drills 404 in production). Run a subset with
 * `--grep`, for example `yarn test:e2e a11y-matrix --grep "viewer"`.
 */
test.use({ reducedMotion: "reduce" });

const THEMES: readonly Theme[] = ["light", "dark"];
const VIEWPORTS = [
  { label: "375", width: 375, height: 812 },
  { label: "1280", width: 1280, height: 800 },
] as const;

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    for (const screen of SCREENS) {
      test(`axe: ${screen.name}, ${theme}, ${viewport.label}px`, async ({
        page,
      }) => {
        await setTheme(page, theme);
        await page.setViewportSize(viewport);
        await page.goto(screen.path);
        await expectTheme(page, theme);
        await screen.ready(page);
        await settle(page);
        await expectNoSeriousViolations(
          page,
          `${screen.name}, ${theme}, ${viewport.label}px`,
        );
      });
    }
  }
}

// The signed-in workspace: a real demo session, no question asked (so no
// provider call). One session per theme, scanned at both widths.
for (const theme of THEMES) {
  test(`axe: workspace (demo, idle), ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await page.setViewportSize({ width: 1280, height: 800 });
    await startDemo(page);
    await expectTheme(page, theme);
    for (const viewport of [VIEWPORTS[1], VIEWPORTS[0]]) {
      await page.setViewportSize(viewport);
      await settle(page);
      await expectNoSeriousViolations(
        page,
        `workspace, ${theme}, ${viewport.label}px`,
      );
    }
  });
}
