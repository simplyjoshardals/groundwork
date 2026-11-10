/**
 * Body of a successful `POST /api/ingest` response (Task 4.4). Types only, so
 * the route handler and the browser share one contract. Nothing here carries
 * `server-only`, and nothing is imported at runtime.
 *
 * `failed.reason` is a controlled `documents.error_reason` code. Error text,
 * stack traces and provider messages never travel in this body (Task 4.5
 * turns the codes into friendly messages).
 */

import type { IngestFailureReason } from "@/features/ingestion/types";
import type { LimitReason } from "@/types/ask-stream";

export type IngestResponseBody =
  | { status: "ready"; pageCount: number; chunkCount: number }
  | { status: "failed"; reason: IngestFailureReason }
  /** Already `ready`, or another run holds the document. Nothing was changed. */
  | { status: "no_op" };

/** Error bodies. `message` is present only where the caller can act on it. */
export type IngestErrorBody =
  | { error: "invalid_request"; message: string }
  | { error: "unauthorized" }
  | { error: "not_found" }
  /**
   * Over a usage limit (Task 5.2), HTTP 429. `resetsAt` is ISO 8601. The
   * browser helper does not read this body yet (Task 5.3): any non-OK answer
   * is still treated as "unconfirmed" there.
   */
  | { error: "limit_reached"; reason: LimitReason; resetsAt: string }
  | { error: "internal_error"; message: string };
