import { expect, test } from "@playwright/test";

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

test("an example chip asks at once and returns a cited answer with source cards", async ({
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
});

test("the chip that cannot be answered gets the refusal card, with no Retry", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Try one it can’t answer" }).click();

  // Scoped to the ask panel: Next's route announcer is an empty alert that
  // is always on the page.
  const panel = page.getByRole("region", { name: "Ask", exact: true });
  const card = panel.getByRole("status").filter({
    hasText: "I couldn't find that in your documents.",
  });
  await expect(card).toBeVisible({ timeout: ANSWER_TIMEOUT_MS });
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Retry" })).toHaveCount(0);
});