import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { waitForHydration } from "./hydration";

export type TestUser = { email: string; password: string };

/**
 * Unique credentials per call, so tests never collide and never reuse an
 * account left over from an earlier run. The password is well above the
 * 8-character minimum in `supabase/config.toml`.
 */
export function createTestUser(): TestUser {
  return {
    email: `e2e-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
  };
}

/**
 * Signs up through the real form. Local Supabase has email confirmation off
 * (`enable_confirmations = false`), so success means a session and a redirect
 * to `/`, where the header shows the email.
 */
export async function signUpViaUi(page: Page, user: TestUser): Promise<void> {
  await page.goto("/sign-up");
  await waitForHydration(page.locator("form"));
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(user.email)).toBeVisible();
}
