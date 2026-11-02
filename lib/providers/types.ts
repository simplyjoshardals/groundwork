/**
 * Provider-agnostic interfaces (Task 1.3). Nothing here knows about any
 * vendor's request or response format. This is deliberately NOT the
 * application stream contract (Task 1.8); it is only what a provider yields.
 */

export type EmbedRole = "document" | "query";

export interface EmbeddingProvider {
  /** Exact model id; store it in `chunks.embedding_model`. */
  readonly model: string;
  /** Length of every vector this provider returns. */
  readonly dimensions: number;
  /**
   * Embeds raw texts. The adapter applies any role-specific formatting, so
   * callers must pass the text as-is. Returns one vector per input, in order.
   */
  embed(texts: readonly string[], role: EmbedRole): Promise<number[][]>;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export type LlmFinishReason = "stop" | "length" | "blocked" | "other";

export type LlmStreamEvent =
  | { type: "text"; text: string }
  | { type: "finish"; reason: LlmFinishReason; usage?: LlmUsage };

export interface LlmStreamOptions {
  maxOutputTokens?: number;
  /** Cancels the request and the stream. An abort is rethrown as-is, not wrapped. */
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly model: string;
  /**
   * Streams a completion. Failures before the first event and failures after
   * the first token both surface as errors thrown by the iterator. A stream
   * that completes normally always ends with exactly one `finish` event.
   */
  stream(
    messages: readonly LlmMessage[],
    options?: LlmStreamOptions,
  ): AsyncIterable<LlmStreamEvent>;
}
