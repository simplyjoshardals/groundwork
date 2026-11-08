import { deleteOwnedDocument } from "@/features/storage-cleanup";
import { parseIngestRequest } from "@/lib/ingest/request";
import { describeError } from "@/lib/ask/errors";
import { createServerSupabase } from "@/lib/supabase/server";
import type {
  DeleteDocumentErrorBody,
  DeleteDocumentResponseBody,
} from "@/types/delete-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(
  status: number,
  body: DeleteDocumentErrorBody | DeleteDocumentResponseBody,
) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // 1. Validate the id before any auth or database work. Same UUID rule as /api/ingest.
  const { id } = await context.params;
  const parsed = parseIngestRequest({ documentId: id });
  if (!parsed.ok) {
    return json(400, { error: "invalid_request", message: parsed.message });
  }
  const { documentId } = parsed.data;

  try {
    // 2. Cookie session only. `getClaims()` validates the token.
    const supabase = await createServerSupabase();
    const { data: auth, error: authError } = await supabase.auth.getClaims();
    const userId = auth?.claims?.sub;
    if (authError || typeof userId !== "string" || userId === "") {
      return json(401, { error: "unauthorized" });
    }

    // 3. Delete as the user, then clean up the file.
    const outcome = await deleteOwnedDocument({ supabase, userId, documentId });

    if (outcome.status === "not_found") {
      // Same answer for "does not exist" and "not yours".
      return json(404, { error: "not_found" });
    }
    if (outcome.cleanupError !== undefined) {
      // The document is already deleted, so this is not an error for the user.
      // The leftover outbox row is handled by `yarn cleanup:storage`.
      console.error(
        `[delete] ${documentId}: file cleanup failed:`,
        describeError(outcome.cleanupError),
      );
    }
    return json(200, { status: "deleted", fileRemoved: outcome.fileRemoved });
  } catch (error) {
    console.error("[delete] request failed:", describeError(error));
    return json(500, {
      error: "internal_error",
      message: "Something went wrong. Please try again.",
    });
  }
}
