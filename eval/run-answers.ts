import { ProviderUnavailableError } from "@/lib/providers/errors";
import type { EvalEntry } from "./dataset";
import { withBackoff, type BackoffOptions } from "./run-retrieval";
import {
  answerErrorResult,
  scoreAnswer,
  type AnswerResult,
  type AskObservation,
} from "./score-answers";

/**
 * The full-pipeline eval loop (Task 2.8). Like `run-retrieval.ts` it knows
 * nothing about Supabase or Gemini: the caller supplies `ask`. Questions run
 * one at a time, in dataset order, with a pause between them. A rate limit,
 * an outage, or an answer stream that failed with `llm_unavailable` before
 * any text is retried with the shared backoff (each retry runs the whole
 * `ask` again, embedding included). A question that still fails is recorded
 * as an error result and the run carries on.
 */

export interface RunAnswersInput {
  entries: readonly EvalEntry[];
  /** Runs retrieval, gate #1 and (if not refused) the answer stream. */
  ask: (entry: EvalEntry) => Promise<AskObservation>;
  backoff: BackoffOptions;
  pauseMs: number;
  onResult?: (result: AnswerResult, index: number, total: number) => void;
}

function describeFailure(error: unknown): string {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/**
 * The stream swallows the provider error and sends `llm_unavailable`. Before
 * any text that is a transient provider failure worth retrying. After text it
 * is `interrupted`, which is not retried: the partial answer is the evidence.
 */
export function isTransientLlmFailure(observation: AskObservation): boolean {
  const terminal = observation.events.at(-1);
  return (
    !observation.gate1Refused &&
    terminal?.type === "error" &&
    terminal.code === "llm_unavailable" &&
    !observation.events.some((event) => event.type === "token")
  );
}

export async function runAnswerEval(
  input: RunAnswersInput,
): Promise<AnswerResult[]> {
  const { entries, ask, backoff } = input;
  const results: AnswerResult[] = [];

  const observe = async (entry: EvalEntry): Promise<AskObservation> => {
    const observation = await ask(entry);
    if (isTransientLlmFailure(observation)) {
      throw new ProviderUnavailableError(
        "The answer stream reported llm_unavailable before any text.",
        { provider: "gemini" },
      );
    }
    return observation;
  };

  for (const [index, entry] of entries.entries()) {
    if (index > 0 && input.pauseMs > 0) await backoff.sleep(input.pauseMs);

    let result: AnswerResult;
    try {
      result = scoreAnswer(
        entry,
        await withBackoff(() => observe(entry), backoff),
      );
    } catch (error) {
      result = answerErrorResult(entry, describeFailure(error));
    }
    results.push(result);
    input.onResult?.(result, index, entries.length);
  }
  return results;
}
