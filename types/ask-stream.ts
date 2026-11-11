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
 * The caller's question budget for today (Task 5.3), sent with `done` and
 * `not_found`: both spend a unit, so both carry the fresh count.
 */
export interface StreamUsage {
  /** Questions left today after this one; never negative. */
  remaining: number;
  dailyLimit: number;
  /** Next UTC midnight, ISO 8601. */
  resetsAt: string;
}

/**
 * One event of the answer stream. `done`, `not_found`, `limit` and `error`
 * are terminal: exactly one of them ends a complete stream.
 *
 * `limit` grew `reason` and `resetsAt` (ISO 8601, next UTC midnight) in Task
 * 5.2. Both are optional so older frames and clients stay valid; the server
 * always sends them. `done` and `not_found` grew an optional `usage` in Task
 * 5.3, with the same compatibility rule.
 */
export type AskStreamEvent =
  | { type: "sources"; sources: StreamSource[] }
  | { type: "token"; text: string }
  | {
      type: "done";
      citations: number[];
      invalidCitations: number[];
      usage?: StreamUsage;
    }
  | { type: "not_found"; closest?: StreamSource[]; usage?: StreamUsage }
  | {
      type: "limit";
      scope: "user" | "global";
      reason?: LimitReason;
      resetsAt?: string;
    }
  | { type: "error"; code: StreamErrorCode; message: string };
