import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET } from "@/lib/storage/documents";
import type { Database } from "@/types/database";
import type { UploadPorts } from "./upload-document";

/**
 * Real `UploadPorts` for a browser (or user-scoped) client. Never pass the
 * admin client: the service role would bypass RLS and the storage policies
 * this flow relies on. No `server-only`, because it runs in the browser.
 *
 * Failures are logged by error code or name only (never the message, which can
 * echo request details) and reported to the caller as `{ ok: false }`.
 */
export function createUploadPorts(
  client: SupabaseClient<Database>,
): UploadPorts {
  return {
    async getSession() {
      try {
        const { data, error } = await client.auth.getClaims();
        if (error) {
          console.warn(`[upload] session check failed: ${error.name}`);
          return { status: "failed" };
        }
        const claims = data?.claims;
        if (!claims || typeof claims.sub !== "string" || !claims.sub) {
          return { status: "signed_out" };
        }
        return {
          status: "signed_in",
          userId: claims.sub,
          isAnonymous: claims.is_anonymous === true,
        };
      } catch {
        console.warn("[upload] session check threw");
        return { status: "failed" };
      }
    },

    async countOwnDocuments() {
      try {
        // Non-public rows are visible only to their owner (RLS), so this is
        // the user's own count without needing their id.
        const { count, error } = await client
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("is_public", false);
        if (error || count === null) {
          console.warn(`[upload] count failed: ${error?.code ?? "no count"}`);
          return { ok: false };
        }
        return { ok: true, count };
      } catch {
        console.warn("[upload] count threw");
        return { ok: false };
      }
    },

    async insertDocument(row) {
      try {
        const { error } = await client.from("documents").insert(row);
        if (error) {
          console.warn(`[upload] insert failed: ${error.code}`);
          return { ok: false };
        }
        return { ok: true };
      } catch {
        console.warn("[upload] insert threw");
        return { ok: false };
      }
    },

    async uploadFile(path, body, contentType) {
      try {
        const { error } = await client.storage
          .from(DOCUMENTS_BUCKET)
          .upload(path, body, { contentType, upsert: false });
        if (error) {
          console.warn(`[upload] storage upload failed: ${error.name}`);
          return { ok: false };
        }
        return { ok: true };
      } catch {
        console.warn("[upload] storage upload threw");
        return { ok: false };
      }
    },

    async deleteDocument(id) {
      try {
        const { error } = await client.from("documents").delete().eq("id", id);
        if (error) {
          console.warn(`[upload] row cleanup failed: ${error.code}`);
          return { ok: false };
        }
        return { ok: true };
      } catch {
        console.warn("[upload] row cleanup threw");
        return { ok: false };
      }
    },

    newId() {
      return crypto.randomUUID();
    },
  };
}
