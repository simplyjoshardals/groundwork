import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForHydration } from "./helpers/hydration";

/**
 * U6 / DESIGN 10: demo, ask and citation with the keyboard alone. Like the
 * other ask flows this calls the real provider (one question), so it checks
 * the shape of the result, never the wording. Skip it with
 * `--grep-invert keyboard` when the free-tier quota is short.
 */

/** Presses Tab until `target` has focus. Fails loudly if it never does. */
async function tabTo(page: Page, target: Locator, maxPresses = 40) {
  const element = target.first();
  await expect(element).toBeVisible();
  for (let press = 0; press <= maxPresses; press += 1) {
    if (await element.evaluate((node) => node === document.activeElement)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab did not reach the target in ${maxPresses} presses`);
}

/** The focused element draws an outline or a ring (DESIGN 0.6). */
async function expectVisibleFocus(page: Page) {
  const visible = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return false;
    const style = getComputedStyle(element);
    const outlined =
      style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    return outlined || style.boxShadow !== "none";
  });
  expect(visible, "the focused element shows no focus indicator").toBe(true);
}

test("demo, ask and citation work with the keyboard alone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const hero = page
    .getByRole("main")
    .getByRole("button", { name: "Try demo", exact: true });
  await waitForHydration(hero);
  await expect(hero).toBeEnabled({ timeout: 30_000 });
  await tabTo(page, hero);
  await expectVisibleFocus(page);
  await page.keyboard.press("Enter");

  const chip = page
    .getByRole("region", { name: "Example questions" })
    .getByRole("button", { name: "Paid annual leave" });
  await tabTo(page, chip);
  await expectVisibleFocus(page);
  await page.keyboard.press("Enter");

  const marker = page
    .getByRole("button", { name: /^Source \d+: .+, page \d+$/ })
    .first();
  await expect(marker).toBeVisible({ timeout: 60_000 });
  await tabTo(page, marker);
  await expectVisibleFocus(page);
  await page.keyboard.press("Enter");

  const viewer = page.getByRole("complementary", { name: "Document viewer" });
  await expect(viewer).toBeVisible();
  // Focus moves into the viewer on open.
  await expect
    .poll(() =>
      viewer.evaluate((node) => node.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(marker).toBeFocused();
});
