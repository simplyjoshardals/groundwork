import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  createGeminiEmbeddingProvider,
  type EmbeddingProvider,
} from "@/lib/providers";
import type { Database } from "@/types/database";
import { ingestDocument, type IngestOptions } from "./ingest-document";
import { createSupabaseIngestStore } from "./supabase-store";
import { IngestStoreError, type IngestOutcome, type IngestStore } from "./types";

export interface IngestOwnedDocumentInput {
  /** The caller's own client (session cookies, RLS applies). Never the admin client. */
  supabase: SupabaseClient<Database>;
  /** The authenticated user's id (`sub` claim). */
  userId: string;
  documentId: string;
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
 * Returns `ingestDocument`'s outcome. Throws when the ownership lookup fails,
 * when configuration is missing, or when a failure could not be recorded.
 */
export async function ingestOwnedDocument(
  input: IngestOwnedDocumentInput,
  deps: IngestOwnedDocumentDeps = {},
): Promise<IngestOutcome> {
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
  const store = (
    deps.createStore ?? (() => createSupabaseIngestStore(createAdminSupabase()))
  )();

  return ingestDocument(documentId, {
    store,
    embedder,
    options: deps.options ?? {
      log: (message) => console.info(`[ingest] ${documentId}: ${message}`),
    },
  });
}
