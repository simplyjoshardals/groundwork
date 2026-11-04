import {
  ProviderUnavailableError,
  RateLimitError,
} from "@/lib/providers/errors";
import type { EvalEntry } from "./dataset";
import {
  errorResult,
  scoreQuestion,
  type EvalPassage,
  type QuestionResult,
} from "./score-retrieval";
/**
 * The retrieval-only eval loop (Task 2.2). It knows nothing about Supabase or
 * Gemini: the caller supplies `retrieve`. Questions run one at a time, in
 * dataset order, with a pause between them, so a run stays well inside a free
 * tier. A rate-limit or outage is retried with exponential backoff; a question
 * that still fails is recorded as an error result and the run carries on.
 */

export interface BackoffOptions {
  /** Retries after the first attempt. */
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Injected so tests need no real waiting. */
  sleep: (ms: number) => Promise<void>;
  /** Returns a number in [0, 1). Injected for deterministic tests. */
  random: () => number;
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    reason: string;
  }) => void;
}

export const DEFAULT_BACKOFF = {
  maxRetries: 4,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
} as const;

export const DEFAULT_PAUSE_MS = 1_000;

export function isRetryable(error: unknown): boolean {
  return (
    error instanceof RateLimitError || error instanceof ProviderUnavailableError
  );
}

function describeFailure(error: unknown): string {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** Runs `fn`, retrying retryable failures. Anything else is thrown at once. */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error) || attempt >= options.maxRetries) throw error;
      const exponential = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * 2 ** attempt,
      );
      const jittered = exponential * (0.5 + 0.5 * options.random());
      const hinted =
        error instanceof RateLimitError ? (error.retryAfterMs ?? 0) : 0;
      const delayMs = Math.min(options.maxDelayMs, Math.max(jittered, hinted));
      options.onRetry?.({
        attempt: attempt + 1,
        delayMs,
        reason: describeFailure(error),
      });
      await options.sleep(delayMs);
    }
  }
}

export interface RunRetrievalInput {
  entries: readonly EvalEntry[];
  /** Returns the top-k passages for the entry's question, best first. */
  retrieve: (entry: EvalEntry) => Promise<readonly EvalPassage[]>;
  k: number;
  backoff: BackoffOptions;
  pauseMs: number;
  onResult?: (result: QuestionResult, index: number, total: number) => void;
}

export async function runRetrievalEval(
  input: RunRetrievalInput,
): Promise<QuestionResult[]> {
  const { entries, retrieve, backoff } = input;
  const results: QuestionResult[] = [];

  for (const [index, entry] of entries.entries()) {
    if (index > 0 && input.pauseMs > 0) await backoff.sleep(input.pauseMs);

    let result: QuestionResult;
    try {
      const passages = await withBackoff(() => retrieve(entry), backoff);
      result = scoreQuestion(entry, passages.slice(0, input.k));
    } catch (error) {
      result = errorResult(entry, describeFailure(error));
    }
    results.push(result);
    input.onResult?.(result, index, entries.length);
  }
  return results;
}
