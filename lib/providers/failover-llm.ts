import "server-only";
import {
  BadRequestError,
  ProviderUnavailableError,
  RateLimitError,
} from "./errors";
import type { LlmProvider } from "./types";

/**
 * True for the failures where a second provider may well succeed: the primary
 * is rate limited, down, or misconfigured for us (rejected key, retired model
 * id). Other 4xx answers mean the request itself was wrong, so the fallback
 * would reject it too. An abort never reaches this function's callers as a
 * failover (see `createFailoverLlmProvider`).
 */
export function shouldFailOver(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof ProviderUnavailableError) return true;
  if (error instanceof BadRequestError) {
    return error.isAuthError || error.status === 404;
  }
  return false;
}

/** Name and message only. Provider errors never carry bodies or keys. */
function describe(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : "A non-Error value was thrown";
}

/** Task 5.10: lets the caller learn that a failover happened, for its request log. */
export interface FailoverHooks {
  /**
   * Called once, right before the fallback is used. `from` and `to` are model
   * ids; `error` is what the primary threw. A hook that throws is ignored.
   */
  onFailover?: (info: { from: string; to: string; error: unknown }) => void;
}

/**
 * Task 5.5. Streams from `primary`; if it fails before yielding any text and
 * the failure is one `shouldFailOver` accepts, streams from `fallback`
 * instead. Once the primary has yielded text, its failure is rethrown as-is:
 * the answer cannot be continued by another model, so the caller reports an
 * interrupted answer and keeps what it has.
 *
 * Not a failover: a caller abort, a `finish` event (including `blocked`),
 * and errors `shouldFailOver` rejects. If the fallback fails too, its error
 * is the one thrown. Logs which provider is being used, never any content.
 */
export function createFailoverLlmProvider(
  primary: LlmProvider,
  fallback: LlmProvider,
  hooks: FailoverHooks = {},
): LlmProvider {
  return {
    model: primary.model,
    async *stream(messages, options) {
      let textYielded = false;
      try {
        for await (const event of primary.stream(messages, options)) {
          if (event.type === "text") textYielded = true;
          yield event;
        }
        return;
      } catch (error) {
        if (textYielded || options?.signal?.aborted || !shouldFailOver(error)) {
          throw error;
        }
        console.warn(
          `[ask] Primary LLM (${primary.model}) failed before any text; trying fallback (${fallback.model}): ${describe(error)}`,
        );
        try {
          hooks.onFailover?.({ from: primary.model, to: fallback.model, error });
        } catch (hookError) {
          console.error("[ask] onFailover failed:", describe(hookError));
        }
      }
      yield* fallback.stream(messages, options);
    },
  };
}
