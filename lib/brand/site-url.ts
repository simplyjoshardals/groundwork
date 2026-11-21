/**
 * The absolute origin of the site, for `metadataBase` (Open Graph and Twitter
 * image URLs must be absolute). In order:
 *
 * 1. `NEXT_PUBLIC_SITE_URL`, for a custom domain;
 * 2. `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets (without a scheme);
 * 3. `http://localhost:3000`, for local development and CI builds.
 *
 * A value that is not a URL throws, so a typo fails the build instead of
 * publishing a link preview that points nowhere.
 */
export function siteUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): URL {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return new URL(explicit);
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return new URL(`https://${vercel}`);
  return new URL("http://localhost:3000");
}
