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
import { isAuthUnavailable } from "@/lib/auth/auth-unavailable";
import { encodeStreamEvent } from "@/lib/ask-stream/events";
import { describeError } from "@/lib/ask/errors";
import { createRequestLog, hashUserId } from "@/lib/logging/request-log";
import { buildAskMessages } from "@/lib/ask/prompt";
import { parseAskRequest } from "@/lib/ask/request";
import {
  createAskResponseStream,
  toStreamSources,
  toStreamUsage,
} from "@/lib/ask/stream";
import {
  createAnswerLlmProvider,
  createGeminiEmbeddingProvider,
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
  // Task 5.10: one structured line per request, written by `log.end` on every
  // exit path (for a stream, when the stream ends). See lib/logging.
  const log = createRequestLog("ask", request);

  // 1. Parse and validate the body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    log.end("invalid_request", 400);
    return jsonError(400, {
      error: "invalid_request",
      message: "The request body must be valid JSON.",
    });
  }
  const parsed = parseAskRequest(body);
  if (!parsed.ok) {
    log.end("invalid_request", 400);
    return jsonError(400, {
      error: "invalid_request",
      message: parsed.message,
    });
  }
  const { question, documentId } = parsed.data;
  log.set({ documentScoped: Boolean(documentId) });

  // Set once a usage unit has been spent, so the catch block knows to give it
  // back when the failure is ours (Task 5.2).
  let spentBy: string | null = null;

  try {
    // 2. Cookie session only. `getClaims()` validates the token.
    const supabase = await createServerSupabase();
    const { data: auth, error: authError } = await supabase.auth.getClaims();
    const userId = auth?.claims?.sub;
    log.phase("auth");
    // Task 5.9: an unreachable auth service (paused project, outage) is not a
    // missing session. Say so, instead of telling the user to reload.
    if (authError && isAuthUnavailable(authError)) {
      console.error(
        "[ask] auth service unavailable:",
        describeError(authError),
      );
      log.setError(authError);
      log.end("auth_unavailable", 503);
      return jsonError(503, {
        error: "auth_unavailable",
        message: "The demo is temporarily unavailable. Please try again.",
      });
    }
    if (authError || typeof userId !== "string" || userId === "") {
      log.end("unauthorized", 401);
      return jsonError(401, { error: "unauthorized" });
    }
    log.set({ user: hashUserId(userId) });

    // Built before spending a unit and before the embedding call, so a config
    // error costs neither usage nor quota.
    const embedder = createGeminiEmbeddingProvider();
    // Gemini first, Groq as fallback when configured (Task 5.5). The hook
    // records which model really answered (Task 5.10).
    const llm = createAnswerLlmProvider({
      onFailover: ({ from, to }) =>
        log.set({ llm: to, failover: true, failoverFrom: from }),
    });
    log.set({ embedding: embedder.model, llm: llm.model, failover: false });

    // Usage check (Task 5.2): one atomic check-and-spend, before any provider
    // call. A denial is a normal outcome, so it is a 200 with a one-frame
    // stream, like `not_found`. If the limiter itself fails, the catch below
    // answers 503 and nothing is called: a broken limiter never means unlimited.
    const usage = await consumeUsage(userId, "question");
    log.phase("usage");
    if (!usage.allowed) {
      const limit = limitInfoFor(usage);
      // No such user: the session belongs to a deleted account.
      if (limit === null) {
        log.end("unauthorized", 401);
        return jsonError(401, { error: "unauthorized" });
      }
      const limited = new Response(
        encodeStreamEvent({ type: "limit", ...limit }),
        { headers: SSE_HEADERS },
      );
      log.set({ reason: limit.reason });
      log.end("limit", 200);
      return limited;
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
    log.phase("retrieve");
    log.set({ passages: passages.length });

    // 5. Refusal gate #1: when even the best passage is below the calibrated
    // threshold, answer `not_found` and never call the LLM. It is a normal
    // outcome, so the status is 200 and the body is a one-frame stream.
    // `closest` is left out when nothing was retrieved.
    const gate = checkRefusalGate1(passages);
    log.set({ bestSimilarity: gate.bestSimilarity });
    if (gate.refuse) {
      const closest = toStreamSources(passages);
      const refusal = new Response(
        encodeStreamEvent({
          type: "not_found",
          ...(closest.length > 0 ? { closest } : {}),
          usage: streamUsage,
        }),
        { headers: SSE_HEADERS },
      );
      log.set({
        refusalPath:
          gate.reason === "no_passages"
            ? "gate1_no_passages"
            : "gate1_below_threshold",
      });
      log.end("not_found", 200);
      return refusal;
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
        log.set({ refunded: true });
        void refundUsage(userId, "question");
      },
      // Task 5.10: the stream knows how the request really ended.
      onFinish: (info) => {
        log.setMs("firstToken", info.firstTokenMs);
        log.setMs("stream", info.durationMs);
        switch (info.outcome) {
          case "answered":
            log.set({
              citations: info.citations,
              invalidCitations: info.invalidCitations,
              uncited: info.uncited,
              answerChars: info.answerChars,
            });
            log.end("answered", 200);
            return;
          case "not_found":
            log.set({ refusalPath: "gate2_sentinel" });
            log.end("not_found", 200);
            return;
          case "llm_unavailable":
          case "interrupted":
            log.setError(info.error);
            log.set({ answerChars: info.answerChars });
            log.end(info.outcome, 200, "error");
            return;
          case "client_aborted":
            log.set({ answerChars: info.answerChars });
            log.end("client_aborted", 200);
            return;
        }
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    console.error(
      "[ask] request failed before streaming:",
      describeError(error),
    );
    log.setError(error);
    // Embedding, search or setup failed after the unit was spent. A refusal
    // (`not_found`) is not a failure and returns above without a refund.
    if (spentBy !== null) {
      await refundUsage(spentBy, "question");
      log.set({ refunded: true });
    }
    if (error instanceof UsageCheckError) {
      log.end("usage_unavailable", 503);
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
      log.end("search_unavailable", 503);
      return jsonError(503, {
        error: "search_unavailable",
        message: "Search is temporarily unavailable. Please try again.",
      });
    }
    log.end("internal_error", 500);
    return jsonError(500, {
      error: "internal_error",
      message: "Something went wrong. Please try again.",
    });
  }
}