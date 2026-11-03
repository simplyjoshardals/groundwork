import { describeError } from "@/lib/ask/errors";
import { buildAskMessages } from "@/lib/ask/prompt";
import { parseAskRequest } from "@/lib/ask/request";
import { createAskResponseStream, toStreamSources } from "@/lib/ask/stream";
import {
  createGeminiEmbeddingProvider,
  createGeminiLlmProvider,
  ProviderUnavailableError,
  RateLimitError,
} from "@/lib/providers";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Passages sent to the model (the plan's `match_count`). */
const MATCH_COUNT = 6;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

/** `match_chunks` returned an error (database or network problem). */
class SearchFailedError extends Error {
  constructor(detail: string) {
    super(`match_chunks failed: ${detail}`);
    this.name = "SearchFailedError";
  }
}

function jsonError(status: number, body: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  // 1. Parse and validate the body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, {
      error: "invalid_request",
      message: "The request body must be valid JSON.",
    });
  }
  const parsed = parseAskRequest(body);
  if (!parsed.ok) {
    return jsonError(400, { error: "invalid_request", message: parsed.message });
  }
  const { question, documentId } = parsed.data;

  try {
    // 2. Cookie session only. `getClaims()` validates the token.
    const supabase = await createServerSupabase();
    const { data: auth, error: authError } = await supabase.auth.getClaims();
    if (authError || !auth?.claims) {
      return jsonError(401, { error: "unauthorized" });
    }

    // Built before the embedding call so a config error costs no quota.
    const embedder = createGeminiEmbeddingProvider();
    const llm = createGeminiLlmProvider();

    // 3. Embed the question.
    const [vector] = await embedder.embed([question], "query");
    if (!vector || vector.length !== embedder.dimensions) {
      throw new Error("The embedding provider returned an unexpected shape.");
    }

    // 4. Search through RLS (user-scoped client, SECURITY INVOKER function).
    const { data: rows, error: searchError } = await supabase.rpc(
      "match_chunks",
      {
        query_embedding: `[${vector.join(",")}]`,
        p_embedding_model: embedder.model,
        match_count: MATCH_COUNT,
        ...(documentId ? { p_document_id: documentId } : {}),
      },
    );
    if (searchError) {
      throw new SearchFailedError(
        `${searchError.code ?? "no code"}: ${searchError.message}`,
      );
    }
    const passages = rows ?? [];

    // 5. Stream.
    const stream = createAskResponseStream({
      sources: toStreamSources(passages),
      messages: buildAskMessages(question, passages),
      llm,
      signal: request.signal,
    });
    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    console.error("[ask] request failed before streaming:", describeError(error));
    if (
      error instanceof RateLimitError ||
      error instanceof ProviderUnavailableError ||
      error instanceof SearchFailedError
    ) {
      return jsonError(503, {
        error: "search_unavailable",
        message: "Search is temporarily unavailable. Please try again.",
      });
    }
    return jsonError(500, {
      error: "internal_error",
      message: "Something went wrong. Please try again.",
    });
  }
}
