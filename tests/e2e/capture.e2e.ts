import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { expectTheme, setTheme, settle, type Theme } from "./helpers/axe";
import { startDemo } from "./helpers/demo";
import { waitForHydration } from "./helpers/hydration";

/**
 * U6: README and demo-video media. Not a test: it writes files to
 * `docs/media/`, so it only runs on request.
 *
 *   PowerShell:  $env:CAPTURE = "1"; yarn test:e2e capture
 *   Live hero shots (spends one real answer): also set $env:CAPTURE_LIVE = "1"
 *
 * Stills use `animations: "disabled"`: finite animations jump to their end
 * (the highlight is fully drawn) and loops are stopped, so every run gives the
 * same picture. Stills of the drills show the real components on scripted
 * data, so they spend no provider quota and never change with the model. A
 * drill page also carries its own explanatory text, so a drill still is either
 * an element shot (the viewer) or cropped from the component down (the shelf);
 * it is never the whole drill page.
 */
test.skip(process.env.CAPTURE !== "1", "Set CAPTURE=1 to write README media.");

const MEDIA = path.join(process.cwd(), "docs", "media");
const CLIPS = path.join(MEDIA, "clips");
if (process.env.CAPTURE === "1") mkdirSync(CLIPS, { recursive: true });

const THEMES: readonly Theme[] = ["light", "dark"];
const SIZES = [
  { label: "mobile", width: 375, height: 812 },
  { label: "desktop", width: 1280, height: 800 },
] as const;

/**
 * `next dev` draws its indicator (a `<nextjs-portal>` badge, and an overlay on
 * errors) over every page. It is not part of the product, so the media hides
 * it. An adopted stylesheet leaves the DOM alone, so hydration is unaffected,
 * and it is added before any page script runs, so no frame of a clip shows it.
 */
async function prepare(page: Page, theme: Theme): Promise<void> {
  await setTheme(page, theme);
  await page.addInitScript(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("nextjs-portal { display: none !important; }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
}

async function still(page: Page, name: string, theme: Theme, size: string) {
  await settle(page);
  await page.screenshot({
    path: path.join(MEDIA, `${name}-${theme}-${size}.png`),
    animations: "disabled",
  });
}

/** One element, cropped to its box: the viewer without the drill page around it. */
async function stillOf(
  target: Locator,
  name: string,
  theme: Theme,
  size: string,
) {
  await settle(target.page());
  await target.screenshot({
    path: path.join(MEDIA, `${name}-${theme}-${size}.png`),
    animations: "disabled",
  });
}

/**
 * The page from `from` down, at most one viewport tall, so a drill's own
 * description above the component stays out of the shot.
 */
async function stillFrom(
  page: Page,
  from: Locator,
  name: string,
  theme: Theme,
  size: string,
) {
  await settle(page);
  const box = await from.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error(`nothing to crop from for ${name}`);
  const scrollY = await page.evaluate(() => window.scrollY);
  const top = Math.max(0, box.y + scrollY - 16);
  const pageHeight = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.screenshot({
    path: path.join(MEDIA, `${name}-${theme}-${size}.png`),
    animations: "disabled",
    fullPage: true,
    clip: {
      x: 0,
      y: top,
      width: viewport.width,
      height: Math.min(viewport.height, pageHeight - top),
    },
  });
}

async function askFirstChip(page: Page, waitMs: number) {
  const chip = page
    .getByRole("region", { name: "Example questions" })
    .getByRole("button")
    .first();
  await waitForHydration(chip);
  await chip.click();
  await page.waitForTimeout(waitMs);
}

async function openCitation(page: Page): Promise<Locator> {
  const open = page.getByRole("button", { name: "Open the citation" });
  await waitForHydration(open);
  await open.click();
  const docked = (page.viewportSize()?.width ?? 0) >= 1280;
  const shell = page.getByRole(docked ? "complementary" : "dialog", {
    name: "Document viewer",
  });
  await expect(
    shell.getByRole("paragraph").filter({ hasText: /^Page \d+ of \d+$/ }),
  ).toBeVisible({ timeout: 30_000 });
  // The highlight wipe: scroll settles (700 ms), then 600 ms of wipe.
  await page.waitForTimeout(2000);
  return shell;
}

for (const theme of THEMES) {
  for (const size of SIZES) {
    const viewport = { width: size.width, height: size.height };

    test(`stills: landing, ${theme}, ${size.label}`, async ({ page }) => {
      await prepare(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expectTheme(page, theme);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Not while Turnstile is still verifying: the hero button would read
      // "Preparing demo…" and the header button would look disabled.
      const hero = page
        .getByRole("main")
        .getByRole("button", { name: "Try demo", exact: true });
      await waitForHydration(hero);
      await expect(hero).toBeEnabled({ timeout: 30_000 });
      await still(page, "landing", theme, size.label);
    });

    test(`stills: ask refusal, ${theme}, ${size.label}`, async ({ page }) => {
      await prepare(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/dev-states/ask/refusal?chips=1");
      await askFirstChip(page, 1500);
      await still(page, "ask-refusal", theme, size.label);
    });

    test(`stills: ask answer, ${theme}, ${size.label}`, async ({ page }) => {
      await prepare(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/dev-states/ask/answer?chips=1");
      await askFirstChip(page, 3000);
      await still(page, "ask-answer", theme, size.label);
    });

    test(`stills: shelf, ${theme}, ${size.label}`, async ({ page }) => {
      await prepare(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/dev-states/documents/mixed");
      const heading = page.getByRole("heading", { name: /^your documents$/i });
      await expect(heading).toBeVisible();
      await waitForHydration(page.locator('input[type="file"]'));
      // The shelf strip fills in after hydration; without this the shot shows
      // ten empty slots above rows that are already there.
      await page.waitForTimeout(1200);
      await stillFrom(page, heading, "shelf", theme, size.label);
    });

    test(`stills: viewer highlight, ${theme}, ${size.label}`, async ({
      page,
    }) => {
      await prepare(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/dev-states/viewer/highlight");
      const viewer = await openCitation(page);
      await stillOf(viewer, "viewer-highlight", theme, size.label);
    });

    test(`stills: viewer fallback, ${theme}, ${size.label}`, async ({
      page,
    }) => {
      await prepare(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/dev-states/viewer/fallback");
      const viewer = await openCitation(page);
      await stillOf(viewer, "viewer-fallback", theme, size.label);
    });
  }

  test(`stills: workspace (demo), ${theme}`, async ({ page }) => {
    await prepare(page, theme);
    await page.setViewportSize({ width: 1280, height: 800 });
    await startDemo(page);
    await expectTheme(page, theme);
    await still(page, "workspace", theme, "desktop");
    await page.setViewportSize({ width: 375, height: 812 });
    await still(page, "workspace", theme, "mobile");
  });
}

// Clips: a 1280 x 720 recording per scene, saved as .webm. Turn one into a GIF
// with ffmpeg (see the commands printed at the end of the run).
async function clip(
  browser: Browser,
  name: string,
  theme: Theme,
  scene: (page: Page) => Promise<void>,
) {
  const size = { width: 1280, height: 720 };
  const context = await browser.newContext({
    viewport: size,
    recordVideo: { dir: CLIPS, size },
  });
  const page = await context.newPage();
  await prepare(page, theme);
  await scene(page);
  await context.close();
  await page.video()?.saveAs(path.join(CLIPS, `${name}-${theme}.webm`));
}

test("clip: a streamed answer with sources", async ({ browser }) => {
  await clip(browser, "answer-stream", "light", async (page) => {
    await page.goto("/dev-states/ask/slow?chips=1");
    await page.waitForTimeout(800);
    await askFirstChip(page, 12_000);
  });
});

test("clip: the refusal", async ({ browser }) => {
  await clip(browser, "refusal", "light", async (page) => {
    await page.goto("/dev-states/ask/refusal?chips=1");
    await page.waitForTimeout(800);
    await askFirstChip(page, 2500);
  });
});

// This drill page opens with its own description (about the first 260 px of
// the video): crop it away, for example
//   ffmpeg -i shelf-upload-light.webm -vf "crop=1280:460:0:260" shelf-upload.webm
test("clip: the shelf takes an upload", async ({ browser }) => {
  await clip(browser, "shelf-upload", "light", async (page) => {
    await page.goto("/dev-states/documents/empty");
    const input = page.locator('input[type="file"]');
    await waitForHydration(input);
    await page.waitForTimeout(800);
    // The drill runs the real file checks, so this must look like a PDF.
    await input.setInputFiles(
      path.join(process.cwd(), "tests", "fixtures", "pdf", "single-column.pdf"),
    );
    await page.waitForTimeout(5000);
  });
});

// Opt-in: the real thing, one real answer (the hero shot for the README).
test.describe("live", () => {
  test.skip(
    process.env.CAPTURE_LIVE !== "1",
    "Set CAPTURE_LIVE=1 for the live shots.",
  );

  for (const theme of THEMES) {
    test(`stills: cited answer with the docked viewer, ${theme}`, async ({
      page,
    }) => {
      await prepare(page, theme);
      await page.setViewportSize({ width: 1280, height: 800 });
      await startDemo(page);
      await page.getByRole("button", { name: "Paid annual leave" }).click();
      const marker = page
        .getByRole("button", { name: /^Source \d+: .+, page \d+$/ })
        .first();
      await expect(marker).toBeVisible({ timeout: 60_000 });
      await marker.click();
      const viewer = page.getByRole("complementary", {
        name: "Document viewer",
      });
      await expect(
        viewer.getByRole("paragraph").filter({ hasText: /^Page \d+ of \d+$/ }),
      ).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(2000);
      await still(page, "hero", theme, "desktop");
    });

    test(`stills: cited answer in the sheet, ${theme}, mobile`, async ({
      page,
    }) => {
      await prepare(page, theme);
      await page.setViewportSize({ width: 375, height: 812 });
      await startDemo(page);
      await page.getByRole("button", { name: "Paid annual leave" }).click();
      const marker = page
        .getByRole("button", { name: /^Source \d+: .+, page \d+$/ })
        .first();
      await expect(marker).toBeVisible({ timeout: 60_000 });
      await marker.click();
      const sheet = page.getByRole("dialog", { name: "Document viewer" });
      await expect(
        sheet.getByRole("paragraph").filter({ hasText: /^Page \d+ of \d+$/ }),
      ).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(2000);
      await still(page, "hero", theme, "mobile");
    });
  }

  // The citation highlight, on the real flow (the drill page has stand-in text).
  test("clip: the citation highlight (live)", async ({ browser }) => {
    for (const theme of THEMES) {
      await clip(browser, "citation-highlight", theme, async (page) => {
        await startDemo(page);
        await page.waitForTimeout(800);
        await page.getByRole("button", { name: "Paid annual leave" }).click();
        const marker = page
          .getByRole("button", { name: /^Source \d+: .+, page \d+$/ })
          .first();
        await expect(marker).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(800);
        await marker.click();
        await page.waitForTimeout(3500);
      });
    }
  });
});
