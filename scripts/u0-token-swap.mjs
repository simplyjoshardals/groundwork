#!/usr/bin/env node
/**
 * TEMPORARY (U0). Swaps Tailwind's default-palette utilities for DESIGN.md
 * tokens in app/ and components/, so removing the default palette in
 * globals.css does not silently unstyle existing pages (for example
 * `bg-white` on the viewer sheet, or `text-red-600` on error messages).
 *
 * It is a stopgap, not a redesign: each existing component is rebuilt on the
 * primitives in its own later slice. Delete this script after running it.
 *
 *   node scripts/u0-token-swap.mjs           dry run: prints what would change
 *   node scripts/u0-token-swap.mjs --write   applies the changes
 *
 * Review the result with `git diff`. Anything it does not know how to map is
 * listed as UNMAPPED and left untouched, so nothing is changed silently.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const WRITE = process.argv.includes("--write");
const ROOTS = ["app", "components"];
const SKIP_DIRS = new Set(["node_modules", ".next", "ui", "dev"]); // `ui` and `dev` are new in U0

// Legacy utility (no variant prefix) -> token utility.
const MAP = {
  // surfaces
  "bg-white": "bg-surface",
  "bg-neutral-50": "bg-sunken",
  "bg-gray-50": "bg-sunken",
  "bg-neutral-100": "bg-sunken",
  "bg-gray-100": "bg-sunken",
  "bg-neutral-200": "bg-line",
  "bg-gray-200": "bg-line",
  "bg-yellow-200": "bg-highlight-soft",
  // solid fills
  "bg-black": "bg-accent",
  "bg-red-600": "bg-danger",
  "bg-red-700": "bg-danger",
  "bg-red-50": "bg-danger-soft",
  // text
  "text-black": "text-ink",
  "text-neutral-900": "text-ink",
  "text-neutral-700": "text-ink",
  "text-gray-700": "text-ink",
  "text-neutral-600": "text-muted",
  "text-neutral-500": "text-muted",
  "text-gray-600": "text-muted",
  "text-gray-500": "text-muted",
  "text-red-600": "text-danger",
  "text-red-700": "text-danger",
  "text-amber-700": "text-warn",
  "text-green-700": "text-accent",
  "text-blue-700": "text-accent",
  // borders
  "border-neutral-200": "border-line",
  "border-gray-200": "border-line",
  "border-neutral-300": "border-control",
  "border-gray-300": "border-control",
  "border-red-300": "border-danger",
  "border-green-300": "border-accent",
  "border-blue-300": "border-accent",
  // focus and elevation
  "outline-black": "outline-focus",
  "shadow-xl": "shadow-sheet",
};

// `text-white` depends on the fill it sits on, so it is decided per line.
const TEXT_WHITE = "text-white";

const NAMES = [...Object.keys(MAP), TEXT_WHITE].sort((a, b) => b.length - a.length);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A class token: optional variant prefixes (hover:, lg:, file:, ...) + name,
// bounded by whitespace or a quote/backtick, so `text-red-600/50` or
// `bg-black-ish` never match.
const TOKEN = new RegExp(
  `(^|[\\s"'\`])((?:[a-z0-9-]+:)*)(${NAMES.map(escape).join("|")})(?=$|[\\s"'\`])`,
  "g",
);

// Any default-palette color utility left after mapping is reported.
const LEFTOVER =
  /(^|[\s"'`])((?:[a-z0-9-]+:)*)((?:bg|text|border|outline|ring|divide|placeholder|fill|stroke|decoration|caret|accent|from|to|via)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?|shadow-(?:sm|md|lg|xl|2xl))(?=$|[\s"'`])/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

let changedFiles = 0;
let changedTokens = 0;
const unmapped = [];

for (const root of ROOTS) {
  let files;
  try {
    files = walk(root);
  } catch {
    continue; // folder does not exist in this repo
  }
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const lines = before.split("\n");
    let fileTokens = 0;

    const after = lines
      .map((line) => {
        const danger = /bg-red-/.test(line);
        return line.replace(TOKEN, (_m, lead, variants, name) => {
          fileTokens++;
          const next =
            name === TEXT_WHITE
              ? danger
                ? "text-danger-fg"
                : "text-accent-fg"
              : MAP[name];
          return `${lead}${variants}${next}`;
        });
      })
      .join("\n");

    after.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(LEFTOVER)) {
        unmapped.push(`${file}:${i + 1}: ${m[2]}${m[3]}`);
      }
    });

    if (fileTokens > 0) {
      changedFiles++;
      changedTokens += fileTokens;
      console.log(`${WRITE ? "updated" : "would update"} ${file} (${fileTokens})`);
      if (WRITE) writeFileSync(file, after);
    }
  }
}

console.log(
  `\n${WRITE ? "Changed" : "Would change"} ${changedTokens} class names in ${changedFiles} files.`,
);
if (unmapped.length > 0) {
  console.log(`\nUNMAPPED (${unmapped.length}), fix by hand:`);
  for (const u of unmapped) console.log(`  ${u}`);
  process.exitCode = 1;
}
if (!WRITE) console.log("\nDry run. Re-run with --write to apply.");
