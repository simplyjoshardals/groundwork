import { ingestOwnedDocument } from "@/features/ingestion";
import { isAuthUnavailable } from "@/lib/auth/auth-unavailable";
import { parseIngestRequest } from "@/lib/ingest/request";
import { describeError } from "@/lib/ask/errors";
import { createRequestLog, hashUserId } from "@/lib/logging/request-log";
import { GEMINI_EMBEDDING_MODEL } from "@/lib/providers";
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

/** Task 5.9: the auth service could not be reached, which is not a 401. */
interface AuthUnavailableBody {
  error: "auth_unavailable";
  message: string;
}

function json(
  status: number,
  body: IngestErrorBody | IngestResponseBody | AuthUnavailableBody,
) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  // Task 5.10: one structured summary line per request, written by `log.end`
  // on every exit path. The step-by-step progress lines stay as they were and
  // share the document id with it.
  const log = createRequestLog("ingest", request);

  // 1. Parse and validate the body, before any auth or database work.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    log.end("invalid_request", 400);
    return json(400, {
      error: "invalid_request",
      message: "The request body must be valid JSON.",
    });
  }
  const parsed = parseIngestRequest(body);
  if (!parsed.ok) {
    log.end("invalid_request", 400);
    return json(400, { error: "invalid_request", message: parsed.message });
  }
  const { documentId } = parsed.data;
  log.set({ documentId, embedding: GEMINI_EMBEDDING_MODEL });

  try {
    // 2. Cookie session only. `getClaims()` validates the token.
    const supabase = await createServerSupabase();
    const { data: auth, error: authError } = await supabase.auth.getClaims();
    const userId = auth?.claims?.sub;
    log.phase("auth");
    if (authError && isAuthUnavailable(authError)) {
      console.error(
        "[ingest] auth service unavailable:",
        describeError(authError),
      );
      log.setError(authError);
      log.end("auth_unavailable", 503);
      return json(503, {
        error: "auth_unavailable",
        message: "The demo is temporarily unavailable. Please try again.",
      });
    }
    if (authError || typeof userId !== "string" || userId === "") {
      log.end("unauthorized", 401);
      return json(401, { error: "unauthorized" });
    }
    log.set({ user: hashUserId(userId) });

    // 3. Ownership (user-scoped, explicit owner filter), then ingestion.
    // `request.signal` is deliberately not passed on: closing the tab must not
    // abort an ingestion half way.
    const outcome = await ingestOwnedDocument({
      supabase,
      userId,
      documentId,
    });
    log.phase("run");

    switch (outcome.status) {
      case "ready":
        log.set({ pages: outcome.pageCount, chunks: outcome.chunkCount });
        log.end("ready", 200);
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
        log.set({ reason: outcome.reason });
        log.setError(outcome.error);
        // Our fault (provider, configuration) is an error; a problem with the
        // user's file is a warning.
        log.end(
          "failed",
          200,
          outcome.reason === "provider_unavailable" ||
            outcome.reason === "internal_error"
            ? "error"
            : "warn",
        );
        return json(200, { status: "failed", reason: outcome.reason });
      case "not_claimed":
      case "claim_lost":
        // Already ready, or another run owns it: nothing was changed.
        log.set({ reason: outcome.status });
        log.end("no_op", 200);
        return json(200, { status: "no_op" });
      case "not_found":
        // Same answer for "does not exist" and "not yours".
        log.end("not_found", 404);
        return json(404, { error: "not_found" });
      case "limit":
        // Over a usage limit (Task 5.2): nothing was claimed or embedded.
        log.set({ reason: outcome.reason });
        log.end("limit", 429);
        return json(429, {
          error: "limit_reached",
          reason: outcome.reason,
          resetsAt: outcome.resetsAt,
        });
    }
  } catch (error) {
    console.error("[ingest] request failed:", describeError(error));
    log.setError(error);
    log.end("internal_error", 500);
    return json(500, {
      error: "internal_error",
      message: "Something went wrong. Please try again.",
    });
  }
}