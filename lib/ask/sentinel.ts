/**
 * Refusal gate #2 (Task 2.5): the model is told to reply with exactly this
 * word when the passages do not contain the answer. The detector below lets
 * the stream tell that reply from a real answer before any text reaches the
 * client. Pure and free of `server-only` so eval scripts can reuse it.
 */
export const NOT_FOUND_SENTINEL = "NOT_FOUND";

/**
 * Whitespace that may precede the sentinel before the detector gives up
 * waiting and treats the output as a normal answer (a bound, so a model that
 * emits only whitespace cannot hold the stream back forever).
 */
export const MAX_LEADING_WHITESPACE = 64;

export type SentinelDecision =
  /** Not enough text yet. Release nothing. */
  | { kind: "pending" }
  /** The output opens with the sentinel. Refuse; never show the text. */
  | { kind: "not_found" }
  /** A normal answer. `text` is what to release now (buffered text first). */
  | { kind: "pass"; text: string };

export interface SentinelDetector {
  /** Feeds the next non-empty text chunk of the model output. */
  push(text: string): SentinelDecision;
  /** Call when the model output ends without a decision having been made. */
  end(): SentinelDecision;
}

/**
 * Decides, from the start of the output only, whether the model refused.
 *
 * Rule: after optional leading whitespace, the output either starts with the
 * exact, case-sensitive sentinel (refusal) or it does not (answer). Text that
 * is still a proper prefix of the sentinel ("NOT_", "NOT_FO") stays pending,
 * so the decision never needs more than the sentinel's length plus leading
 * whitespace, and works however the sentinel is split across chunks. Text
 * after the first decision is never inspected, so an answer that merely says
 * "not found" later cannot be turned into a refusal.
 */
export function createSentinelDetector(): SentinelDetector {
  let buffer = "";
  let decided: "pass" | "not_found" | null = null;

  return {
    push(text) {
      if (decided === "not_found") return { kind: "not_found" };
      if (decided === "pass") return { kind: "pass", text };

      buffer += text;
      const lead = buffer.trimStart();

      if (lead.startsWith(NOT_FOUND_SENTINEL)) {
        decided = "not_found";
        buffer = "";
        return { kind: "not_found" };
      }
      const stillPossible =
        lead === ""
          ? buffer.length <= MAX_LEADING_WHITESPACE
          : NOT_FOUND_SENTINEL.startsWith(lead);
      if (stillPossible) return { kind: "pending" };

      decided = "pass";
      const released = buffer;
      buffer = "";
      return { kind: "pass", text: released };
    },

    end() {
      if (decided === "not_found") return { kind: "not_found" };
      // Whatever is buffered is a partial prefix such as "NOT": a real answer.
      decided = "pass";
      const released = buffer;
      buffer = "";
      return { kind: "pass", text: released };
    },
  };
}
