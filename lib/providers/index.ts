import "server-only";

/**
 * Public entry point for provider adapters. Server-only: importing this from a
 * Client Component fails the build. Consumers depend on the interfaces in
 * `types.ts`; only this folder knows a vendor's API.
 */

export type {
  EmbedRole,
  EmbeddingProvider,
  LlmFinishReason,
  LlmMessage,
  LlmProvider,
  LlmStreamEvent,
  LlmStreamOptions,
  LlmUsage,
} from "./types";
export {
  BadRequestError,
  ProviderError,
  ProviderUnavailableError,
  RateLimitError,
} from "./errors";
export { MissingEnvError } from "./env";
export {
  createGeminiEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
  MAX_EMBED_TEXTS_PER_CALL,
  type GeminiEmbeddingOptions,
} from "./gemini-embedding";
export {
  createGeminiLlmProvider,
  DEFAULT_GEMINI_LLM_MODEL,
  type GeminiLlmOptions,
} from "./gemini-llm";
export { DEFAULT_RETRY_POLICY, type RetryPolicy } from "./http";
