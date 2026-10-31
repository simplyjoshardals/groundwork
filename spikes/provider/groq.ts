import type { ProviderConfig } from "./env";
import {
  fetchWithRetry,
  type HttpAttempt,
  type HttpFailure,
  type RetryPolicy,
} from "./http";
import type { LlmProvider, LlmStreamRequest, StreamEvent } from "./llm";
import { getArray, getNumber, getString, isRecord, readSseData } from "./util";

function headersFor(config: ProviderConfig): Record<string, string> {
  return {
    authorization: `Bearer ${config.apiKey}`,
    "content-type": "application/json",
  };
}

export interface GroqModelInfo {
  id: string;
  ownedBy: string | null;
  active: boolean | null;
  contextWindow: number | null;
}

export type GroqModelsResult =
  { ok: true; models: GroqModelInfo[]; attempts: HttpAttempt[] } | HttpFailure;

export async function listGroqModels(
  config: ProviderConfig,
  policy: RetryPolicy,
): Promise<GroqModelsResult> {
  const result = await fetchWithRetry(
    `${config.baseUrl}/models`,
    { headers: headersFor(config), signal: AbortSignal.timeout(30_000) },
    policy,
  );
  if (!result.ok) return result;

  const json: unknown = await result.response.json();
  const models: GroqModelInfo[] = [];
  for (const item of isRecord(json) ? getArray(json.data) : []) {
    if (!isRecord(item)) continue;
    const id = getString(item.id);
    if (!id) continue;
    models.push({
      id,
      ownedBy: getString(item.owned_by),
      active: typeof item.active === "boolean" ? item.active : null,
      contextWindow: getNumber(item.context_window),
    });
  }
  return { ok: true, models, attempts: result.attempts };
}

function* eventsFromChunk(json: unknown): Generator<StreamEvent> {
  if (!isRecord(json)) return;
  const choice = getArray(json.choices)[0];
  if (isRecord(choice)) {
    const delta = isRecord(choice.delta) ? choice.delta : null;
    if (delta) {
      // Reasoning models may stream their thinking in a separate field.
      const reasoning =
        getString(delta.reasoning) ?? getString(delta.reasoning_content);
      if (reasoning) yield { kind: "reasoning", chars: reasoning.length };
      const content = getString(delta.content);
      if (content) yield { kind: "text", text: content };
    }
    const reason = getString(choice.finish_reason);
    if (reason) yield { kind: "finish", reason };
  }
  const usage = isRecord(json.usage)
    ? json.usage
    : isRecord(json.x_groq) && isRecord(json.x_groq.usage)
      ? json.x_groq.usage
      : null;
  if (usage) {
    yield {
      kind: "usage",
      promptTokens: getNumber(usage.prompt_tokens),
      completionTokens: getNumber(usage.completion_tokens),
      totalTokens: getNumber(usage.total_tokens),
    };
  }
}

async function* streamEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  for await (const data of readSseData(body)) {
    if (data === "[DONE]") return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    yield* eventsFromChunk(json);
  }
}

export function createGroqProvider(config: ProviderConfig): LlmProvider {
  return {
    name: "groq",
    async stream(request: LlmStreamRequest) {
      const result = await fetchWithRetry(
        `${config.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: headersFor(config),
          body: JSON.stringify({
            model: request.model,
            stream: true,
            max_completion_tokens: request.maxOutputTokens,
            ...(request.reasoningEffort
              ? { reasoning_effort: request.reasoningEffort }
              : {}),
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.user },
            ],
          }),
          signal: AbortSignal.timeout(90_000),
        },
        request.policy,
      );
      if (!result.ok) return result;
      if (!result.response.body) {
        return {
          ok: false as const,
          status: 200,
          error: "Streaming response had no body.",
          attempts: result.attempts,
          gaveUpReason: null,
        };
      }
      return {
        ok: true as const,
        events: streamEvents(result.response.body),
        attempts: result.attempts,
        headers: result.headers,
      };
    },
  };
}
