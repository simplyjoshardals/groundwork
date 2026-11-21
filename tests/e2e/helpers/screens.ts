import { expect, type Locator, type Page } from "@playwright/test";
import { waitForHydration } from "./hydration";

/**
 * The screens the U6 passes walk. Everything here is reachable without a
 * Gemini call: public pages, and the dev drills (`/dev-states/...`, a 404
 * outside `next dev`) that run the real components against scripted data. The
 * signed-in workspace needs a real demo session, so it is driven separately
 * (`startDemo`).
 */
export interface Screen {
  name: string;
  path: string;
  /** Brings the page to the state the screen is named for. */
  ready: (page: Page) => Promise<void>;
  /** Opens the viewer, whose shell depends on the width: skipped by the overflow check. */
  viewer?: boolean;
}

/**
 * The Ask panel's busy flag (`aria-busy`) is on the div inside the region, not
 * on the region itself.
 */
export function askBusy(page: Page): Locator {
  return page
    .getByRole("region", { name: "Ask", exact: true })
    .locator("[aria-busy]")
    .first();
}

async function headingVisible(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

function publicScreen(name: string, path: string): Screen {
  return { name, path, ready: headingVisible };
}

/** Taps the first example chip, so the scripted scenario plays. */
function askScenario(name: string, settleMs: number): Screen {
  return {
    name: `ask ${name}`,
    path: `/dev-states/ask/${name}?chips=1`,
    ready: async (page) => {
      const chip = page
        .getByRole("region", { name: "Example questions" })
        .getByRole("button")
        .first();
      await waitForHydration(chip);
      await chip.click();
      // The scripted scenarios last at most ~2 s (see app/dev-states/ask/scenarios.ts).
      await page.waitForTimeout(settleMs);
      await expect(askBusy(page)).toHaveAttribute("aria-busy", "false");
    },
  };
}

function documentsScenario(name: string, text?: RegExp): Screen {
  return {
    name: `documents ${name}`,
    path: `/dev-states/documents/${name}`,
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { name: /documents/i }).first(),
      ).toBeVisible();
      if (text) await expect(page.getByText(text).first()).toBeVisible();
    },
  };
}

function viewerScenario(
  name: string,
  waitFor: (shell: Locator) => Promise<void>,
): Screen {
  return {
    name: `viewer ${name}`,
    path: `/dev-states/viewer/${name}`,
    viewer: true,
    ready: async (page) => {
      const open = page.getByRole("button", { name: "Open the citation" });
      await waitForHydration(open);
      await open.click();
      const docked = (page.viewportSize()?.width ?? 0) >= 1280;
      const shell = page.getByRole(docked ? "complementary" : "dialog", {
        name: "Document viewer",
      });
      await expect(shell).toBeVisible();
      await waitFor(shell);
    },
  };
}

const pageLabel = (shell: Locator) =>
  expect(
    shell.getByRole("paragraph").filter({ hasText: /^Page \d+ of \d+$/ }),
  ).toBeVisible({ timeout: 30_000 });

export const SCREENS: readonly Screen[] = [
  publicScreen("landing", "/"),
  publicScreen("sign in", "/sign-in"),
  publicScreen("sign up", "/sign-up"),
  publicScreen("not found", "/no-such-page"),
  publicScreen("check email", "/dev-states/check-email"),
  publicScreen("waiting", "/dev-states/waiting"),
  publicScreen("error", "/dev-states/error"),

  {
    name: "ask idle",
    path: "/dev-states/ask/answer?chips=1",
    ready: async (page) => {
      await expect(
        page.getByRole("region", { name: "Example questions" }),
      ).toBeVisible();
    },
  },
  askScenario("answer", 2800),
  askScenario("refusal", 1200),
  askScenario("fallback", 1200),
  askScenario("error-mid", 2000),
  askScenario("limit-daily", 500),

  documentsScenario("mixed"),
  documentsScenario("empty"),
  documentsScenario("cap"),
  documentsScenario("load-error", /couldn.t load your documents/i),

  viewerScenario("highlight", pageLabel),
  viewerScenario("fallback", pageLabel),
  viewerScenario("text", async (shell) => {
    await expect(shell.locator("[data-viewer-title]")).toBeVisible();
    await shell.page().waitForTimeout(1500);
  }),
  viewerScenario("pdf-error", async (shell) => {
    await expect(shell.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  }),
];

export function screenNamed(name: string): Screen {
  const screen = SCREENS.find((candidate) => candidate.name === name);
  if (!screen)
    throw new Error(`No screen named "${name}" in helpers/screens.ts`);
  return screen;
}
