import { REFUSAL_SIMILARITY_THRESHOLD } from "@/lib/config";

/**
 * Refusal gate #1 (Task 2.4): decides, from retrieval alone, whether the LLM
 * should be skipped. Pure and free of `server-only` (like `lib/config.ts`) so
 * tests and eval scripts can import it.
 *
 * The rule is the one recorded with the threshold in `docs/decisions.md`
 * (2026-11-05): refuse when the best similarity is strictly below the
 * threshold. A passage scoring exactly the threshold passes.
 *
 * The score is only meaningful for `REFUSAL_THRESHOLD_EMBEDDING_MODEL`; a
 * different embedder needs a new calibration.
 */

/** The only field of a `match_chunks` row the gate reads. */
export interface PassageSimilarity {
  similarity: number;
}

export type RefusalDecision =
  | { refuse: false; bestSimilarity: number }
  | { refuse: true; reason: "no_passages"; bestSimilarity: null }
  | { refuse: true; reason: "below_threshold"; bestSimilarity: number };

/**
 * Takes the best score itself instead of trusting row order. It fails closed:
 * with no usable score the answer is a refusal, because `NaN < threshold` is
 * false and would otherwise let the query through to the LLM.
 */
export function checkRefusalGate1(
  passages: readonly PassageSimilarity[],
  threshold: number = REFUSAL_SIMILARITY_THRESHOLD,
): RefusalDecision {
  let best: number | null = null;
  for (const { similarity } of passages) {
    if (Number.isFinite(similarity) && (best === null || similarity > best)) {
      best = similarity;
    }
  }
  if (best === null) {
    return { refuse: true, reason: "no_passages", bestSimilarity: null };
  }
  if (best < threshold) {
    return { refuse: true, reason: "below_threshold", bestSimilarity: best };
  }
  return { refuse: false, bestSimilarity: best };
}
