import { expect, test } from "@playwright/test";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { waitForHydration } from "./helpers/hydration";

test("Try demo with the always-pass test key starts an anonymous session", async ({
  page,
}) => {
  await page.goto("/sign-in");
  const button = page.getByRole("button", { name: "Try demo", exact: true });
  await waitForHydration(button);
  // The button is enabled only once the widget has produced a token.
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();

  await expect(page).toHaveURL("/");
  const cookies = await page.context().cookies();
  expect(
    cookies.some(
      (c) => c.name.startsWith("sb-") && c.name.includes("auth-token"),
    ),
  ).toBe(true);
  // The session survives a reload instead of bouncing back to the sign-in page.
  await page.reload();
  await expect(page).toHaveURL("/");
});

// The browser flow above proves a token works. This proves the protection
// itself: Supabase Auth must reject a request that carries no CAPTCHA token,
// however the request is made. If CAPTCHA protection is switched off in
// `supabase/config.toml`, the call succeeds and the test fails. A bad token
// cannot be tested here: the always-pass test secret accepts any token, and
// telling a good token from a bad one is Cloudflare's job in production.
test("anonymous sign-in without a CAPTCHA token is rejected", async ({
  request,
}) => {
  const response = await request.post(`${supabaseUrl()}/auth/v1/signup`, {
    headers: {
      apikey: supabasePublishableKey(),
      "Content-Type": "application/json",
    },
    data: {},
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).not.toContain("access_token");
});
