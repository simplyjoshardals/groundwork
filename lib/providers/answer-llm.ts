import "server-only";
import { groqApiKeyIfSet } from "./env";
import { createFailoverLlmProvider, type FailoverHooks } from "./failover-llm";
import { createGeminiLlmProvider } from "./gemini-llm";
import { createGroqLlmProvider } from "./groq-llm";
import type { LlmProvider } from "./types";

/**
 * With a fallback configured, the primary gives up fast. The route's
 * `maxDuration` is 60 s, so a primary that retries for 30 s (or hangs for the
 * adapter's 90 s default) would leave no time to fail over. 20 s still covers
 * a normal streamed answer, which takes a few seconds.
 */
const PRIMARY_TIMEOUT_MS = 20_000;
const PRIMARY_RETRY = { maxRetries: 1, maxWaitMs: 2_000 };
/** Last in line: a bounded wait, so the worst case still ends inside 60 s. */
const FALLBACK_TIMEOUT_MS = 30_000;
const FALLBACK_RETRY = { maxRetries: 1, maxWaitMs: 5_000 };

let warnedNoFallback = false;

/**
 * The LLM for `/api/ask` (Task 5.5): Gemini first, Groq as fallback when
 * `GROQ_API_KEY` is set. Without the key it is Gemini alone with the adapter's
 * defaults, and says so once in the log instead of failing: local development
 * and CI do not need a second key. Embeddings never fall back (their vectors
 * are not interchangeable), so this is only for the answer model.
 */
export function createAnswerLlmProvider(
  hooks: FailoverHooks = {},
): LlmProvider {
  if (groqApiKeyIfSet() === null) {
    if (!warnedNoFallback) {
      warnedNoFallback = true;
      console.warn(
        "[ask] GROQ_API_KEY is not set: the answer LLM has no fallback.",
      );
    }
    return createGeminiLlmProvider();
  }
  return createFailoverLlmProvider(
    createGeminiLlmProvider({
      retryPolicy: PRIMARY_RETRY,
      timeoutMs: PRIMARY_TIMEOUT_MS,
    }),
    createGroqLlmProvider({
      retryPolicy: FALLBACK_RETRY,
      timeoutMs: FALLBACK_TIMEOUT_MS,
    }),
    hooks,
  );
}
