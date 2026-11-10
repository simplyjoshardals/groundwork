import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consumeUsage,
  limitInfoFor,
  refundUsage,
  UsageCheckError,
} from "@/features/limits";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  createGeminiEmbeddingProvider,
  type EmbeddingProvider,
} from "@/lib/providers";
import type { LimitReason } from "@/types/ask-stream";
import type { Database } from "@/types/database";
import { ingestDocument, type IngestOptions } from "./ingest-document";
import { createSupabaseIngestStore } from "./supabase-store";
import {
  IngestStoreError,
  type IngestOutcome,
  type IngestStore,
} from "./types";

export interface IngestOwnedDocumentInput {
  /** The caller's own client (session cookies, RLS applies). Never the admin client. */
  supabase: SupabaseClient<Database>;
  /** The authenticated user's id (`sub` claim). */
  userId: string;
  documentId: string;
}

/**
 * `ingestDocument`'s outcomes plus a refusal by the usage limits (Task 5.2).
 * `limit` means nothing was claimed, downloaded or embedded.
 */
export type IngestOwnedOutcome =
  | IngestOutcome
  | { status: "limit"; reason: LimitReason; resetsAt: string };

/**
 * True when the unit should go back: the user got no ingestion and the cause
 * was not their file. A file problem (scanned PDF, too many pages) keeps the
 * unit spent, so a bad file cannot be retried for free.
 */
function isRefundableOutcome(outcome: IngestOutcome): boolean {
  switch (outcome.status) {
    case "ready":
      return false;
    case "not_claimed":
    case "claim_lost":
    case "not_found":
      return true;
    case "failed":
      return (
        outcome.reason === "provider_unavailable" ||
        outcome.reason === "internal_error"
      );
  }
}

/** Replaceable in tests. The defaults are the real admin store and Gemini embedder. */
export interface IngestOwnedDocumentDeps {
  createStore?: () => IngestStore;
  createEmbedder?: () => EmbeddingProvider;
  options?: IngestOptions;
}

/**
 * Runs ingestion for a document the caller owns (Task 4.4).
 *
 * Ownership is checked as the user, with an explicit `owner_id` and
 * `is_public = false` filter. RLS alone is not enough: `documents_select` also
 * lets every signed-in user see the shared samples, and the ingestion store
 * runs as the service role, so without the filter a user could re-ingest a
 * sample. Someone else's id and a missing id look the same (`not_found`), so
 * the answer never confirms that a document exists.
 *
 * The embedder is built before the claim, so a configuration error (a missing
 * API key) is thrown while the document is still `queued` instead of leaving it
 * `processing`. The admin client lives here, in `features/`, never in a route.
 *
 * Usage limits (Task 5.2): after the ownership check and the embedder build,
 * one `ingest` unit is spent before anything is claimed. Someone else's id
 * (404) and a configuration error therefore cost nothing. The unit is given
 * back when the user got no ingestion for a reason that was not their file:
 * `not_claimed`, `claim_lost`, `not_found`, a failed run with
 * `provider_unavailable` or `internal_error`, or `ingestDocument` throwing.
 *
 * Returns `ingestDocument`'s outcome, or `limit` when the caller is over a
 * limit. Throws when the ownership lookup fails, when configuration is
 * missing, when the limiter fails (`UsageCheckError`, fail closed) or when a
 * failure could not be recorded.
 */
export async function ingestOwnedDocument(
  input: IngestOwnedDocumentInput,
  deps: IngestOwnedDocumentDeps = {},
): Promise<IngestOwnedOutcome> {
  const { supabase, userId, documentId } = input;

  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("owner_id", userId)
    .eq("is_public", false)
    .maybeSingle();
  if (error) throw new IngestStoreError("check ownership", error.message);
  if (data === null) return { status: "not_found" };

  const embedder = (deps.createEmbedder ?? createGeminiEmbeddingProvider)();

  const usage = await consumeUsage(userId, "ingest");
  if (!usage.allowed) {
    const limit = limitInfoFor(usage);
    // The ownership check above proved the user exists, so this is a limiter
    // fault, not a client case.
    if (limit === null) {
      throw new UsageCheckError("consume_usage reported an unknown user");
    }
    return { status: "limit", reason: limit.reason, resetsAt: limit.resetsAt };
  }

  let outcome: IngestOutcome;
  try {
    const store = (
      deps.createStore ??
      (() => createSupabaseIngestStore(createAdminSupabase()))
    )();
    outcome = await ingestDocument(documentId, {
      store,
      embedder,
      options: deps.options ?? {
        log: (message) => console.info(`[ingest] ${documentId}: ${message}`),
      },
    });
  } catch (error) {
    await refundUsage(userId, "ingest");
    throw error;
  }
  if (isRefundableOutcome(outcome)) await refundUsage(userId, "ingest");
  return outcome;
}
