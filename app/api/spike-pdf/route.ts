/**
 * TEMPORARY route for Task 0.6 (PDF extraction spike). Delete it, and rotate
 * SPIKE_TOKEN, once docs/spikes/pdf.md is complete.
 *
 * - Disabled (404) unless SPIKE_TOKEN is set on the server.
 * - Every request needs the token in the `x-spike-token` header.
 * - Body: the raw PDF bytes (`Content-Type: application/pdf`).
 * - Query: `text=none|full` (default none).
 * - Only measurements and page text of the synthetic test files are returned.
 *   Library error messages are never forwarded: only a stable error code.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { PdfErrorCode } from "@/spikes/pdf/extract";
import {
  type InstanceInfo,
  parseTextMode,
  toPageReports,
} from "@/spikes/pdf/protocol";
import { round } from "@/spikes/provider/util";

// Set explicitly (task 0.8 confirms the plan's real limit against Vercel's docs).
export const maxDuration = 60;

const MIN_TOKEN_LENGTH = 16;
/** Vercel rejects larger request bodies before they reach a function (to be verified). */
const MAX_BODY_BYTES = 4_400_000;

const STATUS_BY_CODE: Record<PdfErrorCode, number> = {
  not_pdf: 415,
  too_large: 413,
  too_many_pages: 422,
  encrypted: 422,
  corrupt: 422,
  unexpected: 500,
};

// Module-level state: survives between requests on the same server instance,
// which is what makes a cold start observable.
const instanceStartedAt = performance.now();
let invocations = 0;

// The extraction module (and the PDF.js bundle behind it) is loaded on first
// use, so its load time can be measured as part of the cold start.
type ExtractModule = typeof import("@/spikes/pdf/extract");
let extractModule: Promise<ExtractModule> | null = null;

async function loadExtractModule(): Promise<{
  mod: ExtractModule;
  importMs: number;
}> {
  if (extractModule) return { mod: await extractModule, importMs: 0 };
  const started = performance.now();
  extractModule = import("@/spikes/pdf/extract");
  try {
    const mod = await extractModule;
    return { mod, importMs: round(performance.now() - started, 1) };
  } catch (error) {
    extractModule = null; // let the next request retry
    throw error;
  }
}

function tokensMatch(provided: string, expected: string): boolean {
  // Hash first so both buffers have equal length for timingSafeEqual.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const handlerStarted = performance.now();
  const expected = process.env.SPIKE_TOKEN;
  if (!expected) return new Response("Not found", { status: 404 });
  if (expected.length < MIN_TOKEN_LENGTH) {
    return json(
      { error: "SPIKE_TOKEN is too short (min 16 characters)." },
      500,
    );
  }
  if (!tokensMatch(request.headers.get("x-spike-token") ?? "", expected)) {
    return json({ error: "Unauthorized." }, 401);
  }

  const mode = parseTextMode(new URL(request.url).searchParams.get("text"));
  if (mode === null) return json({ error: "text must be none or full." }, 400);

  if (
    !(request.headers.get("content-type") ?? "").startsWith("application/pdf")
  ) {
    return json({ error: "Content-Type must be application/pdf." }, 415);
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: "Body too large." }, 413);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return json({ error: "Could not read the request body." }, 400);
  }
  if (bytes.byteLength === 0) return json({ error: "Empty body." }, 400);
  if (bytes.byteLength > MAX_BODY_BYTES) {
    return json({ error: "Body too large." }, 413);
  }

  invocations += 1;
  const invocation = invocations;
  const instance = (importMs: number): InstanceInfo => ({
    coldStart: invocation === 1,
    importMs,
    instanceUptimeMs: Math.round(performance.now() - instanceStartedAt),
    invocation,
    node: process.version,
    region: process.env.VERCEL_REGION ?? null,
  });

  let importMs = 0;
  try {
    const loaded = await loadExtractModule();
    importMs = loaded.importMs;
    const result = await loaded.mod.extractPdf(bytes, {
      maxBytes: MAX_BODY_BYTES,
    });
    return json(
      {
        ok: true,
        instance: instance(importMs),
        serverMs: round(performance.now() - handlerStarted, 1),
        bytes: bytes.byteLength,
        pageCount: result.pageCount,
        totalChars: result.totalChars,
        avgCharsPerPage: result.avgCharsPerPage,
        likelyScanned: result.likelyScanned,
        timings: result.timings,
        pages: toPageReports(result.pages, mode),
      },
      200,
    );
  } catch (error) {
    // Errors thrown by extractPdf are already controlled; the rest are not.
    const known = isControlledError(error);
    const code: PdfErrorCode = known ? error.code : "unexpected";
    if (!known) {
      // Name only: never the message or stack of a library error.
      console.error(
        "spike-pdf unexpected failure:",
        error instanceof Error ? error.name : "unknown",
      );
    }
    return json(
      {
        ok: false,
        instance: instance(importMs),
        serverMs: round(performance.now() - handlerStarted, 1),
        bytes: bytes.byteLength,
        error: {
          code,
          message: known
            ? error.message
            : "Unexpected error while reading the PDF.",
        },
      },
      STATUS_BY_CODE[code],
    );
  }
}

function isControlledError(
  error: unknown,
): error is Error & { code: PdfErrorCode } {
  if (
    !(error instanceof Error) ||
    error.name !== "PdfExtractionError" ||
    !("code" in error)
  ) {
    return false;
  }
  return typeof error.code === "string" && error.code in STATUS_BY_CODE;
}
