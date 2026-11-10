/**
 * Cloudflare's published Turnstile test values (developers.cloudflare.com,
 * "Testing"). They are public and carry no secret, which is why they may live
 * in the repo. No `server-only` marker on purpose: Playwright and the browser
 * code both import this file.
 *
 * - The always-pass site keys make the widget issue `TURNSTILE_DUMMY_TOKEN`
 *   without any challenge, from any host including localhost.
 * - The always-pass secret accepts ANY non-empty token, not only the dummy
 *   one. A request with no token at all is still rejected by Supabase Auth
 *   before Cloudflare is asked.
 * - A production secret rejects the dummy token, so a test site key that leaks
 *   into a hosted deployment makes sign-in fail closed.
 * - The always-pass secret must NEVER be configured on the hosted Supabase
 *   project: it would let anyone in with any token.
 */
export const TURNSTILE_TEST_SITE_KEY_PASS = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_PASS = "1x0000000000000000000000000000000AA";
export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

const ALWAYS_PASS_SITE_KEYS: ReadonlySet<string> = new Set([
  TURNSTILE_TEST_SITE_KEY_PASS,
  // The invisible always-pass key.
  "1x00000000000000000000BB",
]);

export function isAlwaysPassTestSiteKey(key: string | undefined): boolean {
  return key !== undefined && ALWAYS_PASS_SITE_KEYS.has(key.trim());
}
