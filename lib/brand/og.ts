/**
 * The social image's constants. The image is drawn by Satori, which cannot
 * read CSS variables, so the colours are literals here: the light-mode tokens
 * of `app/globals.css`, copied. `tests/unit/token-sync.test.ts` fails if they
 * drift. Light mode only: a link preview has no theme.
 */
export const OG_SIZE = { width: 1200, height: 630 } as const;

export const OG_COLORS = {
  bg: "#f5f1e8",
  ink: "#1e1b16",
  muted: "#6b645a",
  line: "#e2dbcb",
  accent: "#1f5a4a",
  accentSoft: "#e3eee8",
  highlight: "rgba(243, 213, 104, 0.45)",
} as const;

/** Every glyph the image draws, so the font file is only a few kilobytes. */
export const OG_TEXT =
  "Groundwork Answers that show their sources. How much annual leave do I get? Full-time employees get 26 days of paid annual leave in each leave year. 1 Employee handbook, p. 3";

/**
 * Newsreader 600 as a TTF for Satori (it reads TTF, OTF and WOFF but not
 * WOFF2, and `next/font` does not expose files). Asks Google Fonts for a
 * subset of `text`. Returns `null` if it cannot be fetched, so the build still
 * succeeds; the image then falls back to Satori's built-in sans, which is
 * logged as a warning because it is off-brand.
 */
export async function loadNewsreader(
  text: string = OG_TEXT,
): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(
        `https://fonts.googleapis.com/css2?family=Newsreader:wght@600&text=${encodeURIComponent(text)}`,
      )
    ).text();
    const url = css.match(
      /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/,
    )?.[1];
    if (!url) throw new Error("no TTF source in the font stylesheet");
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`font download answered ${response.status}`);
    return await response.arrayBuffer();
  } catch (error) {
    console.warn(
      `[og] Could not load Newsreader; the social image uses the fallback font. ${String(error)}`,
    );
    return null;
  }
}
