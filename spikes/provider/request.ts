import { isRecord } from "./util";

export type ProviderName = "gemini" | "groq";
export type PromptKind = "short" | "rag";

export type SpikeRequest =
  | { task: "embed-probe"; model: string }
  | {
      task: "embed-100";
      model: string;
      batchSize: number;
      delayMs: number;
      chunks: number;
    }
  | {
      task: "stream";
      provider: ProviderName;
      model: string;
      prompt: PromptKind;
      passages: number;
      maxOutputTokens: number;
      reasoningEffort: string | null;
    };

export type ParseResult =
  { ok: true; value: SpikeRequest } | { ok: false; error: string };

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:-]{0,79}$/;
const EFFORT = /^[a-z]{1,16}$/;

function intInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

/**
 * Validates untrusted input for both the CLI runner and the HTTP route, so
 * the same bounds apply everywhere. Bounds keep a leaked token from being
 * able to burn the free quota quickly.
 */
export function parseSpikeRequest(body: unknown): ParseResult {
  if (!isRecord(body))
    return { ok: false, error: "Body must be a JSON object." };

  const model = body.model;
  if (typeof model !== "string" || !MODEL_ID.test(model)) {
    return { ok: false, error: "Invalid or missing model id." };
  }

  switch (body.task) {
    case "embed-probe":
      return { ok: true, value: { task: "embed-probe", model } };

    case "embed-100": {
      const batchSize = intInRange(body.batchSize, 20, 1, 100);
      const delayMs = intInRange(body.delayMs, 0, 0, 10_000);
      const chunks = intInRange(body.chunks, 100, 1, 100);
      if (batchSize === null)
        return { ok: false, error: "batchSize must be 1-100." };
      if (delayMs === null)
        return { ok: false, error: "delayMs must be 0-10000." };
      if (chunks === null) return { ok: false, error: "chunks must be 1-100." };
      return {
        ok: true,
        value: { task: "embed-100", model, batchSize, delayMs, chunks },
      };
    }

    case "stream": {
      if (body.provider !== "gemini" && body.provider !== "groq") {
        return { ok: false, error: "provider must be gemini or groq." };
      }
      const prompt = body.prompt ?? "short";
      if (prompt !== "short" && prompt !== "rag") {
        return { ok: false, error: "prompt must be short or rag." };
      }
      const passages = intInRange(body.passages, 12, 1, 30);
      const maxOutputTokens = intInRange(body.maxOutputTokens, 600, 16, 2000);
      if (passages === null)
        return { ok: false, error: "passages must be 1-30." };
      if (maxOutputTokens === null) {
        return { ok: false, error: "maxOutputTokens must be 16-2000." };
      }
      const effort = body.reasoningEffort ?? null;
      if (
        effort !== null &&
        (typeof effort !== "string" || !EFFORT.test(effort))
      ) {
        return { ok: false, error: "Invalid reasoningEffort." };
      }
      return {
        ok: true,
        value: {
          task: "stream",
          provider: body.provider,
          model,
          prompt,
          passages,
          maxOutputTokens,
          reasoningEffort: effort,
        },
      };
    }

    default:
      return { ok: false, error: "Unknown task." };
  }
}
