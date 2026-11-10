import {
  checkRefusalGate1,
  retrieveChunks,
  SearchFailedError,
} from "@/features/qa";
import {
  consumeUsage,
  limitInfoFor,
  refundUsage,
  UsageCheckError,
} from "@/features/limits";
import { encodeStreamEvent } from "@/lib/ask-stream/events";
import { describeError } from "@/lib/ask/errors";
import { buildAskMessages } from "@/lib/ask/prompt";
import { parseAskRequest } from "@/lib/ask/request";
import {
  createAskResponseStream,
  toStreamSources,
  toStreamUsage,
} from "@/lib/ask/stream";
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

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

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
    return jsonError(400, {
      error: "invalid_request",
      message: parsed.message,
    });
  }
  const { question, documentId } = parsed.data;

  // Set once a usage unit has been spent, so the catch block knows to give it
  // back when the failure is ours (Task 5.2).
  let spentBy: string | null = null;

  try {
    // 2. Cookie session only. `getClaims()` validates the token.
    const supabase = await createServerSupabase();
    const { data: auth, error: authError } = await supabase.auth.getClaims();
    const userId = auth?.claims?.sub;
    if (authError || typeof userId !== "string" || userId === "") {
      return jsonError(401, { error: "unauthorized" });
    }

    // Built before spending a unit and before the embedding call, so a config
    // error costs neither usage nor quota.
    const embedder = createGeminiEmbeddingProvider();
    const llm = createGeminiLlmProvider();

    // Usage check (Task 5.2): one atomic check-and-spend, before any provider
    // call. A denial is a normal outcome, so it is a 200 with a one-frame
    // stream, like `not_found`. If the limiter itself fails, the catch below
    // answers 503 and nothing is called: a broken limiter never means unlimited.
    const usage = await consumeUsage(userId, "question");
    if (!usage.allowed) {
      const limit = limitInfoFor(usage);
      // No such user: the session belongs to a deleted account.
      if (limit === null) return jsonError(401, { error: "unauthorized" });
      return new Response(encodeStreamEvent({ type: "limit", ...limit }), {
        headers: SSE_HEADERS,
      });
    }
    spentBy = userId;
    // The budget after this question, for the client's counter (Task 5.3).
    const streamUsage = toStreamUsage(usage);

    // 3 and 4. Embed the question, then search through RLS (user-scoped
    // client, SECURITY INVOKER function). Shared with the eval runner.
    const passages = await retrieveChunks({
      supabase,
      embedder,
      question,
      documentId,
    });

    // 5. Refusal gate #1: when even the best passage is below the calibrated
    // threshold, answer `not_found` and never call the LLM. It is a normal
    // outcome, so the status is 200 and the body is a one-frame stream.
    // `closest` is left out when nothing was retrieved.
    if (checkRefusalGate1(passages).refuse) {
      const closest = toStreamSources(passages);
      return new Response(
        encodeStreamEvent({
          type: "not_found",
          ...(closest.length > 0 ? { closest } : {}),
          usage: streamUsage,
        }),
        { headers: SSE_HEADERS },
      );
    }

    // 6. Stream.
    const stream = createAskResponseStream({
      sources: toStreamSources(passages),
      messages: buildAskMessages(question, passages),
      llm,
      signal: request.signal,
      usage: streamUsage,
      // The LLM failed before any text was sent: the unit was ours to lose.
      onRefundable: () => {
        void refundUsage(userId, "question");
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    console.error(
      "[ask] request failed before streaming:",
      describeError(error),
    );
    // Embedding, search or setup failed after the unit was spent. A refusal
    // (`not_found`) is not a failure and returns above without a refund.
    if (spentBy !== null) await refundUsage(spentBy, "question");
    if (error instanceof UsageCheckError) {
      return jsonError(503, {
        error: "usage_unavailable",
        message: "Something went wrong. Please try again.",
      });
    }
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