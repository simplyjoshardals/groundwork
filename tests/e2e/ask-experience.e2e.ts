import { expect, test } from "@playwright/test";
import { expectNoSeriousViolations, settle } from "./helpers/axe";

const ANSWER_TIMEOUT_MS = 60_000;

/**
 * The ask experience as a demo visitor sees it: start the demo, tap an example
 * chip, get a cited answer; tap the "can't answer" chip, get the neutral
 * refusal card. Like the other ask flows this calls the real provider, so it
 * checks the shape of the result, never the wording of an answer.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /try (the )?demo/i }).click();
  await expect(
    page.getByRole("region", { name: "Example questions" }),
  ).toBeVisible();
});

test("an example chip asks at once, returns a cited answer with source cards, and opens a citation in the viewer", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Paid annual leave" }).click();

  const sources = page.getByRole("region", { name: "Sources" });
  await expect(sources.getByRole("listitem").first()).toBeVisible({
    timeout: ANSWER_TIMEOUT_MS,
  });
  const marker = page
    .getByRole("button", { name: /^Source \d+: .+, page \d+$/ })
    .first();
  await expect(marker).toBeVisible({ timeout: ANSWER_TIMEOUT_MS });

  // Hovering a marker lights its card.
  await marker.hover();
  await expect(sources.locator('[aria-current="true"]')).toHaveCount(1);

  // At 1280 px a citation docks the viewer beside the answer; Escape closes
  // it and focus goes back to the marker.
  await marker.click();
  const docked = page.getByRole("complementary", { name: "Document viewer" });
  await expect(docked).toBeVisible();
  // The page text layer may print "Page 3 of 10" too; the toolbar label is the
  // paragraph, the text layer's spans are presentation.
  await expect(
    docked.getByRole("paragraph").filter({ hasText: /^Page \d+ of \d+$/ }),
  ).toBeVisible({ timeout: ANSWER_TIMEOUT_MS });
  // U6: the whole screen (answer, sources and the docked viewer) passes axe.
  await settle(page);
  await expectNoSeriousViolations(
    page,
    "workspace, cited answer and docked viewer",
  );
  await page.keyboard.press("Escape");
  await expect(docked).toBeHidden();
  await expect(marker).toBeFocused();

  // Below 1280 px the same citation opens a modal sheet: the page behind it
  // stops scrolling, Tab stays inside it, and Escape returns focus again.
  // The height is short on purpose, so the page behind is surely scrollable.
  await page.setViewportSize({ width: 768, height: 500 });
  await marker.click();
  const sheet = page.getByRole("dialog", { name: "Document viewer" });
  await expect(sheet).toBeVisible();
  // Wheeling over the backdrop must not move the page. (Not a computed-style
  // check: the browser hands body's overflow to the viewport, so body itself
  // reads "visible" even while the page is locked.)
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(100, 250);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  for (let press = 0; press < 12; press += 1) await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => document.activeElement?.closest("dialog") !== null,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(marker).toBeFocused();
});

test("the chip that cannot be answered gets the refusal card, with no Retry", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Try one it can’t answer" }).click();

  // Scoped to the ask panel: Next's route announcer is an empty alert that
  // is always on the page.
  const panel = page.getByRole("region", { name: "Ask", exact: true });
  const card = panel.getByRole("status").filter({
    hasText: "I couldn’t find that in your documents.",
  });
  await expect(card).toBeVisible({ timeout: ANSWER_TIMEOUT_MS });
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Retry" })).toHaveCount(0);
});