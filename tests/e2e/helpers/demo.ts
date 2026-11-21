import { expect, type Page } from "@playwright/test";
import { waitForHydration } from "./hydration";

/** Starts a demo session from the landing page and waits for the demo shelf. */
export async function startDemo(page: Page): Promise<void> {
  await page.goto("/");
  const button = page
    .getByRole("main")
    .getByRole("button", { name: "Try demo", exact: true });
  await waitForHydration(button);
  // Enabled only once the Turnstile widget has produced a token.
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
  await expect(
    page.getByRole("heading", { name: "Sample documents" }),
  ).toBeVisible();
}
