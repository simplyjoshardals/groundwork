/**
 * U6 bundle check: first-load JavaScript, gzipped, for the landing page and
 * the signed-in app route, against the targets in BUILD_PLAN (about 100 kB and
 * about 170 kB), plus a check that PDF.js is not in either.
 *
 * "First-load JS" is what Next means by it: the scripts the server's HTML asks
 * for up front (`<script src>` and script preloads, minus `nomodule`
 * polyfills), not chunks that load later or are prefetched for other routes.
 * Each file is gzipped here at the default level, which is what `next start`
 * serves; a CDN that serves brotli will send less. 1 kB = 1000 bytes.
 *
 * Why a script and not `@next/bundle-analyzer`: this project builds with
 * Turbopack, which that plugin does not support, and Next 16's own analyzer
 * (`next experimental-analyze`) is a treemap, not numbers. Use it to find out
 * why a target is missed, then come back here to re-measure.
 *
 * Usage (two terminals):
 *   1. yarn build && yarn start -p 3100
 *   2. yarn bundle:size            (BASE_URL=http://localhost:3100 by default)
 *
 * The app route needs a demo session, so the local Supabase and the Turnstile
 * test keys must be up, exactly as for the e2e suite.
 */
import { gzipSync } from "node:zlib";
import { chromium, request, type APIRequestContext } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3100";
const TARGET_KB = { landing: 100, app: 170 } as const;
/**
 * Context for those targets: a bare Next 16.4.5 page (one `<h1>`, no
 * libraries) measured 134 kB gzipped first-load with Turbopack. Everything
 * above that is this app's own weight.
 */
const FRAMEWORK_FLOOR_KB = 134;
/** What a chunk contains, from strings that survive minification. */
const FINGERPRINTS: readonly (readonly [string, RegExp])[] = [
  ["react-dom", /react\.dev\/errors|Minified React error/],
  ["next client", /__next_f|__NEXT_DATA__|next-router-state-tree/i],
  ["supabase auth/client", /GoTrueClient|supabase-js-|sb-[a-z]+-auth-token/],
  ["supabase realtime", /RealtimeClient|phoenix/i],
  ["supabase postgrest", /PostgrestClient|postgrest-js/],
  ["turnstile", /challenges\.cloudflare\.com/],
  ["zod", /invalid_type|ZodError/],
];
/** Strings only PDF.js's bundles contain. */
const PDF_JS = /pdfjs-dist|PDFWorker|GlobalWorkerOptions/;

interface Chunk {
  path: string;
  gzipBytes: number;
  hasPdfJs: boolean;
  contains: string[];
}

interface Measurement {
  html: string;
  chunks: Chunk[];
}

/** The script URLs the HTML loads on first paint, `nomodule` ones excluded. */
function firstLoadScripts(html: string): string[] {
  const urls = new Set<string>();
  for (const tag of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const [, name, attributes] = tag;
    if (/\bnomodule\b/i.test(attributes)) continue;
    if (name.toLowerCase() === "link" && !/\bas="script"/i.test(attributes)) {
      continue;
    }
    const url = /\b(?:src|href)="(\/_next\/static\/[^"]+)"/i.exec(
      attributes,
    )?.[1];
    if (url && url.split("?")[0].endsWith(".js")) urls.add(url);
  }
  return [...urls];
}

async function measure(api: APIRequestContext): Promise<Measurement> {
  const page = await api.get("/");
  if (!page.ok()) throw new Error(`GET / answered ${page.status()}`);
  const html = await page.text();
  const chunks: Chunk[] = [];
  for (const url of firstLoadScripts(html)) {
    const response = await api.get(url);
    if (!response.ok())
      throw new Error(`GET ${url} answered ${response.status()}`);
    const body = await response.body();
    const text = body.toString("utf8");
    chunks.push({
      path: url.split("?")[0],
      gzipBytes: gzipSync(body).length,
      hasPdfJs: PDF_JS.test(text),
      contains: FINGERPRINTS.filter(([, pattern]) => pattern.test(text)).map(
        ([name]) => name,
      ),
    });
  }
  return { html, chunks };
}

function kb(bytes: number): string {
  return (bytes / 1000).toFixed(1);
}

function report(
  name: string,
  { chunks }: Measurement,
  targetKb: number,
): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
  const verdict = total / 1000 <= targetKb ? "within target" : "TARGET MISSED";
  const pdf = chunks.filter((chunk) => chunk.hasPdfJs);
  console.log(
    `\n${name}: ${kb(total)} kB gzipped in ${chunks.length} files (target about ${targetKb} kB): ${verdict}`,
  );
  console.log(
    `  ${kb(total - FRAMEWORK_FLOOR_KB * 1000)} kB above a bare Next 16.4.5 page (${FRAMEWORK_FLOOR_KB} kB).`,
  );
  for (const chunk of [...chunks]
    .sort((a, b) => b.gzipBytes - a.gzipBytes)
    .slice(0, 6)) {
    console.log(
      `  ${kb(chunk.gzipBytes).padStart(6)} kB  ${chunk.path}  [${chunk.contains.join(", ") || "app code or other"}]`,
    );
  }
  console.log(
    pdf.length === 0
      ? "  PDF.js is not in the first load."
      : `  PDF.js IS in the first load: ${pdf.map((chunk) => chunk.path).join(", ")}`,
  );
  return `| ${name} | ${kb(total)} kB | about ${targetKb} kB | ${verdict} | ${pdf.length === 0 ? "not in first load" : "IN FIRST LOAD"} |`;
}

/** The set of files, to tell whether two routes were served the same page. */
function fileSet(measurement: Measurement): string {
  return measurement.chunks
    .map((chunk) => chunk.path)
    .sort()
    .join("\n");
}

async function main(): Promise<void> {
  // Landing page: no session, no browser needed.
  const anonymous = await request.newContext({ baseURL: BASE_URL });
  const landing = await measure(anonymous);
  await anonymous.dispose();

  // App route: start a demo session in a browser, then ask for `/` with its cookies.
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await page.goto("/");
    const button = page
      .getByRole("main")
      .getByRole("button", { name: "Try demo", exact: true });
    await button.waitFor();
    // Enabled only once the Turnstile widget has produced a token.
    const deadline = Date.now() + 30_000;
    while (!(await button.isEnabled())) {
      if (Date.now() > deadline) {
        throw new Error(
          "Try demo never became enabled. Is Turnstile configured?",
        );
      }
      await page.waitForTimeout(250);
    }
    await button.click();
    await page
      .getByRole("heading", { name: "Sample documents" })
      .waitFor({ timeout: 30_000 });
    const app = await measure(context.request);

    // Prove each measurement is of the page it is named for.
    console.log(
      `\nSigned-out HTML shows the demo button: ${landing.html.includes("Try demo")}; shows the signed-in shelf: ${landing.html.includes("Sample documents")}`,
    );
    console.log(
      `Signed-in HTML shows the signed-in shelf: ${app.html.includes("Sample documents")}`,
    );
    if (fileSet(landing) === fileSet(app)) {
      console.log(
        "Both routes load exactly the same scripts. If the signed-in HTML above does not show the shelf, the session was not applied and the app number is the landing page's.",
      );
    }

    const rows = [
      report("Landing page (signed out)", landing, TARGET_KB.landing),
      report("App route (demo session)", app, TARGET_KB.app),
    ];
    console.log(
      `\nFor docs/decisions.md:\n\n| Route | First-load JS (gzip) | Target | Result | PDF.js |\n|---|---|---|---|---|\n${rows.join("\n")}\n`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
