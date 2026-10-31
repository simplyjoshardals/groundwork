/**
 * TEMPORARY route for Task 0.5 (provider spike). Delete it, and rotate
 * SPIKE_TOKEN, once docs/spikes/provider.md is complete.
 *
 * - Disabled (404) unless SPIKE_TOKEN is set on the server.
 * - Every request needs the token in the `x-spike-token` header.
 * - Inputs are validated with the same bounds as the CLI runner.
 * - Only measurements are returned: never vectors, keys, or raw headers.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  runEmbedBenchmark,
  runEmbedProbe,
  runStreamBenchmark,
} from "@/spikes/provider/benchmarks";
import {
  geminiConfig,
  groqConfig,
  MissingEnvError,
} from "@/spikes/provider/env";
import { createGeminiProvider } from "@/spikes/provider/gemini";
import { createGroqProvider } from "@/spikes/provider/groq";
import { SERVER_POLICY } from "@/spikes/provider/http";
import { parseSpikeRequest } from "@/spikes/provider/request";

// Set explicitly (task 0.8 confirms the plan's real limit against Vercel's docs).
export const maxDuration = 60;

const MIN_TOKEN_LENGTH = 16;
/** Leave headroom below maxDuration for the last batch plus the response. */
const EMBED_BUDGET_MS = 40_000;

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be valid JSON." }, 400);
  }
  const parsed = parseSpikeRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const spike = parsed.value;

  try {
    if (spike.task === "embed-probe") {
      const result = await runEmbedProbe({
        config: geminiConfig(),
        model: spike.model,
        policy: SERVER_POLICY,
      });
      return json(result, 200);
    }

    if (spike.task === "embed-100") {
      const result = await runEmbedBenchmark({
        config: geminiConfig(),
        model: spike.model,
        chunkCount: spike.chunks,
        batchSize: spike.batchSize,
        delayMs: spike.delayMs,
        policy: SERVER_POLICY,
        budgetMs: EMBED_BUDGET_MS,
      });
      return json(result, 200);
    }

    const provider =
      spike.provider === "gemini"
        ? createGeminiProvider(geminiConfig())
        : createGroqProvider(groqConfig());

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (line: unknown): void => {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        };
        try {
          const summary = await runStreamBenchmark({
            provider,
            model: spike.model,
            prompt: spike.prompt,
            passages: spike.passages,
            maxOutputTokens: spike.maxOutputTokens,
            reasoningEffort: spike.reasoningEffort,
            policy: SERVER_POLICY,
            onEvent: (event, serverMs) => {
              if (event.kind === "text") {
                send({
                  type: "delta",
                  kind: "text",
                  text: event.text,
                  serverMs,
                });
              } else if (event.kind === "reasoning") {
                send({
                  type: "delta",
                  kind: "reasoning",
                  chars: event.chars,
                  serverMs,
                });
              }
            },
          });
          send({ type: "summary", ...summary });
        } catch {
          send({
            type: "error",
            error: "Stream benchmark failed unexpectedly.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
      },
    });
  } catch (error) {
    if (error instanceof MissingEnvError) {
      // Names the missing variable only, never a value.
      return json({ error: error.message }, 500);
    }
    return json({ error: "Spike route failed unexpectedly." }, 500);
  }
}
