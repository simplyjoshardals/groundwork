/**
 * CLI runner for Task 0.6 (PDF extraction spike).
 *
 *   yarn spike:pdf --file=spikes/pdf/fixtures/single-column.pdf
 *   yarn spike:pdf --file=<pdf> --target=deployed --base-url=https://<app>.vercel.app
 *                  [--expected=<file>.expected.json] [--repeat=3 --pause-ms=0]
 *
 * Local runs call the extraction code directly. Deployed runs POST the file
 * to /api/spike-pdf (needs SPIKE_TOKEN in .env.local). The expected-text file
 * next to the PDF is picked up automatically. Results are saved under
 * spikes/pdf/results/ (git-ignored). The token is never printed or saved.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireEnv } from "../provider/env";
import { isRecord, pickSafeHeaders, round, sleep } from "../provider/util";
import { extractPdf, PdfExtractionError } from "./extract";
import { type PageReport, toPageReports } from "./protocol";
import {
  type ExpectedFile,
  parseExpectedFile,
  type Score,
  scorePages,
} from "./score";

const MAX_FILE_BYTES = 4_400_000;

type CliArgs = Record<string, string>;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq === -1) args[token.slice(2)] = "true";
    else args[token.slice(2, eq)] = token.slice(eq + 1);
  }
  return args;
}

function intArg(
  args: CliArgs,
  key: string,
  fallback: number,
  max: number,
): number {
  const raw = args[key];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`--${key} must be an integer from 0 to ${max}.`);
  }
  return value;
}

interface RunRecord {
  run: number;
  ok: boolean;
  httpStatus: number | null;
  roundTripMs: number | null;
  errorCode: string | null;
  bytes: number;
  pageCount: number | null;
  totalChars: number | null;
  avgCharsPerPage: number | null;
  likelyScanned: boolean | null;
  timings: { loadMs: number; extractMs: number } | null;
  serverMs: number | null;
  instance: unknown;
  routeHeaders: Record<string, string> | null;
  pages: Omit<PageReport, "text">[];
  score: Score | null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function withoutText(pages: PageReport[]): Omit<PageReport, "text">[] {
  return pages.map((p) => ({
    page: p.page,
    chars: p.chars,
    preview: p.preview,
  }));
}

function scoreIfExpected(
  pages: PageReport[],
  expected: ExpectedFile | null,
): Score | null {
  if (!expected) return null;
  return scorePages(
    pages.map((p) => p.text ?? ""),
    expected.pages,
  );
}

async function runLocal(
  bytes: Uint8Array,
  run: number,
  expected: ExpectedFile | null,
): Promise<RunRecord> {
  const started = performance.now();
  const base = {
    run,
    bytes: bytes.byteLength,
    httpStatus: null,
    routeHeaders: null,
    instance: null,
    serverMs: null,
  };
  try {
    const result = await extractPdf(bytes, { maxBytes: MAX_FILE_BYTES });
    const pages = toPageReports(result.pages, "full");
    return {
      ...base,
      ok: true,
      roundTripMs: round(performance.now() - started, 1),
      errorCode: null,
      pageCount: result.pageCount,
      totalChars: result.totalChars,
      avgCharsPerPage: result.avgCharsPerPage,
      likelyScanned: result.likelyScanned,
      timings: result.timings,
      pages: withoutText(pages),
      score: scoreIfExpected(pages, expected),
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      roundTripMs: round(performance.now() - started, 1),
      errorCode:
        error instanceof PdfExtractionError ? error.code : "uncontrolled",
      pageCount: null,
      totalChars: null,
      avgCharsPerPage: null,
      likelyScanned: null,
      timings: null,
      pages: [],
      score: null,
    };
  }
}

async function runDeployed(
  bytes: Uint8Array<ArrayBuffer>,
  run: number,
  url: URL,
  token: string,
  expected: ExpectedFile | null,
): Promise<RunRecord> {
  const started = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/pdf", "x-spike-token": token },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  const roundTripMs = round(performance.now() - started, 1);
  const routeHeaders = pickSafeHeaders(response.headers);
  const raw: unknown = await response.json().catch(() => null);
  const body = isRecord(raw) ? raw : {};
  const error = isRecord(body.error) ? body.error : null;
  const rawPages = Array.isArray(body.pages) ? body.pages : [];
  const pages: PageReport[] = rawPages.flatMap((p: unknown) =>
    isRecord(p) && typeof p.page === "number" && typeof p.chars === "number"
      ? [
          {
            page: p.page,
            chars: p.chars,
            preview: typeof p.preview === "string" ? p.preview : "",
            ...(typeof p.text === "string" ? { text: p.text } : {}),
          },
        ]
      : [],
  );
  const timings = isRecord(body.timings)
    ? {
        loadMs: numberOrNull(body.timings.loadMs) ?? 0,
        extractMs: numberOrNull(body.timings.extractMs) ?? 0,
      }
    : null;
  return {
    run,
    ok: response.ok && body.ok === true,
    httpStatus: response.status,
    roundTripMs,
    errorCode: error && typeof error.code === "string" ? error.code : null,
    bytes: bytes.byteLength,
    pageCount: numberOrNull(body.pageCount),
    totalChars: numberOrNull(body.totalChars),
    avgCharsPerPage: numberOrNull(body.avgCharsPerPage),
    likelyScanned:
      typeof body.likelyScanned === "boolean" ? body.likelyScanned : null,
    timings,
    serverMs: numberOrNull(body.serverMs),
    instance: isRecord(body.instance) ? body.instance : null,
    routeHeaders,
    pages: withoutText(pages),
    score: scoreIfExpected(pages, expected),
  };
}

function deployedUrl(baseUrl: string | undefined): URL {
  if (!baseUrl)
    throw new Error(
      "Deployed runs need --base-url=https://<app>.vercel.app (or SPIKE_BASE_URL).",
    );
  const url = new URL("/api/spike-pdf", baseUrl);
  url.searchParams.set("text", "full");
  const isLocalhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !isLocalhost)
    throw new Error("The deployed URL must use https.");
  return url;
}

async function loadExpected(
  pdfPath: string,
  explicit: string | undefined,
): Promise<ExpectedFile | null> {
  const candidate = explicit ?? pdfPath.replace(/\.pdf$/i, ".expected.json");
  try {
    return parseExpectedFile(
      JSON.parse(await readFile(candidate, "utf8")) as unknown,
    );
  } catch (error) {
    if (explicit) throw error; // an explicit path must work; a guessed one may not exist
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target ?? "local";
  if (target !== "local" && target !== "deployed")
    throw new Error("--target must be local or deployed.");
  const file = args.file;
  if (!file) throw new Error("--file=<path to a PDF> is required.");
  const repeat = intArg(args, "repeat", 1, 20);
  const pauseMs = intArg(args, "pause-ms", 0, 900_000);

  const size = (await stat(file)).size;
  if (size > MAX_FILE_BYTES)
    throw new Error(
      `File is ${size} bytes; the limit here is ${MAX_FILE_BYTES}.`,
    );
  const bytes = Uint8Array.from(await readFile(file));
  const expected = await loadExpected(file, args.expected);

  const url =
    target === "deployed"
      ? deployedUrl(args["base-url"] ?? process.env.SPIKE_BASE_URL)
      : null;
  const token = target === "deployed" ? requireEnv("SPIKE_TOKEN") : "";

  const startedAt = new Date();
  const runs: RunRecord[] = [];
  for (let i = 1; i <= repeat; i++) {
    runs.push(
      url
        ? await runDeployed(bytes, i, url, token, expected)
        : await runLocal(bytes, i, expected),
    );
    if (i < repeat && pauseMs > 0) await sleep(pauseMs);
  }

  const envelope = {
    meta: {
      startedAtUtc: startedAt.toISOString(),
      target,
      file: path.basename(file),
      expectedFile: expected ? expected.file : null,
      node: process.version,
    },
    runs,
  };
  console.log(JSON.stringify(envelope, null, 2));

  const dir = path.join(process.cwd(), "spikes", "pdf", "results");
  await mkdir(dir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const out = path.join(
    dir,
    `${stamp}-${target}-${path.basename(file).replace(/[^A-Za-z0-9._-]+/g, "_")}.json`,
  );
  await writeFile(out, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  console.error(`\nSaved: ${path.relative(process.cwd(), out)}`);
}

main().catch((error: unknown) => {
  // Message only: never the error object, which could carry request details.
  console.error(
    `spike failed: ${error instanceof Error ? error.message : "Unexpected error."}`,
  );
  process.exitCode = 1;
});
