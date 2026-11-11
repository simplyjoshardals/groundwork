import "server-only";
import {
  badRequest,
  ProviderError,
  providerErrorFromStatus,
  unavailable,
  type ProviderName,
} from "./errors";
import { groqApiKey, optionalEnv } from "./env";
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

const PROVIDER: ProviderName = "groq";
const BASE_URL = "https://api.groq.com/openai/v1";

/**
 * PROVISIONAL fallback model, the one the Task 0.5 spike streamed through the
 * same interface (docs/spikes/provider.md, section 5.4). Override with the
 * `model` option or `GROQ_LLM_MODEL`.
 */
export const DEFAULT_GROQ_LLM_MODEL = "openai/gpt-oss-120b";

/** Groq ids contain a slash (`openai/gpt-oss-120b`); the id goes in the body, not a URL. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;

export interface GroqLlmOptions {
  /** Takes precedence over `GROQ_LLM_MODEL`, which takes precedence over the default. */
  model?: string;
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
}

/**
 * Groq's models answer with habits the app does not expect (spike findings,
 * docs/spikes/provider.md): full-width citation brackets `【3】` and narrow or
 * no-break spaces. Both are single characters, so replacing them token by
 * token is safe however the stream is split. Markdown emphasis is NOT touched:
 * `**` can straddle two tokens and stripping it is outside Task 5.5.
 */
export function normalizeGroqText(text: string): string {
  return text
    .replace(/【/g, "[")
    .replace(/】/g, "]")
    .replace(/[\u202F\u00A0]/g, " ");
}

// ---------------------------------------------------------------- request

function buildRequestBody(
  model: string,
  messages: readonly LlmMessage[],
  maxOutputTokens: number | undefined,
): string {
  if (messages.length === 0) {
    throw badRequest(PROVIDER, "at least one message is required");
  }
  for (const message of messages) {
    if (typeof message.content !== "string" || message.content.trim() === "") {
      throw badRequest(PROVIDER, "a message had no content");
    }
  }
  if (
    maxOutputTokens !== undefined &&
    (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1)
  ) {
    throw badRequest(PROVIDER, "maxOutputTokens must be a positive integer");
  }

  return JSON.stringify({
    model,
    stream: true,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    ...(maxOutputTokens !== undefined
      ? { max_completion_tokens: maxOutputTokens }
      : {}),
    // gpt-oss models think before answering and the thinking counts against
    // Groq's small free token limits, so keep it short. Only sent to models
    // that take the setting; others would reject it.
    ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
  });
}

// --------------------------------------------------------------- response

function normalizeFinishReason(reason: string): LlmFinishReason {
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  if (reason === "content_filter") return "blocked";
  return "other";
}

interface ParsedChunk {
  text: string | null;
  finishReason: string | null;
  usage: LlmUsage | null;
}

/** An error object can arrive inside a 200 stream. Map it like an HTTP error. */
function throwIfErrorChunk(json: JsonRecord): void {
  if (!isRecord(json.error)) return;
  const code = getNumber(json.error.status) ?? getNumber(json.error.code);
  if (code === null || code < 400) {
    throw unavailable(PROVIDER, "stream reported an error");
  }
  throw providerErrorFromStatus({ provider: PROVIDER, status: code });
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

  let text: string | null = null;
  let finishReason: string | null = null;
  const choice = getArray(json.choices)[0];
  if (isRecord(choice)) {
    const delta = isRecord(choice.delta) ? choice.delta : null;
    // Reasoning arrives in separate fields (`reasoning`, `reasoning_content`)
    // and is never part of the answer, so only `content` is read.
    const content = delta ? getString(delta.content) : null;
    if (content !== null && content !== "") text = normalizeGroqText(content);
    finishReason = getString(choice.finish_reason);
  }

  const usageSource = isRecord(json.usage)
    ? json.usage
    : isRecord(json.x_groq) && isRecord(json.x_groq.usage)
      ? json.x_groq.usage
      : null;
  const usage: LlmUsage | null = usageSource
    ? {
        promptTokens: getNumber(usageSource.prompt_tokens),
        completionTokens: getNumber(usageSource.completion_tokens),
      }
    : null;

  return { text, finishReason, usage };
}

async function* parseStream(
  body: ReadableStream<Uint8Array>,
  callerSignal: AbortSignal | undefined,
): AsyncGenerator<LlmStreamEvent> {
  let finishReason: string | null = null;
  let usage: LlmUsage | null = null;

  try {
    for await (const data of readSseData(body)) {
      if (data === "[DONE]") break;
      const chunk = parseChunk(data);
      if (chunk.text !== null) yield { type: "text", text: chunk.text };
      finishReason = chunk.finishReason ?? finishReason;
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

  if (finishReason === null) {
    // A silent cut-off must not look like a complete answer.
    throw unavailable(PROVIDER, "stream ended without a finish reason");
  }
  yield {
    type: "finish",
    reason: normalizeFinishReason(finishReason),
    ...(usage ? { usage } : {}),
  };
}

// ---------------------------------------------------------------- factory

export function createGroqLlmProvider(
  options: GroqLlmOptions = {},
): LlmProvider {
  const model =
    options.model ?? optionalEnv("GROQ_LLM_MODEL") ?? DEFAULT_GROQ_LLM_MODEL;
  if (!MODEL_ID.test(model)) {
    throw new Error("Invalid Groq LLM model id (option or GROQ_LLM_MODEL).");
  }
  const policy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const timeoutMs = options.timeoutMs ?? 90_000;

  return {
    model,
    async *stream(messages, streamOptions = {}) {
      const body = buildRequestBody(
        model,
        messages,
        streamOptions.maxOutputTokens,
      );
      const response = await postWithRetry({
        provider: PROVIDER,
        url: `${BASE_URL}/chat/completions`,
        headers: {
          authorization: `Bearer ${groqApiKey()}`,
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
