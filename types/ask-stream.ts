/**
 * Shared contract for the `/api/ask` response stream (Task 1.8). The server
 * encodes these events and the browser parses them, so this file is types only
 * and must stay importable from both sides. Each event travels as one SSE
 * frame, `data: {"type": "...", ...}\n\n`; the type is inside the JSON.
 */

/** A retrieved passage, keyed by the `[n]` marker the model cites it with. */
export interface StreamSource {
  /** The `n` in `[n]`, starting at 1. */
  marker: number;
  documentId: string;
  /**
   * Id of the cited chunk (`chunks.id`). The viewer URL carries it as
   * `chunk=<id>` so later tasks can find the exact passage.
   */
  chunkId: number;
  documentTitle: string;
  /** 1-based page number (a virtual page for text and Markdown files). */
  page: number;
  snippet: string;
}

/**
 * Stable machine-readable reasons for an `error` event. The user-facing text
 * is chosen by the client; `message` is only a safe fallback.
 */
export type StreamErrorCode =
  "search_unavailable" | "llm_unavailable" | "interrupted" | "internal_error";

/**
 * Why a `limit` event was sent (Task 5.2): the user's daily cap, the short
 * cooldown between questions, or the app-wide daily cap.
 */
export type LimitReason = "user_limit" | "cooldown" | "global_limit";

/**
 * One event of the answer stream. `done`, `not_found`, `limit` and `error`
 * are terminal: exactly one of them ends a complete stream.
 *
 * `limit` grew `reason` and `resetsAt` (ISO 8601, next UTC midnight) in Task
 * 5.2. Both are optional so older frames and clients stay valid; the server
 * always sends them.
 */
export type AskStreamEvent =
  | { type: "sources"; sources: StreamSource[] }
  | { type: "token"; text: string }
  | { type: "done"; citations: number[]; invalidCitations: number[] }
  | { type: "not_found"; closest?: StreamSource[] }
  | {
      type: "limit";
      scope: "user" | "global";
      reason?: LimitReason;
      resetsAt?: string;
    }
  | { type: "error"; code: StreamErrorCode; message: string };
