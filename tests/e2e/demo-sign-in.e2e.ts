import { expect, test } from "@playwright/test";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { waitForHydration } from "./helpers/hydration";

// The landing page has a "Try demo" in the header and one in the hero, so the
// tests scope to the landmark. Only the hero one (inside <main>) is used.
test("Try demo on the landing page starts an anonymous session", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL("/");
  const button = page
    .getByRole("main")
    .getByRole("button", { name: "Try demo", exact: true });
  await waitForHydration(button);
  // The button is enabled only once the widget has produced a token.
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();

  await expect(page).toHaveURL("/");
  // The landing headline is gone: this is the workspace now.
  await expect(
    page.getByRole("heading", { name: "Answers that show their sources." }),
  ).toHaveCount(0);
  // The demo shelf is there on first paint (server-rendered): the shared
  // samples with their badge, and the note that uploading needs an account.
  await expect(
    page.getByRole("heading", { name: "Sample documents" }),
  ).toBeVisible();
  await expect(page.getByText("Sample", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Uploading needs an account")).toBeVisible();
  // The header has the counter before any question has been asked.
  await expect(page.getByText(/\d+ of \d+ left/).first()).toBeVisible();
  const cookies = await page.context().cookies();
  expect(
    cookies.some(
      (c) => c.name.startsWith("sb-") && c.name.includes("auth-token"),
    ),
  ).toBe(true);
  // The session survives a reload instead of bouncing back to the landing page.
  await page.reload();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Answers that show their sources." }),
  ).toHaveCount(0);
});

test("Try demo on the sign-in page still starts an anonymous session", async ({
  page,
}) => {
  await page.goto("/sign-in");
  const button = page.getByRole("button", { name: "Try demo", exact: true });
  await waitForHydration(button);
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();

  await expect(page).toHaveURL("/");
  const cookies = await page.context().cookies();
  expect(
    cookies.some(
      (c) => c.name.startsWith("sb-") && c.name.includes("auth-token"),
    ),
  ).toBe(true);
});

// The browser flows above prove a token works. This proves the protection
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
