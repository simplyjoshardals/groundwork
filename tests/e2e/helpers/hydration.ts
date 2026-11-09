import { expect, type Locator } from "@playwright/test";

/**
 * Waits until React has hydrated the element and attached its props (event
 * handlers). Server-rendered HTML is visible and clickable before that, and
 * acting early loses the event: a sign-up form submitted before hydration
 * does a native GET with the password in the URL, and a file chosen before
 * hydration never reaches `onChange`.
 *
 * React 19 marks hydrated DOM nodes with a `__reactProps$<id>` property. That
 * is an internal detail, so if a React upgrade breaks it, this helper times
 * out with the message below rather than passing silently.
 */
export async function waitForHydration(target: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        target.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith("__reactProps$")),
        ),
      {
        message: "the element was never hydrated by React",
        timeout: 60_000,
      },
    )
    .toBe(true);
}
