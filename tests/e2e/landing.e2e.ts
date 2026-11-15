import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./helpers/hydration";

const HEADLINE = "Answers that show their sources.";

type ClsWindow = Window & { __cls: number };
type LayoutShiftEntry = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
};

/** The hero button: the one inside <main> (the header has its own). */
function heroButton(page: Page) {
  return page
    .getByRole("main")
    .getByRole("button", { name: "Try demo", exact: true });
}

test("a signed-out visitor sees the landing page at / with no redirect", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { level: 1, name: HEADLINE }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in" }),
  ).toHaveAttribute("href", "/sign-in");
});

test("a shared document link survives Try demo", async ({ page }) => {
  const doc = randomUUID();
  const target = `/?doc=${doc}&page=2&chunk=1`;
  await page.goto(target);
  await expect(page.getByText("You opened a shared page.")).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in" }),
  ).toHaveAttribute("href", `/sign-in?next=${encodeURIComponent(target)}`);

  const button = heroButton(page);
  await waitForHydration(button);
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();

  await expect(page).toHaveURL(target);
  // The viewer opens for the link; an unknown document shows its own message.
  await expect(
    page.getByRole("complementary", { name: "Document viewer" }),
  ).toBeVisible();
});

test("the landing page does not shift when Turnstile loads", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as ClsWindow;
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as LayoutShiftEntry;
        if (!shift.hadRecentInput) w.__cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/");
  const button = heroButton(page);
  await waitForHydration(button);
  // Enabled means the widget loaded and produced its token.
  await expect(button).toBeEnabled({ timeout: 30_000 });
  // Let any late layout work land, without waiting for the network to go idle:
  // in `next dev` the HMR connection and Turnstile's own requests mean it
  // never does, and the test would hang until its timeout.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const cls = await page.evaluate(() => (window as unknown as ClsWindow).__cls);
  expect(cls).toBeLessThan(0.02);
});

test("offline, the hero button is disabled and says why", async ({ page }) => {
  await page.goto("/");
  const button = heroButton(page);
  await waitForHydration(button);
  await expect(button).toBeEnabled({ timeout: 30_000 });
  try {
    await page.context().setOffline(true);
    await expect(
      page.getByText("You’re offline. The demo needs a connection."),
    ).toBeVisible();
    await expect(button).toBeDisabled();
  } finally {
    await page.context().setOffline(false);
  }
});

test("an unknown page shows the 404 page", async ({ page }) => {
  await page.goto("/there-is-no-such-page");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "That page isn’t on the shelf.",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go to Groundwork" }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { level: 1, name: HEADLINE }),
  ).toBeVisible();
});
