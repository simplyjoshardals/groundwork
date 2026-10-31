/**
 * CLI runner for Task 0.5 (provider spike).
 *
 *   yarn spike:provider --task=discover
 *   yarn spike:provider --task=embed-probe --model=<embedding model id>
 *   yarn spike:provider --task=embed-100  --model=<id> [--batch=20 --delay-ms=0]
 *   yarn spike:provider --task=stream --provider=gemini|groq --model=<id>
 *                       [--prompt=short|rag --passages=12 --max-tokens=600 --reasoning-effort=low]
 *
 * Add `--target=deployed --base-url=https://<your-app>.vercel.app` to run the
 * same task through the deployed /api/spike route (needs SPIKE_TOKEN).
 *
 * Credentials come from .env.local (loaded by `tsx --env-file`). Nothing
 * secret is ever printed or written: only the whitelisted response headers
 * and the measurements.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  runEmbedBenchmark,
  runEmbedProbe,
  runStreamBenchmark,
} from "./benchmarks";
import { geminiConfig, groqConfig, MissingEnvError, requireEnv } from "./env";
import { createGeminiProvider, listGeminiModels } from "./gemini";
import { createGroqProvider, listGroqModels } from "./groq";
import { LOCAL_POLICY } from "./http";
import { parseSpikeRequest, type SpikeRequest } from "./request";
import { isRecord, pickSafeHeaders, round, truncate } from "./util";

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

function optionalInt(args: CliArgs, key: string): number | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`--${key} must be an integer.`);
  return value;
}

function buildRequest(args: CliArgs): SpikeRequest {
  const parsed = parseSpikeRequest({
    task: args.task,
    model: args.model,
    provider: args.provider,
    prompt: args.prompt,
    passages: optionalInt(args, "passages"),
    maxOutputTokens: optionalInt(args, "max-tokens"),
    reasoningEffort: args["reasoning-effort"],
    batchSize: optionalInt(args, "batch"),
    delayMs: optionalInt(args, "delay-ms"),
    chunks: optionalInt(args, "chunks"),
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

// ------------------------------------------------------------- local runs

async function runDiscover(): Promise<unknown> {
  const out: Record<string, unknown> = {};

  try {
    const result = await listGeminiModels(geminiConfig(), LOCAL_POLICY);
    out.gemini = result.ok
      ? {
          ok: true,
          embeddingModels: result.models
            .filter((m) => /embed/i.test(m.id))
            .map((m) => ({
              id: m.id,
              version: m.version,
              methods: m.methods,
              inputTokenLimit: m.inputTokenLimit,
            })),
          generateModels: result.models
            .filter(
              (m) =>
                m.methods.includes("generateContent") && !/embed/i.test(m.id),
            )
            .map((m) => ({ id: m.id, version: m.version })),
        }
      : {
          ok: false,
          status: result.status,
          error: result.error,
          attempts: result.attempts,
        };
  } catch (error) {
    out.gemini = {
      ok: false,
      error: error instanceof Error ? error.message : "error",
    };
  }

  try {
    const result = await listGroqModels(groqConfig(), LOCAL_POLICY);
    out.groq = result.ok
      ? { ok: true, models: result.models }
      : {
          ok: false,
          status: result.status,
          error: result.error,
          attempts: result.attempts,
        };
  } catch (error) {
    out.groq = {
      ok: false,
      error: error instanceof Error ? error.message : "error",
    };
  }
  return out;
}

async function runLocal(request: SpikeRequest): Promise<unknown> {
  switch (request.task) {
    case "embed-probe":
      return runEmbedProbe({
        config: geminiConfig(),
        model: request.model,
        policy: LOCAL_POLICY,
      });
    case "embed-100":
      return runEmbedBenchmark({
        config: geminiConfig(),
        model: request.model,
        chunkCount: request.chunks,
        batchSize: request.batchSize,
        delayMs: request.delayMs,
        policy: LOCAL_POLICY,
        budgetMs: 10 * 60_000,
      });
    case "stream":
      return runStreamBenchmark({
        provider:
          request.provider === "gemini"
            ? createGeminiProvider(geminiConfig())
            : createGroqProvider(groqConfig()),
        model: request.model,
        prompt: request.prompt,
        passages: request.passages,
        maxOutputTokens: request.maxOutputTokens,
        reasoningEffort: request.reasoningEffort,
        policy: LOCAL_POLICY,
      });
  }
}

// ---------------------------------------------------------- deployed runs

function deployedUrl(baseUrl: string | undefined): URL {
  if (!baseUrl) {
    throw new Error(
      "Deployed runs need --base-url=https://<app>.vercel.app (or SPIKE_BASE_URL).",
    );
  }
  const url = new URL("/api/spike", baseUrl);
  const isLocalhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !isLocalhost) {
    throw new Error("The deployed URL must use https.");
  }
  return url;
}

async function runDeployed(
  request: SpikeRequest,
  url: URL,
  token: string,
): Promise<unknown> {
  const started = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-spike-token": token },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(120_000),
  });
  const routeHeaders = pickSafeHeaders(response.headers);

  if (!response.ok || !response.body) {
    return {
      ok: false,
      httpStatus: response.status,
      routeHeaders,
      body: truncate(await response.text().catch(() => ""), 300),
    };
  }

  if (request.task !== "stream") {
    const json: unknown = await response.json();
    return {
      httpStatus: response.status,
      roundTripMs: Math.round(performance.now() - started),
      routeHeaders,
      result: json,
    };
  }

  // NDJSON stream: measure when each line ACTUALLY ARRIVES at the client.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reads = 0;
  let readsWithText = 0;
  let firstByteMs: number | null = null;
  const textArrivals: number[] = [];
  let summary: unknown = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const at = Math.round(performance.now() - started);
    reads++;
    firstByteMs ??= at;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    let sawText = false;
    for (const line of lines) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(parsed)) continue;
      if (parsed.type === "delta" && parsed.kind === "text") {
        textArrivals.push(at);
        sawText = true;
      } else if (parsed.type === "summary" || parsed.type === "error") {
        summary = parsed;
      }
    }
    if (sawText) readsWithText++;
  }

  const first = textArrivals[0] ?? null;
  const last = textArrivals[textArrivals.length - 1] ?? null;
  const spreadMs = first !== null && last !== null ? last - first : null;
  return {
    httpStatus: response.status,
    routeHeaders,
    client: {
      firstByteMs,
      firstTextAtMs: first,
      lastTextAtMs: last,
      totalMs: Math.round(performance.now() - started),
      textDeltaCount: textArrivals.length,
      networkReads: reads,
      readsContainingText: readsWithText,
      textSpreadMs: spreadMs,
      // Heuristic only: text spread over time and over several reads means it was not buffered.
      incrementalDelivery:
        spreadMs !== null && readsWithText >= 3 && spreadMs >= 300
          ? "yes (heuristic)"
          : "unclear: few deltas or short spread; check readsContainingText",
    },
    server: summary,
  };
}

// ------------------------------------------------------------------- main

async function writeResult(label: string, payload: unknown): Promise<string> {
  const dir = path.join(process.cwd(), "spikes", "provider", "results");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label.replace(/[^A-Za-z0-9._-]+/g, "_");
  const file = path.join(dir, `${stamp}-${safeLabel}.json`);
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target ?? "local";
  if (target !== "local" && target !== "deployed") {
    throw new Error("--target must be local or deployed.");
  }

  const startedAt = new Date();
  let result: unknown;
  let label: string;

  if (args.task === "discover") {
    if (target === "deployed") throw new Error("discover runs locally only.");
    result = await runDiscover();
    label = "discover-local";
  } else {
    const request = buildRequest(args);
    label = `${request.task}-${target}-${request.model}`;
    if (target === "local") {
      result = await runLocal(request);
    } else {
      const url = deployedUrl(args["base-url"] ?? process.env.SPIKE_BASE_URL);
      result = await runDeployed(request, url, requireEnv("SPIKE_TOKEN"));
    }
  }

  const envelope = {
    meta: {
      startedAtUtc: startedAt.toISOString(),
      target,
      task: args.task,
      node: process.version,
      elapsedMs: round(Date.now() - startedAt.getTime(), 0),
    },
    result,
  };
  console.log(JSON.stringify(envelope, null, 2));
  const file = await writeResult(label, envelope);
  console.error(`\nSaved: ${path.relative(process.cwd(), file)}`);
}

main().catch((error: unknown) => {
  // Print the message only: never the error object, which could carry request details.
  const message =
    error instanceof MissingEnvError || error instanceof Error
      ? error.message
      : "Unexpected error.";
  console.error(`spike failed: ${message}`);
  process.exitCode = 1;
});
