import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/viewer-url/location";
import type { Database } from "@/types/database";

/**
 * Resolves `?doc=<id>` to what the viewer needs (Task 3.3). No `server-only`
 * on purpose: the browser calls it with its own session. Pass a user-scoped
 * client, never the admin client: the `documents_select` policy (own or
 * public) decides what comes back, so another user's id is indistinguishable
 * from a missing one.
 */

export interface ViewerDocument {
  id: string;
  title: string;
  storagePath: string;
  mimeType: string;
}

export type ViewerDocumentResult =
  | { ok: true; document: ViewerDocument }
  /** Missing, or not readable by this session (the database does not say which). */
  | { ok: false; reason: "not_found" }
  /** Network or database error; worth a retry. */
  | { ok: false; reason: "failed" };

export async function getViewerDocument(
  client: SupabaseClient<Database>,
  documentId: string,
): Promise<ViewerDocumentResult> {
  // Never send a malformed id to the database.
  if (!isUuid(documentId)) return { ok: false, reason: "not_found" };

  const { data, error } = await client
    .from("documents")
    .select("id, title, storage_path, mime_type")
    .eq("id", documentId)
    .maybeSingle();

  if (error) return { ok: false, reason: "failed" };
  if (!data) return { ok: false, reason: "not_found" };

  return {
    ok: true,
    document: {
      id: data.id,
      title: data.title,
      storagePath: data.storage_path,
      mimeType: data.mime_type,
    },
  };
}
