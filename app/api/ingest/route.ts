import { ingestOwnedDocument } from "@/features/ingestion";
import { parseIngestRequest } from "@/lib/ingest/request";
import { describeError } from "@/lib/ask/errors";
import { createServerSupabase } from "@/lib/supabase/server";
import type { IngestErrorBody, IngestResponseBody } from "@/types/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Ingestion runs inside this request. A 30-page document is roughly 80 to 100
 * chunks: 8 to 10 embedding batches with a 10 s pause between them is already
 * over 90 s before any rate-limit retry waits (15 s and 30 s). The Hobby
 * maximum with Fluid compute is 300 s (docs/decisions.md, 2026-11-01). If the
 * function is ever cut off, the document stays `processing` until it goes
 * stale and can then be retried (Task 4.6).
 */
export const maxDuration = 300;

function json(status: number, body: IngestErrorBody | IngestResponseBody) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  // 1. Parse and validate the body, before any auth or database work.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, {
      error: "invalid_request",
      message: "The request body must be valid JSON.",
    });
  }
  const parsed = parseIngestRequest(body);
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

    // 3. Ownership (user-scoped, explicit owner filter), then ingestion.
    // `request.signal` is deliberately not passed on: closing the tab must not
    // abort an ingestion half way.
    const outcome = await ingestOwnedDocument({
      supabase,
      userId,
      documentId,
    });

    switch (outcome.status) {
      case "ready":
        return json(200, {
          status: "ready",
          pageCount: outcome.pageCount,
          chunkCount: outcome.chunkCount,
        });
      case "failed":
        // The document is `failed` with a controlled reason. The underlying
        // error stays in the server log; only the code goes to the browser.
        console.error(
          `[ingest] ${documentId} failed (${outcome.reason}):`,
          describeError(outcome.error),
        );
        return json(200, { status: "failed", reason: outcome.reason });
      case "not_claimed":
      case "claim_lost":
        // Already ready, or another run owns it: nothing was changed.
        return json(200, { status: "no_op" });
      case "not_found":
        // Same answer for "does not exist" and "not yours".
        return json(404, { error: "not_found" });
      case "limit":
        // Over a usage limit (Task 5.2): nothing was claimed or embedded.
        return json(429, {
          error: "limit_reached",
          reason: outcome.reason,
          resetsAt: outcome.resetsAt,
        });
    }
  } catch (error) {
    console.error("[ingest] request failed:", describeError(error));
    return json(500, {
      error: "internal_error",
      message: "Something went wrong. Please try again.",
    });
  }
}
