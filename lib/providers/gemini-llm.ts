import "server-only";
import {
  badRequest,
  ProviderError,
  providerErrorFromStatus,
  unavailable,
  type ProviderName,
} from "./errors";
import { geminiApiKey, optionalEnv } from "./env";
import {
  getArray,
  getNumber,
  getString,
  isRecord,
  type JsonRecord,
} from "./guards";
import {
  DEFAULT_RETRY_POLICY,
  describeNetworkError,
  postWithRetry,
  type RetryPolicy,
} from "./http";
import { readSseData } from "./sse";
import type {
  LlmFinishReason,
  LlmMessage,
  LlmProvider,
  LlmStreamEvent,
  LlmUsage,
} from "./types";

const PROVIDER: ProviderName = "gemini";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * PROVISIONAL default. `gemini-3.5-flash-lite` is the model the Task 0.5 spike
 * streamed successfully (one RAG prompt, local and deployed), and the console
 * showed 500 requests/day for it. docs/spikes/provider.md calls the LLM choice
 * provisional and Slice 2's eval is meant to compare candidates, so this is a
 * starting point, not an architectural decision. Override with the `model`
 * option or the `GEMINI_LLM_MODEL` environment variable.
 */
export const DEFAULT_GEMINI_LLM_MODEL = "gemini-3.5-flash-lite";

/** The id goes into a URL path, so it is restricted to a safe character set. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export interface GeminiLlmOptions {
  /** Takes precedence over `GEMINI_LLM_MODEL`, which takes precedence over the default. */
  model?: string;
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
}

// ---------------------------------------------------------------- request

interface GeminiContent {
  role: "user" | "model";
  parts: { text: string }[];
}

function buildRequestBody(
  messages: readonly LlmMessage[],
  maxOutputTokens: number | undefined,
): string {
  const system: string[] = [];
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (typeof message.content !== "string" || message.content.trim() === "") {
      throw badRequest(PROVIDER, "a message had no content");
    }
    if (message.role === "system") system.push(message.content);
    else {
      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      });
    }
  }
  if (contents.length === 0) {
    throw badRequest(
      PROVIDER,
      "at least one user or assistant message is required",
    );
  }
  if (
    maxOutputTokens !== undefined &&
    (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1)
  ) {
    throw badRequest(PROVIDER, "maxOutputTokens must be a positive integer");
  }

  return JSON.stringify({
    ...(system.length > 0
      ? { systemInstruction: { parts: [{ text: system.join("\n\n") }] } }
      : {}),
    contents,
    ...(maxOutputTokens !== undefined
      ? { generationConfig: { maxOutputTokens } }
      : {}),
  });
}

// --------------------------------------------------------------- response

const BLOCKED_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
]);

function normalizeFinishReason(reason: string): LlmFinishReason {
  if (reason === "STOP") return "stop";
  if (reason === "MAX_TOKENS") return "length";
  if (BLOCKED_FINISH_REASONS.has(reason)) return "blocked";
  return "other";
}

interface ParsedChunk {
  texts: string[];
  finishReason: string | null;
  promptBlocked: boolean;
  usage: LlmUsage | null;
}

function parseChunk(data: string): ParsedChunk {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    throw unavailable(
      PROVIDER,
      "stream contained a chunk that was not valid JSON",
    );
  }
  if (!isRecord(json)) {
    throw unavailable(PROVIDER, "stream contained an unexpected chunk");
  }
  throwIfErrorChunk(json);

  const texts: string[] = [];
  let finishReason: string | null = null;
  const candidate = getArray(json.candidates)[0];
  if (isRecord(candidate)) {
    const content = isRecord(candidate.content) ? candidate.content : null;
    for (const part of content ? getArray(content.parts) : []) {
      if (!isRecord(part)) continue;
      const text = getString(part.text);
      // Reasoning ("thought") parts are not part of the answer.
      if (text === null || text === "" || part.thought === true) continue;
      texts.push(text);
    }
    finishReason = getString(candidate.finishReason);
  }

  const feedback = isRecord(json.promptFeedback) ? json.promptFeedback : null;
  const promptBlocked =
    feedback !== null && getString(feedback.blockReason) !== null;

  const usageMetadata = isRecord(json.usageMetadata)
    ? json.usageMetadata
    : null;
  const usage: LlmUsage | null = usageMetadata
    ? {
        promptTokens: getNumber(usageMetadata.promptTokenCount),
        completionTokens: getNumber(usageMetadata.candidatesTokenCount),
      }
    : null;

  return { texts, finishReason, promptBlocked, usage };
}

/** An error object can arrive inside a 200 stream. Map it like an HTTP error. */
function throwIfErrorChunk(json: JsonRecord): void {
  if (!isRecord(json.error)) return;
  const code = getNumber(json.error.code);
  const status = getString(json.error.status);
  if (code === null || code < 400) {
    throw unavailable(PROVIDER, "stream reported an error");
  }
  throw providerErrorFromStatus({
    provider: PROVIDER,
    status: code,
    providerCode:
      status !== null && /^[A-Za-z0-9_.-]{1,64}$/.test(status) ? status : null,
  });
}

async function* parseStream(
  body: ReadableStream<Uint8Array>,
  callerSignal: AbortSignal | undefined,
): AsyncGenerator<LlmStreamEvent> {
  let finishReason: string | null = null;
  let promptBlocked = false;
  let usage: LlmUsage | null = null;

  try {
    for await (const data of readSseData(body)) {
      const chunk = parseChunk(data);
      for (const text of chunk.texts) yield { type: "text", text };
      finishReason = chunk.finishReason ?? finishReason;
      promptBlocked = promptBlocked || chunk.promptBlocked;
      usage = chunk.usage ?? usage;
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (callerSignal?.aborted) throw error;
    throw unavailable(
      PROVIDER,
      `stream interrupted: ${describeNetworkError(error)}`,
    );
  }

  if (finishReason === null && !promptBlocked) {
    // A silent cut-off must not look like a complete answer.
    throw unavailable(PROVIDER, "stream ended without a finish reason");
  }
  yield {
    type: "finish",
    reason: promptBlocked
      ? "blocked"
      : normalizeFinishReason(finishReason ?? ""),
    ...(usage ? { usage } : {}),
  };
}

// ---------------------------------------------------------------- factory

export function createGeminiLlmProvider(
  options: GeminiLlmOptions = {},
): LlmProvider {
  const model =
    options.model ??
    optionalEnv("GEMINI_LLM_MODEL") ??
    DEFAULT_GEMINI_LLM_MODEL;
  if (!MODEL_ID.test(model)) {
    throw new Error(
      "Invalid Gemini LLM model id (option or GEMINI_LLM_MODEL).",
    );
  }
  const policy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const timeoutMs = options.timeoutMs ?? 90_000;

  return {
    model,
    async *stream(messages, streamOptions = {}) {
      const body = buildRequestBody(messages, streamOptions.maxOutputTokens);
      const response = await postWithRetry({
        provider: PROVIDER,
        url: `${BASE_URL}/models/${model}:streamGenerateContent?alt=sse`,
        headers: {
          "x-goog-api-key": geminiApiKey(),
          "content-type": "application/json",
        },
        body,
        timeoutMs,
        policy,
        signal: streamOptions.signal,
      });
      if (!response.body) {
        throw unavailable(PROVIDER, "streaming response had no body");
      }
      yield* parseStream(response.body, streamOptions.signal);
    },
  };
}
