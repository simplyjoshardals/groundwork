import type { SupabaseClient } from "@supabase/supabase-js";
import { isChunkId } from "@/lib/viewer-url/location";
import type { Database } from "@/types/database";

/**
 * Loads one chunk's text and offsets by id (Task 3.4), for the highlight
 * (Task 3.5) and the fallback passage panel (Task 3.6). No `server-only` on
 * purpose: the browser calls it with its own session. Pass a user-scoped
 * client, never the admin client: the `chunks_select` policy (own or public)
 * decides what comes back, so another user's chunk id is indistinguishable
 * from a missing one.
 *
 * The query never selects `embedding` (768 floats the viewer has no use for).
 *
 * This does not check that the chunk belongs to the document being viewed:
 * `?doc=A&chunk=<id from B>` is a well-formed link. The caller compares
 * `documentId` (and `pageNumber`) with what it is showing.
 */

export interface ChunkPassage {
  /** `chunks.id` as digits, the same form `?chunk=` and `ViewerTarget` use. */
  id: string;
  documentId: string;
  /** 1-based page (or virtual page) the chunk was cut from. */
  pageNumber: number;
  /** UTF-16 offsets into the normalized text of that page; `charEnd` is exclusive. */
  charStart: number;
  charEnd: number;
  content: string;
}

export type ChunkResult =
  | { ok: true; chunk: ChunkPassage }
  /** Missing, or not readable by this session (the database does not say which). */
  | { ok: false; reason: "not_found" }
  /** Network or database error; worth a retry. */
  | { ok: false; reason: "failed" };

export async function getChunk(
  client: SupabaseClient<Database>,
  chunkId: string,
): Promise<ChunkResult> {
  // Never send a malformed id to the database. The pattern keeps it a safe integer.
  if (!isChunkId(chunkId)) return { ok: false, reason: "not_found" };

  const { data, error } = await client
    .from("chunks")
    .select("id, document_id, page_number, char_start, char_end, content")
    .eq("id", Number.parseInt(chunkId, 10))
    .maybeSingle();

  if (error) return { ok: false, reason: "failed" };
  if (!data) return { ok: false, reason: "not_found" };

  return {
    ok: true,
    chunk: {
      id: String(data.id),
      documentId: data.document_id,
      pageNumber: data.page_number,
      charStart: data.char_start,
      charEnd: data.char_end,
      content: data.content,
    },
  };
}
