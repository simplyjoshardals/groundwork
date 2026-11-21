import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OG_COLORS } from "@/lib/brand/og";

/**
 * Two places repeat a colour token as a literal because they cannot read CSS
 * variables: the social image (Satori) and the PDF canvas background. This
 * keeps them equal to the light-mode tokens in app/globals.css.
 */
function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The custom properties of the first `:root { ... }` block (the light theme). */
function lightTokens(): Map<string, string> {
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(read("app/globals.css"))?.[1];
  if (!block) throw new Error("No :root block found in app/globals.css");
  const tokens = new Map<string, string>();
  for (const match of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    tokens.set(match[1], normalize(match[2]));
  }
  return tokens;
}

describe("light tokens repeated as literals", () => {
  const tokens = lightTokens();

  it.each([
    ["bg", OG_COLORS.bg],
    ["text", OG_COLORS.ink],
    ["muted", OG_COLORS.muted],
    ["border", OG_COLORS.line],
    ["accent", OG_COLORS.accent],
    ["accent-soft", OG_COLORS.accentSoft],
    ["highlight-soft", OG_COLORS.highlight],
  ])("the social image's %s matches app/globals.css", (token, literal) => {
    expect(normalize(literal)).toBe(tokens.get(token));
  });

  it("the PDF canvas background is the paper token", () => {
    const literal = /PAPER_CANVAS\s*=\s*"([^"]+)"/.exec(
      read("components/pdf-viewer.tsx"),
    )?.[1];
    expect(literal).toBeDefined();
    expect(normalize(literal ?? "")).toBe(tokens.get("paper"));
  });
});
