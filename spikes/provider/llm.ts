import type { HttpAttempt, HttpFailure, RetryPolicy } from "./http";
import type { ProviderName } from "./request";

/**
 * The spike's version of the `LlmProvider` interface from ARCHITECTURE §3.9:
 * "stream a completion from messages". If both adapters satisfy it unchanged,
 * switching providers is practical.
 */
export type StreamEvent =
  | { kind: "text"; text: string }
  /** Reasoning/thinking output. Only its size is kept, not the content. */
  | { kind: "reasoning"; chars: number }
  | {
      kind: "usage";
      promptTokens: number | null;
      completionTokens: number | null;
      totalTokens: number | null;
    }
  | { kind: "finish"; reason: string };

export interface LlmStreamRequest {
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  /** Passed through only when explicitly requested (not every model accepts it). */
  reasoningEffort: string | null;
  policy: RetryPolicy;
}

export type LlmStreamResult =
  | {
      ok: true;
      events: AsyncGenerator<StreamEvent>;
      attempts: HttpAttempt[];
      headers: Record<string, string>;
    }
  | HttpFailure;

export interface LlmProvider {
  name: ProviderName;
  stream(request: LlmStreamRequest): Promise<LlmStreamResult>;
}
