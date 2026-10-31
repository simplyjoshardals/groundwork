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
  // The key travels in a header (not the URL) so it can never end up in a logged URL.
  return {
    "x-goog-api-key": config.apiKey,
    "content-type": "application/json",
  };
}

function failure(
  status: number,
  error: string,
  attempts: HttpAttempt[],
): HttpFailure {
  return { ok: false, status, error, attempts, gaveUpReason: null };
}

// ---------------------------------------------------------------- models

export interface GeminiModelInfo {
  id: string;
  displayName: string | null;
  version: string | null;
  methods: string[];
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
}

export type GeminiModelsResult =
  | { ok: true; models: GeminiModelInfo[]; attempts: HttpAttempt[] }
  | HttpFailure;

export async function listGeminiModels(
  config: ProviderConfig,
  policy: RetryPolicy,
): Promise<GeminiModelsResult> {
  const models: GeminiModelInfo[] = [];
  const attempts: HttpAttempt[] = [];
  let pageToken: string | null = null;

  for (let page = 0; page < 5; page++) {
    const url = new URL(`${config.baseUrl}/models`);
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const result = await fetchWithRetry(
      url.toString(),
      { headers: headersFor(config), signal: AbortSignal.timeout(30_000) },
      policy,
    );
    attempts.push(...result.attempts);
    if (!result.ok) return { ...result, attempts };

    const json: unknown = await result.response.json();
    if (!isRecord(json))
      return failure(200, "Unexpected models response.", attempts);
    for (const item of getArray(json.models)) {
      if (!isRecord(item)) continue;
      const name = getString(item.name);
      if (!name) continue;
      models.push({
        id: name.replace(/^models\//, ""),
        displayName: getString(item.displayName),
        version: getString(item.version),
        methods: getArray(item.supportedGenerationMethods).flatMap((m) =>
          typeof m === "string" ? [m] : [],
        ),
        inputTokenLimit: getNumber(item.inputTokenLimit),
        outputTokenLimit: getNumber(item.outputTokenLimit),
      });
    }
    pageToken = getString(json.nextPageToken);
    if (!pageToken) break;
  }
  return { ok: true, models, attempts };
}

// ------------------------------------------------------------ embeddings

export type EmbedTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface EmbedRequest {
  model: string;
  texts: string[];
  /** Only sent for models that support it (gemini-embedding-001). */
  taskType: EmbedTaskType | null;
  /** outputDimensionality; null asks for the model's native size. */
  dimensions: number | null;
  policy: RetryPolicy;
}

export type EmbedResult =
  | {
      ok: true;
      vectors: number[][];
      attempts: HttpAttempt[];
      headers: Record<string, string>;
    }
  | HttpFailure;

export async function embedGemini(
  config: ProviderConfig,
  request: EmbedRequest,
): Promise<EmbedResult> {
  // One `requests[]` entry per text, so each text gets its own vector
  // (putting several texts in one `content` would return one aggregated vector).
  const body = {
    requests: request.texts.map((text) => ({
      model: `models/${request.model}`,
      content: { parts: [{ text }] },
      ...(request.taskType ? { taskType: request.taskType } : {}),
      ...(request.dimensions
        ? { outputDimensionality: request.dimensions }
        : {}),
    })),
  };

  const result = await fetchWithRetry(
    `${config.baseUrl}/models/${request.model}:batchEmbedContents`,
    {
      method: "POST",
      headers: headersFor(config),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    },
    request.policy,
  );
  if (!result.ok) return result;

  const json: unknown = await result.response.json();
  const embeddings = isRecord(json) ? getArray(json.embeddings) : [];
  const vectors: number[][] = [];
  for (const item of embeddings) {
    const values = isRecord(item) ? getArray(item.values) : [];
    if (values.length === 0 || !values.every((v) => typeof v === "number")) {
      return failure(
        200,
        "Embedding response had a malformed vector.",
        result.attempts,
      );
    }
    vectors.push(values as number[]);
  }
  if (vectors.length !== request.texts.length) {
    return failure(
      200,
      `Expected ${request.texts.length} vectors but received ${vectors.length}.`,
      result.attempts,
    );
  }
  return {
    ok: true,
    vectors,
    attempts: result.attempts,
    headers: result.headers,
  };
}

// -------------------------------------------------------------- streaming

function* eventsFromChunk(json: unknown): Generator<StreamEvent> {
  if (!isRecord(json)) return;
  const candidate = getArray(json.candidates)[0];
  if (isRecord(candidate)) {
    const content = isRecord(candidate.content) ? candidate.content : null;
    for (const part of content ? getArray(content.parts) : []) {
      if (!isRecord(part)) continue;
      const text = getString(part.text);
      if (text === null) continue;
      if (part.thought === true)
        yield { kind: "reasoning", chars: text.length };
      else yield { kind: "text", text };
    }
    const reason = getString(candidate.finishReason);
    if (reason) yield { kind: "finish", reason };
  }
  if (isRecord(json.usageMetadata)) {
    yield {
      kind: "usage",
      promptTokens: getNumber(json.usageMetadata.promptTokenCount),
      completionTokens: getNumber(json.usageMetadata.candidatesTokenCount),
      totalTokens: getNumber(json.usageMetadata.totalTokenCount),
    };
  }
}

async function* streamEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  for await (const data of readSseData(body)) {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    yield* eventsFromChunk(json);
  }
}

export function createGeminiProvider(config: ProviderConfig): LlmProvider {
  return {
    name: "gemini",
    async stream(request: LlmStreamRequest) {
      const result = await fetchWithRetry(
        `${config.baseUrl}/models/${request.model}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: headersFor(config),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: "user", parts: [{ text: request.user }] }],
            generationConfig: { maxOutputTokens: request.maxOutputTokens },
          }),
          signal: AbortSignal.timeout(90_000),
        },
        request.policy,
      );
      if (!result.ok) return result;
      if (!result.response.body) {
        return failure(200, "Streaming response had no body.", result.attempts);
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
