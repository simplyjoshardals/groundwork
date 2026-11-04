import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmbeddingProvider } from "@/lib/providers/types";
import type { Database } from "@/types/database";

/**
 * Retrieval, shared by `POST /api/ask` and the eval runner (Task 2.2) so the
 * eval measures the code the product runs. It embeds the question and calls
 * `match_chunks` through the caller's client: pass a user-scoped client so RLS
 * filters every row. Never pass the service-role client here.
 */

/** Passages sent to the model (the plan's `match_count`). */
export const DEFAULT_MATCH_COUNT = 6;

/** One row returned by `match_chunks`, best match first. */
export type MatchedChunk =
  Database["public"]["Functions"]["match_chunks"]["Returns"][number];

/** `match_chunks` returned an error (database or network problem). */
export class SearchFailedError extends Error {
  constructor(detail: string) {
    super(`match_chunks failed: ${detail}`);
    this.name = "SearchFailedError";
  }
}

export interface RetrieveChunksInput {
  supabase: SupabaseClient<Database>;
  embedder: EmbeddingProvider;
  question: string;
  documentId?: string;
  matchCount?: number;
}

export async function retrieveChunks(
  input: RetrieveChunksInput,
): Promise<MatchedChunk[]> {
  const { supabase, embedder, question, documentId } = input;

  const [vector] = await embedder.embed([question], "query");
  if (!vector || vector.length !== embedder.dimensions) {
    throw new Error("The embedding provider returned an unexpected shape.");
  }

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: `[${vector.join(",")}]`,
    p_embedding_model: embedder.model,
    match_count: input.matchCount ?? DEFAULT_MATCH_COUNT,
    ...(documentId ? { p_document_id: documentId } : {}),
  });
  if (error) {
    throw new SearchFailedError(`${error.code ?? "no code"}: ${error.message}`);
  }
  return data ?? [];
}
