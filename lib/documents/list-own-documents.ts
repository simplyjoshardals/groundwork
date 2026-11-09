import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isDocumentStatus, type DocumentStateFields } from "./document-status";

/**
 * The signed-in user's own documents (Task 4.6), read with the browser client
 * so `documents_select` (RLS) decides what is visible. `is_public = false`
 * keeps the shared samples out: they are not "your documents". Never pass the
 * admin client. Never throws: every outcome is a value, and a failure is an
 * explicit error, never a silent empty list.
 */

export interface OwnDocument extends DocumentStateFields {
  id: string;
  title: string;
  originalFilename: string;
  pageCount: number | null;
  chunkCount: number;
}

export type ListOwnDocumentsResult =
  | { ok: true; documents: OwnDocument[] }
  | { ok: false; reason: "failed" | "invalid_data" };

/** Explicit columns, never `*`. */
const COLUMNS =
  "id, title, original_filename, status, error_reason, page_count, chunk_count, created_at, processing_started_at";

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Narrows an untrusted row to `OwnDocument`, or null when any field is off. */
function parseRow(row: unknown): OwnDocument | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  if (typeof r.title !== "string") return null;
  if (typeof r.original_filename !== "string") return null;
  if (!isDocumentStatus(r.status)) return null;
  if (r.error_reason !== null && typeof r.error_reason !== "string") {
    return null;
  }
  if (r.page_count !== null && !isNonNegativeInteger(r.page_count)) return null;
  if (!isNonNegativeInteger(r.chunk_count)) return null;
  if (typeof r.created_at !== "string") return null;
  if (
    r.processing_started_at !== null &&
    typeof r.processing_started_at !== "string"
  ) {
    return null;
  }
  return {
    id: r.id,
    title: r.title,
    originalFilename: r.original_filename,
    status: r.status,
    errorReason: r.error_reason,
    pageCount: r.page_count,
    chunkCount: r.chunk_count,
    createdAt: r.created_at,
    processingStartedAt: r.processing_started_at,
  };
}

export async function listOwnDocuments(
  client: SupabaseClient<Database>,
): Promise<ListOwnDocumentsResult> {
  try {
    const { data, error } = await client
      .from("documents")
      .select(COLUMNS)
      .eq("is_public", false)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[documents] list failed:", error.code ?? "unknown");
      return { ok: false, reason: "failed" };
    }
    if (!Array.isArray(data)) {
      console.warn("[documents] list returned an unexpected shape");
      return { ok: false, reason: "invalid_data" };
    }

    const documents: OwnDocument[] = [];
    for (const row of data as unknown[]) {
      const parsed = parseRow(row);
      if (parsed === null) {
        console.warn(
          "[documents] list returned a row with an unexpected shape",
        );
        return { ok: false, reason: "invalid_data" };
      }
      documents.push(parsed);
    }
    return { ok: true, documents };
  } catch (error) {
    // The error name only: a message could carry a URL.
    console.warn(
      "[documents] list did not complete:",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, reason: "failed" };
  }
}
