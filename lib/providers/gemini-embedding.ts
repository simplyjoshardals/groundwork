import "server-only";
import { badRequest, unavailable, type ProviderName } from "./errors";
import { geminiApiKey } from "./env";
import { getArray, isRecord } from "./guards";
import { DEFAULT_RETRY_POLICY, postWithRetry, type RetryPolicy } from "./http";
import type { EmbeddingProvider, EmbedRole } from "./types";

const PROVIDER: ProviderName = "gemini";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Decided in Task 0.5 (docs/decisions.md, 2026-10-31). */
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
/** Matches `vector(768)` in the schema. */
export const EMBEDDING_DIMENSIONS = 768;
/** Gemini's `batchEmbedContents` limit. Pacing across calls is the caller's job. */
export const MAX_EMBED_TEXTS_PER_CALL = 100;

const DOCUMENT_PREFIX = "title: none | text: ";
const QUERY_PREFIX = "task: search result | query: ";

/**
 * `gemini-embedding-2` does not take `taskType`; the role is signalled by a
 * text prefix instead. Using the wrong or a missing prefix silently changes
 * the vectors, so only the adapter applies it.
 */
export function formatEmbeddingInput(text: string, role: EmbedRole): string {
  return `${role === "query" ? QUERY_PREFIX : DOCUMENT_PREFIX}${text}`;
}

export interface GeminiEmbeddingOptions {
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
}

function validateInputs(texts: readonly string[]): void {
  if (texts.length > MAX_EMBED_TEXTS_PER_CALL) {
    throw badRequest(
      PROVIDER,
      `at most ${MAX_EMBED_TEXTS_PER_CALL} texts can be embedded per call`,
    );
  }
  texts.forEach((text, index) => {
    if (typeof text !== "string" || text.trim() === "") {
      throw badRequest(PROVIDER, `text at index ${index} is empty`);
    }
    // Callers pass raw text. Already-prefixed input would be prefixed twice.
    if (text.startsWith(DOCUMENT_PREFIX) || text.startsWith(QUERY_PREFIX)) {
      throw badRequest(
        PROVIDER,
        `text at index ${index} already has an embedding prefix; pass raw text`,
      );
    }
  });
}

function parseVectors(json: unknown, expectedCount: number): number[][] {
  if (!isRecord(json) || !Array.isArray(json.embeddings)) {
    throw unavailable(PROVIDER, "embedding response had no embeddings list");
  }
  const embeddings = getArray(json.embeddings);
  if (embeddings.length !== expectedCount) {
    throw unavailable(
      PROVIDER,
      `expected ${expectedCount} vectors but received ${embeddings.length}`,
    );
  }
  return embeddings.map((item, index) => {
    const values = isRecord(item) ? item.values : undefined;
    if (!Array.isArray(values)) {
      throw unavailable(PROVIDER, `vector ${index} was missing`);
    }
    if (values.length !== EMBEDDING_DIMENSIONS) {
      throw unavailable(
        PROVIDER,
        `vector ${index} had ${values.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }
    const vector: number[] = [];
    for (const value of values as unknown[]) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw unavailable(PROVIDER, `vector ${index} had a non-numeric value`);
      }
      vector.push(value);
    }
    return vector;
  });
}

export function createGeminiEmbeddingProvider(
  options: GeminiEmbeddingOptions = {},
): EmbeddingProvider {
  const policy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const timeoutMs = options.timeoutMs ?? 60_000;

  return {
    model: GEMINI_EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts, role) {
      validateInputs(texts);
      if (texts.length === 0) return [];

      // One `requests[]` entry per text, so each text gets its own vector.
      const body = {
        requests: texts.map((text) => ({
          model: `models/${GEMINI_EMBEDDING_MODEL}`,
          content: { parts: [{ text: formatEmbeddingInput(text, role) }] },
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      };

      const response = await postWithRetry({
        provider: PROVIDER,
        url: `${BASE_URL}/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents`,
        // The key travels in a header, never the URL, so it cannot be logged with one.
        headers: {
          "x-goog-api-key": geminiApiKey(),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        timeoutMs,
        policy,
      });

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw unavailable(PROVIDER, "embedding response was not valid JSON");
      }
      return parseVectors(json, texts.length);
    },
  };
}
